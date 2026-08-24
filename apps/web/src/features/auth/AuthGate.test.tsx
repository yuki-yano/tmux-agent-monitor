import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AuthGate } from "./AuthGate";
import { createAppQueryClient } from "@/state/query-client";

const useSessionsMock = vi.fn();

vi.mock("@/state/session-context", () => ({
  useSessionConfigData: () => useSessionsMock(),
  useSessionCoreApi: () => useSessionsMock(),
}));

const renderAuthGate = (children: ReactNode, queryClient = createAppQueryClient()) => {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>),
  };
};

describe("AuthGate", () => {
  it("renders children when auth error is absent", () => {
    useSessionsMock.mockReturnValue({
      authError: null,
      setToken: vi.fn(),
      reconnect: vi.fn(),
    });

    renderAuthGate(
      <AuthGate>
        <div>secured-content</div>
      </AuthGate>,
    );

    expect(screen.getByText("secured-content")).toBeTruthy();
  });

  it("renders token banner when auth error is present", () => {
    useSessionsMock.mockReturnValue({
      authError: "Missing token",
      setToken: vi.fn(),
      reconnect: vi.fn(),
    });

    renderAuthGate(
      <AuthGate>
        <div>secured-content</div>
      </AuthGate>,
    );

    expect(screen.queryByText("secured-content")).toBeNull();
    expect(screen.getByText("Authentication required")).toBeTruthy();
  });

  it("clears cached server state before accepting a replacement token", () => {
    const setToken = vi.fn();
    const reconnect = vi.fn();
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(["session-detail", "pane-1", "branches"], { private: true });
    useSessionsMock.mockReturnValue({
      authError: "Unauthorized",
      setToken,
      reconnect,
    });
    renderAuthGate(<AuthGate>secured-content</AuthGate>, queryClient);

    fireEvent.change(screen.getByPlaceholderText("Paste access token"), {
      target: { value: "replacement-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(setToken).toHaveBeenCalledWith("replacement-token");
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("cancels old-token requests before reconnecting with a replacement token", async () => {
    const setToken = vi.fn();
    const reconnect = vi.fn();
    const queryClient = createAppQueryClient();
    let receivedSignal: AbortSignal | null = null;
    useSessionsMock.mockReturnValue({ authError: "Unauthorized", setToken, reconnect });
    const request = queryClient.fetchQuery({
      queryKey: ["session-detail", "pane-1", "timeline"],
      queryFn: ({ signal }) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    });
    const assertion = expect(request).rejects.toBeDefined();
    renderAuthGate(<AuthGate>secured-content</AuthGate>, queryClient);
    await waitFor(() => expect(receivedSignal).not.toBeNull());

    fireEvent.change(screen.getByPlaceholderText("Paste access token"), {
      target: { value: "replacement-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    await assertion;
    expect((receivedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(setToken).toHaveBeenCalledWith("replacement-token");
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
