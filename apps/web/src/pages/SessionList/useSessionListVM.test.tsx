// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SESSION_LIST_FILTER, isSessionListFilter } from "./sessionListFilters";
import { useSessionListVM } from "./useSessionListVM";

const mockUseSessions = vi.hoisted(() => vi.fn());
const mockUseSessionLogs = vi.hoisted(() => ({
  quickPanelOpen: false,
  logModalOpen: false,
  selectedPaneId: null,
  selectedSession: null,
  selectedLogLines: [],
  selectedLogLoading: false,
  selectedLogError: null,
  openLogModal: vi.fn(),
  closeLogModal: vi.fn(),
  toggleQuickPanel: vi.fn(),
  closeQuickPanel: vi.fn(),
}));

vi.mock("@/state/session-context", () => ({
  useSessions: () => mockUseSessions(),
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({ resolvedTheme: "latte" }),
}));

vi.mock("@/lib/use-now-ms", () => ({
  useNowMs: () => 0,
}));

vi.mock("@/lib/use-sidebar-width", () => ({
  useSidebarWidth: () => ({
    sidebarWidth: 280,
    handlePointerDown: vi.fn(),
  }),
}));

vi.mock("../SessionDetail/hooks/useSessionLogs", () => ({
  useSessionLogs: () => mockUseSessionLogs,
}));

const createTestRouter = (initialEntries: string[]) => {
  const rootRoute = createRootRoute({
    component: () => null,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
    validateSearch: (search: Record<string, unknown>) => {
      const filter = isSessionListFilter(search.filter)
        ? search.filter
        : DEFAULT_SESSION_LIST_FILTER;
      return { filter };
    },
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries }),
  });
};

const TestComponent = () => {
  const vm = useSessionListVM();
  return (
    <div>
      <span data-testid="filter">{vm.filter}</span>
      <button type="button" onClick={() => vm.onFilterChange("SHELL")}>
        set-shell
      </button>
      <button type="button" onClick={() => vm.onFilterChange("UNKNOWN")}>
        set-unknown
      </button>
      <button type="button" onClick={() => vm.onFilterChange("invalid")}>
        set-invalid
      </button>
    </div>
  );
};

const renderWithRouter = async (initialEntries: string[] = ["/"]) => {
  const router = createTestRouter(initialEntries);
  await act(async () => {
    await router.load();
  });
  return render(
    <RouterContextProvider router={router}>
      <TestComponent />
    </RouterContextProvider>,
  );
};

describe("useSessionListVM", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessions.mockReturnValue({
      sessions: [],
      connected: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions: vi.fn(),
      requestScreen: vi.fn(),
      highlightCorrections: false,
    });
  });

  it("reads filter from search params", async () => {
    await renderWithRouter(["/?filter=SHELL"]);
    expect(screen.getByTestId("filter").textContent).toBe("SHELL");
  });

  it("defaults to AGENT when search is missing", async () => {
    await renderWithRouter(["/"]);
    expect(screen.getByTestId("filter").textContent).toBe("AGENT");
  });

  it("updates filter when onFilterChange is called", async () => {
    await renderWithRouter(["/?filter=AGENT"]);
    fireEvent.click(screen.getByRole("button", { name: "set-unknown" }));
    await waitFor(() => {
      expect(screen.getByTestId("filter").textContent).toBe("UNKNOWN");
    });
  });

  it("falls back to default for invalid filter values", async () => {
    await renderWithRouter(["/?filter=SHELL"]);
    fireEvent.click(screen.getByRole("button", { name: "set-invalid" }));
    await waitFor(() => {
      expect(screen.getByTestId("filter").textContent).toBe("AGENT");
    });
  });
});
