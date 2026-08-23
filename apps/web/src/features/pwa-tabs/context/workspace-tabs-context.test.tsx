import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, routerLocation, sessionStreamState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerLocation: { pathname: "/sessions/pane-a" },
  sessionStreamState: {
    sessions: [] as Array<{ paneId: string }>,
    connected: false,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: routerLocation }),
}));

vi.mock("jotai", () => ({
  useAtomValue: () => "all",
}));

vi.mock("@/lib/pwa-display-mode", () => ({
  PWA_DISPLAY_MODE_QUERIES: [],
  isPwaDisplayMode: () => false,
}));

vi.mock("@/state/session-context", () => ({
  useSessionStreamData: () => sessionStreamState,
}));

vi.mock("@/state/session-state-atoms", () => ({
  sessionWorkspaceTabsDisplayModeAtom: {},
}));

import { WorkspaceTabsProvider, useWorkspaceTabs } from "./workspace-tabs-context";
import { WORKSPACE_TABS_STORAGE_KEY } from "../model/workspace-tabs";

const Probe = () => {
  const workspaceTabs = useWorkspaceTabs();
  return (
    <>
      <div data-testid="active-tab">{workspaceTabs.activeTabId}</div>
      <div data-testid="tab-order">{workspaceTabs.tabs.map((tab) => tab.id).join(",")}</div>
      <button type="button" onClick={() => workspaceTabs.closeTab("session:pane-a")}>
        Close active tab
      </button>
      <button type="button" onClick={() => workspaceTabs.closeTab("session:missing")}>
        Close missing tab
      </button>
      <button type="button" onClick={workspaceTabs.closeAllTabs}>
        Close all tabs
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceTabs.closeTab("session:pane-a");
          workspaceTabs.closeTab("session:pane-b");
        }}
      >
        Close two tabs
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceTabs.dismissSessionTab("pane-a");
          workspaceTabs.dismissSessionTab("pane-b");
        }}
      >
        Dismiss two tabs
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceTabs.reorderTabs("session:pane-a", "session:pane-c");
          workspaceTabs.reorderTabs("session:pane-b", "session:pane-a");
        }}
      >
        Reorder twice
      </button>
    </>
  );
};

const seedSessionTabs = () => {
  localStorage.setItem(
    WORKSPACE_TABS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeTabId: "session:pane-a",
      tabs: [
        {
          id: "system:sessions",
          kind: "system",
          paneId: null,
          systemRoute: "sessions",
          closable: false,
          lastActivatedAt: 1,
        },
        {
          id: "session:pane-a",
          kind: "session",
          paneId: "pane-a",
          systemRoute: null,
          closable: true,
          lastActivatedAt: 4,
        },
        {
          id: "session:pane-b",
          kind: "session",
          paneId: "pane-b",
          systemRoute: null,
          closable: true,
          lastActivatedAt: 3,
        },
        {
          id: "session:pane-c",
          kind: "session",
          paneId: "pane-c",
          systemRoute: null,
          closable: true,
          lastActivatedAt: 2,
        },
      ],
    }),
  );
};

describe("WorkspaceTabsProvider", () => {
  let originalMatchMedia: PropertyDescriptor | undefined;

  beforeEach(() => {
    navigateMock.mockClear();
    sessionStreamState.sessions = [];
    sessionStreamState.connected = false;
    localStorage.clear();
    originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("navigates using the synchronously resolved close transition", async () => {
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a");
    });

    fireEvent.click(screen.getByRole("button", { name: "Close active tab" }));

    expect(navigateMock).toHaveBeenCalledWith({ href: "/" });
  });

  it("persists a StrictMode transition once and skips no-op transition writes", async () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");

    render(
      <StrictMode>
        <WorkspaceTabsProvider>
          <Probe />
        </WorkspaceTabsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a");
    });
    expect(
      setItemSpy.mock.calls.filter(([key]) => key === WORKSPACE_TABS_STORAGE_KEY),
    ).toHaveLength(1);

    setItemSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close missing tab" }));

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("composes consecutive close transitions from the latest state", async () => {
    seedSessionTabs();
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close two tabs" }));

    expect(screen.getByTestId("tab-order").textContent).toBe("system:sessions,session:pane-c");
    expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-c");
    expect(JSON.parse(localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY) ?? "{}")).toMatchObject({
      activeTabId: "session:pane-c",
      tabs: [{ id: "system:sessions" }, { id: "session:pane-c" }],
    });
    expect(navigateMock).toHaveBeenLastCalledWith({
      to: "/sessions/$paneId",
      params: { paneId: "pane-c" },
    });
  });

  it("closes all closable tabs and navigates to Sessions once", async () => {
    seedSessionTabs();
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a"),
    );
    navigateMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Close all tabs" }));

    expect(screen.getByTestId("tab-order").textContent).toBe("system:sessions");
    expect(screen.getByTestId("active-tab").textContent).toBe("system:sessions");
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({ href: "/" });
  });

  it("composes consecutive dismiss transitions from the latest state", async () => {
    seedSessionTabs();
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a"),
    );
    navigateMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss two tabs" }));

    expect(screen.getByTestId("tab-order").textContent).toBe("system:sessions,session:pane-c");
    expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-c");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("composes consecutive reorder transitions from the latest state", async () => {
    seedSessionTabs();
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reorder twice" }));

    expect(screen.getByTestId("tab-order").textContent).toBe(
      "system:sessions,session:pane-c,session:pane-a,session:pane-b",
    );
  });

  it("dismisses a missing active pane after the grace period and navigates once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    seedSessionTabs();
    sessionStreamState.connected = true;
    sessionStreamState.sessions = [{ paneId: "pane-b" }, { paneId: "pane-c" }];

    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    navigateMock.mockClear();

    act(() => {
      vi.advanceTimersByTime(5050);
    });

    expect(screen.getByTestId("tab-order").textContent).toBe(
      "system:sessions,session:pane-b,session:pane-c",
    );
    expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-b");
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/sessions/$paneId",
      params: { paneId: "pane-b" },
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("dismisses a missing non-active pane without navigating", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    seedSessionTabs();
    sessionStreamState.connected = true;
    sessionStreamState.sessions = [{ paneId: "pane-a" }, { paneId: "pane-c" }];

    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    navigateMock.mockClear();

    act(() => {
      vi.advanceTimersByTime(5050);
    });

    expect(screen.getByTestId("tab-order").textContent).toBe(
      "system:sessions,session:pane-a,session:pane-c",
    );
    expect(screen.getByTestId("active-tab").textContent).toBe("session:pane-a");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps a pane tab that returns during the missing-pane grace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    seedSessionTabs();
    sessionStreamState.connected = true;
    sessionStreamState.sessions = [{ paneId: "pane-a" }, { paneId: "pane-c" }];
    const view = render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    sessionStreamState.sessions = [
      { paneId: "pane-a" },
      { paneId: "pane-b" },
      { paneId: "pane-c" },
    ];
    view.rerender(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    navigateMock.mockClear();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByTestId("tab-order").textContent).toBe(
      "system:sessions,session:pane-a,session:pane-b,session:pane-c",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
