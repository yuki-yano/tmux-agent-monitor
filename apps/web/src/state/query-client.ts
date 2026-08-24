import { QueryClient, focusManager } from "@tanstack/react-query";

export const configureAppQueryFocusManager = () => {
  focusManager.setEventListener((handleFocus) => {
    if (typeof window === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    const handleWindowFocus = () => handleFocus();
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted || document.visibilityState === "visible") handleFocus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  });
};

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: "online",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchIntervalInBackground: false,
      },
      mutations: {
        retry: false,
        networkMode: "online",
      },
    },
  });
