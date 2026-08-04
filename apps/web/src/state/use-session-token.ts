import { useCallback, useEffect, useState } from "react";

const API_BASE_URL_KEY = "vde-monitor-api-base-url";
const COOKIE_SESSION_MARKER = "cookie-session";

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

const isSameTrustedHost = (hostname: string) => {
  const currentHost = window.location.hostname;
  if (!currentHost) {
    return false;
  }
  if (hostname === currentHost) {
    return true;
  }
  return isLoopbackHost(hostname) && isLoopbackHost(currentHost);
};

const normalizeApiBaseUrl = (value: string | null) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (!normalizedPath.endsWith("/api")) {
      return null;
    }
    if (!isSameTrustedHost(parsed.hostname)) {
      return null;
    }
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
};

const readApiBaseUrlDirective = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const hasDirective = searchParams.has("api");
  return {
    hasDirective,
    apiBaseUrl: hasDirective ? normalizeApiBaseUrl(searchParams.get("api")) : null,
  };
};

const stripApiBaseUrlDirective = () => {
  const searchParams = new URLSearchParams(window.location.search);
  if (!searchParams.has("api")) {
    return;
  }
  searchParams.delete("api");
  const nextSearch = searchParams.toString();
  const next = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", next);
};

const readStoredApiBaseUrl = () => {
  const normalized = normalizeApiBaseUrl(localStorage.getItem(API_BASE_URL_KEY));
  if (!normalized) {
    localStorage.removeItem(API_BASE_URL_KEY);
    return null;
  }
  return normalized;
};

export const useSessionToken = () => {
  const [initialDirective] = useState(readApiBaseUrlDirective);
  const [token, setTokenState] = useState<string | null>(COOKIE_SESSION_MARKER);
  const [apiBaseUrl] = useState<string | null>(() =>
    initialDirective.hasDirective ? initialDirective.apiBaseUrl : readStoredApiBaseUrl(),
  );

  useEffect(() => {
    if (!initialDirective.hasDirective) {
      return;
    }
    if (initialDirective.apiBaseUrl) {
      localStorage.setItem(API_BASE_URL_KEY, initialDirective.apiBaseUrl);
    } else {
      localStorage.removeItem(API_BASE_URL_KEY);
    }
    stripApiBaseUrlDirective();
  }, [initialDirective]);

  const setToken = useCallback(
    async (nextToken: string | null) => {
      const trimmed = nextToken?.trim() ?? "";
      const endpoint = `${apiBaseUrl ?? "/api"}/auth/session`;
      try {
        const response = await fetch(endpoint, {
          method: trimmed ? "POST" : "DELETE",
          credentials: "include",
          headers: trimmed ? { "Content-Type": "application/json" } : undefined,
          body: trimmed ? JSON.stringify({ token: trimmed }) : undefined,
        });
        if (!response.ok) {
          return false;
        }
      } catch {
        return false;
      }
      setTokenState(trimmed ? COOKIE_SESSION_MARKER : null);
      return true;
    },
    [apiBaseUrl],
  );

  return { token, setToken, apiBaseUrl };
};
