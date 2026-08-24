import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import type { SessionSidebarMainSectionsViewModel } from "./SessionSidebarMainSections";
import { SessionSidebarMainSections } from "./SessionSidebarMainSections";

const createViewModel = (): SessionSidebarMainSectionsViewModel => ({
  header: { totalSessions: 0, repoCount: 0 },
  filter: { value: "AGENT", onChange: vi.fn() },
  list: {
    onListScroll: vi.fn(),
    sidebarGroups: [],
    nowMs: 0,
    focusPendingPaneIds: new Set(),
    launchPendingSessions: new Set(),
    launchConfig: {
      agents: {
        codex: { options: [] },
        claude: { options: [] },
      },
    },
    launchAgentAvailable: false,
    requestWorktrees: vi.fn(),
    onHoverStart: vi.fn(),
    onHoverEnd: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onSelect: vi.fn(),
    onFocusPane: vi.fn(),
    onLaunchAgentInSession: vi.fn(),
    onTouchSession: vi.fn(),
    onTouchRepoPin: vi.fn(),
    registerItemRef: vi.fn(),
  },
});

describe("SessionSidebarMainSections", () => {
  it("restores list scroll position across keyed remounts", async () => {
    const store = createStore();
    const viewModel = createViewModel();
    const rootRoute = createRootRoute({ component: () => null });
    const sessionRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/sessions/$paneId",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([sessionRoute]),
      history: createMemoryHistory({ initialEntries: ["/sessions/pane-a"] }),
    });
    const renderSidebar = (key: string) =>
      render(
        <RouterContextProvider router={router}>
          <JotaiProvider store={store}>
            <SessionSidebarMainSections key={key} viewModel={viewModel} />
          </JotaiProvider>
        </RouterContextProvider>,
      );
    const first = renderSidebar("pane-a");
    const firstList = first.container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(firstList).not.toBeNull();
    if (!firstList) {
      return;
    }

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    firstList.scrollTop = 480;
    fireEvent.scroll(firstList);
    expect(viewModel.list.onListScroll).toHaveBeenCalledOnce();
    first.unmount();

    const remounted = renderSidebar("pane-b");
    const remountedList = remounted.container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(remountedList?.scrollTop).toBe(480);
  });
});
