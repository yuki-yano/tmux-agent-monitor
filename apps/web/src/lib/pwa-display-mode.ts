import { useSyncExternalStore } from "react";

const DISPLAY_MODE_QUERIES = [
  "(display-mode: standalone)",
  "(display-mode: fullscreen)",
  "(display-mode: window-controls-overlay)",
] as const;

const matchesDisplayMode = (query: string) => {
  try {
    return window.matchMedia?.(query)?.matches === true;
  } catch {
    return false;
  }
};

export const isPwaDisplayMode = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  if (DISPLAY_MODE_QUERIES.some((query) => matchesDisplayMode(query))) {
    return true;
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

const subscribePwaDisplayMode = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const mediaQueries = DISPLAY_MODE_QUERIES.map((query) => window.matchMedia(query));
  mediaQueries.forEach((mediaQuery) => mediaQuery.addEventListener("change", onStoreChange));
  return () => {
    mediaQueries.forEach((mediaQuery) => mediaQuery.removeEventListener("change", onStoreChange));
  };
};

const getServerPwaDisplayMode = () => false;

export const usePwaDisplayMode = () =>
  useSyncExternalStore(subscribePwaDisplayMode, isPwaDisplayMode, getServerPwaDisplayMode);

export const PWA_DISPLAY_MODE_QUERIES = DISPLAY_MODE_QUERIES;
