import "./index.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { router } from "./router";
import { createAppQueryClient } from "./state/query-client";

const queryClient = createAppQueryClient();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        console.warn("[vde-monitor] service worker registration failed", error);
      }
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
