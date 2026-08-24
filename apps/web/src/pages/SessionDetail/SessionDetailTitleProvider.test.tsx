import { act, renderHook } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionDetailTitleProvider, useSessionDetailTitle } from "./SessionDetailTitleProvider";
import { createSessionDetail } from "./test-helpers";

let mockBase: {
  paneId: string;
  session: SessionSummary | null;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
  resetSessionTitle: (paneId: string) => Promise<void>;
};

vi.mock("./SessionDetailContexts", () => ({
  useSessionDetailBase: () => mockBase,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionDetailTitleProvider>{children}</SessionDetailTitleProvider>
);

describe("SessionDetailTitleProvider", () => {
  beforeEach(() => {
    mockBase = {
      paneId: "pane-1",
      session: createSessionDetail({ paneId: "pane-1", customTitle: "Saved title" }),
      updateSessionTitle: vi.fn(async () => undefined),
      resetSessionTitle: vi.fn(async () => undefined),
    };
  });

  it("keeps an editing draft across a transient session A -> null -> A transition", () => {
    const { result, rerender } = renderHook(() => useSessionDetailTitle(), { wrapper });

    act(() => {
      result.current.openTitleEditor();
      result.current.updateTitleDraft("Unsaved draft");
    });
    expect(result.current.titleEditing).toBe(true);
    expect(result.current.titleDraft).toBe("Unsaved draft");

    const session = mockBase.session;
    mockBase = { ...mockBase, session: null };
    rerender();
    expect(result.current.titleEditing).toBe(true);
    expect(result.current.titleDraft).toBe("Unsaved draft");

    mockBase = { ...mockBase, session };
    rerender();
    expect(result.current.titleEditing).toBe(true);
    expect(result.current.titleDraft).toBe("Unsaved draft");
  });
});
