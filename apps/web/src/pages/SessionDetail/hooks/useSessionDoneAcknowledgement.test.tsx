import type { SessionDetail } from "@vde-monitor/shared";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionDoneAcknowledgement } from "./useSessionDoneAcknowledgement";

const session = (
  completedSeq: number,
  acknowledgedSeq: number,
  epoch = "epoch-1",
  paneId = "%1",
): SessionDetail =>
  ({
    paneId,
    completion: { epoch, completedSeq, acknowledgedSeq },
  }) as SessionDetail;

const setVisibility = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
};

const DoneAcknowledgementProbe = ({
  paneId,
  value,
  acknowledgeSessionView,
}: {
  paneId: string;
  value: SessionDetail;
  acknowledgeSessionView: (paneId: string, epoch: string, throughSeq: number) => Promise<void>;
}) => {
  useSessionDoneAcknowledgement({ paneId, session: value, acknowledgeSessionView });
  return null;
};

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useSessionDoneAcknowledgement", () => {
  it("acknowledges a pending completion when the detail is visible", async () => {
    setVisibility("visible");
    const acknowledgeSessionView = vi.fn(async () => undefined);

    renderHook(() =>
      useSessionDoneAcknowledgement({
        paneId: "%1",
        session: session(2, 1),
        acknowledgeSessionView,
      }),
    );

    await waitFor(() => {
      expect(acknowledgeSessionView).toHaveBeenCalledWith("%1", "epoch-1", 2);
    });
  });

  it("coalesces StrictMode replay into one acknowledgement request", async () => {
    setVisibility("visible");
    const acknowledgeSessionView = vi.fn(async () => undefined);

    renderHook(
      () =>
        useSessionDoneAcknowledgement({
          paneId: "%1",
          session: session(2, 1),
          acknowledgeSessionView,
        }),
      { wrapper: StrictMode },
    );

    await waitFor(() => {
      expect(acknowledgeSessionView).toHaveBeenCalledOnce();
    });
  });

  it("retries a transient acknowledgement failure while the detail remains visible", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const acknowledgeSessionView = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    renderHook(() =>
      useSessionDoneAcknowledgement({
        paneId: "%1",
        session: session(1, 0),
        acknowledgeSessionView,
      }),
    );
    await act(async () => undefined);

    expect(acknowledgeSessionView).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(acknowledgeSessionView).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(acknowledgeSessionView).toHaveBeenNthCalledWith(2, "%1", "epoch-1", 1);
  });

  it("cancels a pending acknowledgement retry on unmount", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const acknowledgeSessionView = vi.fn().mockRejectedValue(new Error("offline"));
    const { unmount } = renderHook(() =>
      useSessionDoneAcknowledgement({
        paneId: "%1",
        session: session(1, 0),
        acknowledgeSessionView,
      }),
    );
    await act(async () => undefined);

    unmount();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(acknowledgeSessionView).toHaveBeenCalledTimes(1);
  });

  it("pauses a pending retry while hidden and retries on visibility return", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const acknowledgeSessionView = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    renderHook(() =>
      useSessionDoneAcknowledgement({
        paneId: "%1",
        session: session(1, 0),
        acknowledgeSessionView,
      }),
    );
    await act(async () => undefined);

    setVisibility("hidden");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(acknowledgeSessionView).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(acknowledgeSessionView).toHaveBeenNthCalledWith(2, "%1", "epoch-1", 1);
  });

  it("acknowledges a snapshot that arrives after mount and each later generation", async () => {
    setVisibility("visible");
    const acknowledgeSessionView = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ value }: { value: SessionDetail | null }) =>
        useSessionDoneAcknowledgement({
          paneId: "%1",
          session: value,
          acknowledgeSessionView,
        }),
      { initialProps: { value: null as SessionDetail | null } },
    );
    expect(acknowledgeSessionView).not.toHaveBeenCalled();

    rerender({ value: session(1, 0) });
    await waitFor(() => expect(acknowledgeSessionView).toHaveBeenCalledWith("%1", "epoch-1", 1));

    rerender({ value: session(2, 1) });
    await waitFor(() => expect(acknowledgeSessionView).toHaveBeenCalledWith("%1", "epoch-1", 2));
  });

  it("acknowledges 20 visible completion generations within two seconds each", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const responseDelaysMs = [
      25, 40, 55, 70, 85, 100, 125, 150, 180, 220, 260, 310, 370, 440, 520, 620, 760, 920, 1_200,
      1_800,
    ];
    const samples: Array<{
      sampleId: number;
      startedAt: number;
      completedAt: number;
      latencyMs: number;
    }> = [];
    const acknowledgeSessionView = vi.fn(
      (_paneId: string, _epoch: string, throughSeq: number) =>
        new Promise<void>((resolve) => {
          const startedAt = performance.now();
          const delayMs = responseDelaysMs[throughSeq - 1];
          if (delayMs == null) {
            throw new Error(`Unexpected completion sequence: ${throughSeq}`);
          }
          setTimeout(() => {
            const completedAt = performance.now();
            samples.push({
              sampleId: throughSeq,
              startedAt,
              completedAt,
              latencyMs: completedAt - startedAt,
            });
            resolve();
          }, delayMs);
        }),
    );
    const { rerender } = renderHook(
      ({ value }: { value: SessionDetail | null }) =>
        useSessionDoneAcknowledgement({
          paneId: "%1",
          session: value,
          acknowledgeSessionView,
        }),
      { initialProps: { value: null as SessionDetail | null } },
    );

    for (let completedSeq = 1; completedSeq <= responseDelaysMs.length; completedSeq += 1) {
      rerender({ value: session(completedSeq, completedSeq - 1) });
      expect(acknowledgeSessionView).toHaveBeenLastCalledWith("%1", "epoch-1", completedSeq);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(responseDelaysMs[completedSeq - 1] ?? 0);
      });
    }

    expect(acknowledgeSessionView).toHaveBeenCalledTimes(20);
    expect(samples).toHaveLength(20);
    expect(samples.map(({ sampleId }) => sampleId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(samples.map(({ latencyMs }) => latencyMs)).toEqual(responseDelaysMs);
    expect(samples.every(({ latencyMs }) => latencyMs <= 2_000)).toBe(true);
  });

  it("does not acknowledge while hidden and acknowledges on visibility return", async () => {
    setVisibility("hidden");
    const acknowledgeSessionView = vi.fn(async () => undefined);
    renderHook(() =>
      useSessionDoneAcknowledgement({
        paneId: "%1",
        session: session(1, 0),
        acknowledgeSessionView,
      }),
    );
    expect(acknowledgeSessionView).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(acknowledgeSessionView).toHaveBeenCalledWith("%1", "epoch-1", 1));
  });

  it("uses the current pane after a paneId switch", async () => {
    setVisibility("visible");
    const acknowledgeSessionView = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ paneId, value }: { paneId: string; value: SessionDetail }) =>
        useSessionDoneAcknowledgement({
          paneId,
          session: value,
          acknowledgeSessionView,
        }),
      { initialProps: { paneId: "%1", value: session(1, 0) } },
    );
    await waitFor(() => expect(acknowledgeSessionView).toHaveBeenCalledWith("%1", "epoch-1", 1));

    rerender({ paneId: "%2", value: session(1, 0) });
    expect(acknowledgeSessionView).not.toHaveBeenCalledWith("%2", "epoch-1", 1);

    rerender({ paneId: "%2", value: session(1, 0, "epoch-2", "%2") });
    await waitFor(() => expect(acknowledgeSessionView).toHaveBeenCalledWith("%2", "epoch-2", 1));
  });

  it("bounds acknowledgement requests across keyed A to B to A remounts", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    let rejectInitialPaneA: ((reason?: unknown) => void) | undefined;
    const acknowledgeSessionView = vi.fn((paneId: string) =>
      paneId === "%1" && acknowledgeSessionView.mock.calls.length === 1
        ? new Promise<void>((_resolve, reject) => {
            rejectInitialPaneA = reject;
          })
        : Promise.resolve(),
    );
    const view = render(
      <StrictMode>
        <DoneAcknowledgementProbe
          key="pane-a:first"
          paneId="%1"
          value={session(1, 0)}
          acknowledgeSessionView={acknowledgeSessionView}
        />
      </StrictMode>,
    );
    expect(acknowledgeSessionView).toHaveBeenCalledTimes(1);

    view.rerender(
      <StrictMode>
        <DoneAcknowledgementProbe
          key="pane-b"
          paneId="%2"
          value={session(1, 0, "epoch-2", "%2")}
          acknowledgeSessionView={acknowledgeSessionView}
        />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <DoneAcknowledgementProbe
          key="pane-a:revisit"
          paneId="%1"
          value={session(1, 0)}
          acknowledgeSessionView={acknowledgeSessionView}
        />
      </StrictMode>,
    );
    expect(acknowledgeSessionView.mock.calls).toEqual([
      ["%1", "epoch-1", 1],
      ["%2", "epoch-2", 1],
    ]);

    rejectInitialPaneA?.(new Error("obsolete request"));
    await act(async () => {
      await Promise.resolve();
      await vi.runAllTimersAsync();
    });
    expect(acknowledgeSessionView.mock.calls).toEqual([
      ["%1", "epoch-1", 1],
      ["%2", "epoch-2", 1],
      ["%1", "epoch-1", 1],
    ]);
  });
});
