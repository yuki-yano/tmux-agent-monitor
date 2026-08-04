import { timingSafeEqual } from "node:crypto";

import type { AgentMonitorConfig } from "@vde-monitor/multiplexer";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export { buildError } from "../errors";
export { nowIso } from "../utils/time";

// Compare in constant time so the token cannot be probed byte by byte
// through response timing. Only the token length is observable.
export const SESSION_AUTH_COOKIE_NAME = "vde-monitor-session";

const tokensMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

export const isValidAuthToken = (config: AgentMonitorConfig, token: string) =>
  tokensMatch(token, config.token);

const isSecureCookieRequest = (c: Context) => {
  const forwardedProtocol = c.req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const url = new URL(c.req.url);
  return (
    forwardedProtocol === "https" ||
    url.protocol === "https:" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
};

export const setSessionAuthCookie = (c: Context, token: string) => {
  setCookie(c, SESSION_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureCookieRequest(c),
    sameSite: "Strict",
    path: "/",
  });
};

export const clearSessionAuthCookie = (c: Context) => {
  deleteCookie(c, SESSION_AUTH_COOKIE_NAME, {
    secure: isSecureCookieRequest(c),
    sameSite: "Strict",
    path: "/",
  });
};

export const requireAuth = (config: AgentMonitorConfig, c: Context) => {
  const sessionToken = getCookie(c, SESSION_AUTH_COOKIE_NAME);
  if (sessionToken && tokensMatch(sessionToken, config.token)) {
    return true;
  }
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return false;
  }
  const token = auth.replace("Bearer ", "").trim();
  return tokensMatch(token, config.token);
};

export const isOriginAllowed = (
  config: AgentMonitorConfig,
  origin?: string | null,
  host?: string | null,
) => {
  if (config.allowedOrigins.length === 0) {
    return true;
  }
  if (!origin) {
    return false;
  }
  return (
    config.allowedOrigins.includes(origin) || (host ? config.allowedOrigins.includes(host) : false)
  );
};
