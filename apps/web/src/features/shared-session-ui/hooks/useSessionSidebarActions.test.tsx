import { act, renderHook } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useSessionSidebarActions } from "./useSessionSidebarActions";

describe("useSessionSidebarActions", () => {
  it("preserves the list filter across keyed sidebar remounts", () => {
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const first = renderHook(() => useSessionSidebarActions({}), { wrapper });

    act(() => {
      first.result.current.handleFilterChange("ALL");
    });
    expect(first.result.current.filter).toBe("ALL");
    first.unmount();

    const remounted = renderHook(() => useSessionSidebarActions({}), { wrapper });
    expect(remounted.result.current.filter).toBe("ALL");
  });
});
