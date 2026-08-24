import { QueryClient } from "@tanstack/react-query";

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
