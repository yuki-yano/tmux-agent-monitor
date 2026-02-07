// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  titleDraftAtom,
  titleEditingAtom,
  titleErrorAtom,
  titleSavingAtom,
} from "../atoms/titleAtoms";
import { createSessionDetail } from "../test-helpers";
import { useSessionTitleEditor } from "./useSessionTitleEditor";

describe("useSessionTitleEditor", () => {
  const createWrapper = () => {
    const store = createStore();
    store.set(titleDraftAtom, "");
    store.set(titleEditingAtom, false);
    store.set(titleSavingAtom, false);
    store.set(titleErrorAtom, null);
    return ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
  };

  it("initializes with custom title", () => {
    const session = createSessionDetail({ customTitle: "Custom" });
    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionTitleEditor({
          session,
          paneId: session.paneId,
          updateSessionTitle: vi.fn(),
        }),
      { wrapper },
    );

    expect(result.current.titleDraft).toBe("Custom");
    expect(result.current.titleEditing).toBe(false);
  });

  it("opens editor and saves trimmed title", async () => {
    const session = createSessionDetail({ customTitle: "Custom" });
    const updateSessionTitle = vi.fn().mockResolvedValue(undefined);
    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionTitleEditor({
          session,
          paneId: session.paneId,
          updateSessionTitle,
        }),
      { wrapper },
    );

    act(() => {
      result.current.openTitleEditor();
      result.current.updateTitleDraft("  Updated Title  ");
    });

    await act(async () => {
      await result.current.saveTitle();
    });

    expect(updateSessionTitle).toHaveBeenCalledWith(session.paneId, "Updated Title");
    expect(result.current.titleEditing).toBe(false);
  });

  it("validates title length", async () => {
    const session = createSessionDetail();
    const updateSessionTitle = vi.fn().mockResolvedValue(undefined);
    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionTitleEditor({
          session,
          paneId: session.paneId,
          updateSessionTitle,
        }),
      { wrapper },
    );

    act(() => {
      result.current.updateTitleDraft("a".repeat(81));
    });

    await act(async () => {
      await result.current.saveTitle();
    });

    expect(updateSessionTitle).not.toHaveBeenCalled();
    expect(result.current.titleError).toBe("Title must be 80 characters or less.");
  });

  it("clears title", async () => {
    const session = createSessionDetail();
    const updateSessionTitle = vi.fn().mockResolvedValue(undefined);
    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionTitleEditor({
          session,
          paneId: session.paneId,
          updateSessionTitle,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.clearTitle();
    });

    expect(updateSessionTitle).toHaveBeenCalledWith(session.paneId, null);
  });
});
