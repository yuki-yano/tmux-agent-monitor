import { useEffect, useState } from "react";

const TOKEN_KEY = "vde-monitor-token";
const API_BASE_URL_KEY = "vde-monitor-api-base-url";

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

const readSessionAccessFromUrl = () => {
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(rawHash);
  const tokenRaw = hashParams.get("token");
  const token = tokenRaw?.trim() || null;
  const hasTokenParam = tokenRaw != null;
  const apiBaseUrlRaw = hashParams.get("api");
  const hasApiParam = apiBaseUrlRaw != null;
  const hasAccessDirective = hasApiParam || hasTokenParam;
  const apiBaseUrl = token && hasApiParam ? normalizeApiBaseUrl(apiBaseUrlRaw) : null;
  return { token, apiBaseUrl, hasAccessDirective };
};

/*
  Kept out of readSessionAccessFromUrl on purpose: that runs during render, and
  replaceState would synchronously re-enter the router while a component tree
  is still rendering. Callers strip the URL from an effect instead.
*/
const stripAccessDirectiveFromUrl = () => {
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(rawHash);
  if (!hashParams.has("token") && !hashParams.has("api")) {
    return;
  }
  hashParams.delete("token");
  hashParams.delete("api");
  const nextHash = hashParams.toString();
  const next = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
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
  const [initialAccess] = useState(readSessionAccessFromUrl);
  const [token, setTokenState] = useState<string | null>(() => {
    if (initialAccess.hasAccessDirective) {
      return initialAccess.token;
    }
    return localStorage.getItem(TOKEN_KEY);
  });
  const [apiBaseUrl] = useState<string | null>(() => {
    if (initialAccess.hasAccessDirective) {
      return initialAccess.apiBaseUrl;
    }
    return readStoredApiBaseUrl();
  });

  useEffect(() => {
    if (!initialAccess.hasAccessDirective) {
      return;
    }
    if (initialAccess.token) {
      localStorage.setItem(TOKEN_KEY, initialAccess.token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (initialAccess.apiBaseUrl) {
      localStorage.setItem(API_BASE_URL_KEY, initialAccess.apiBaseUrl);
    } else {
      localStorage.removeItem(API_BASE_URL_KEY);
    }
    stripAccessDirectiveFromUrl();
  }, [initialAccess]);

  const setToken = (nextToken: string | null) => {
    const trimmed = nextToken?.trim() ?? "";
    if (trimmed.length === 0) {
      localStorage.removeItem(TOKEN_KEY);
      setTokenState(null);
      return;
    }
    localStorage.setItem(TOKEN_KEY, trimmed);
    setTokenState(trimmed);
  };

  return { token, setToken, apiBaseUrl };
};
