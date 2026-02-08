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
  const token = hashParams.get("token");
  const apiBaseUrlRaw = hashParams.get("api");
  const apiBaseUrl = normalizeApiBaseUrl(apiBaseUrlRaw);
  const hasApiParam = apiBaseUrlRaw !== null;
  const hasApiDirective = hasApiParam || Boolean(token);
  const shouldStripFromUrl = Boolean(token) || apiBaseUrlRaw !== null;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
  if (hasApiParam && apiBaseUrl) {
    localStorage.setItem(API_BASE_URL_KEY, apiBaseUrl);
  } else if (hasApiParam || token) {
    localStorage.removeItem(API_BASE_URL_KEY);
  }
  if (shouldStripFromUrl) {
    hashParams.delete("token");
    hashParams.delete("api");
    const nextSearch = window.location.search;
    const nextHash = hashParams.toString();
    const next = `${window.location.pathname}${nextSearch}${nextHash ? `#${nextHash}` : ""}`;
    window.history.replaceState({}, "", next);
  }
  return { token, apiBaseUrl, hasApiDirective };
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
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(() => readStoredApiBaseUrl());

  useEffect(() => {
    const {
      token: urlToken,
      apiBaseUrl: urlApiBaseUrl,
      hasApiDirective,
    } = readSessionAccessFromUrl();
    if (urlToken && urlToken !== token) {
      setToken(urlToken);
    }
    if (hasApiDirective && urlApiBaseUrl !== apiBaseUrl) {
      setApiBaseUrl(urlApiBaseUrl);
    }
  }, [apiBaseUrl, token]);

  return { token, setToken, apiBaseUrl };
};
