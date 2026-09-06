import { act, renderHook } from "@testing-library/react";
import type { PromptCompletionResult } from "@vde-monitor/shared";
import { type KeyboardEvent, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type PromptCompletionConfig, usePromptCompletion } from "./usePromptCompletion";

const completion = (label: string): PromptCompletionResult => ({
  items: [
    {
      id: label,
      label,
      insertText: label,
      description: "",
      argumentHint: "",
      kind: "skill",
      scope: "user",
    },
  ],
});
const deferred = () => {
  let resolve!: (value: PromptCompletionResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<PromptCompletionResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const buildConfig = (overrides: Partial<PromptCompletionConfig> = {}): PromptCompletionConfig => ({
  paneId: "pane-a",
  agent: "codex",
  requestPromptCompletions: vi.fn(async () => completion("$one")),
  requestRepoFileSearch: vi.fn(async (paneId, query) => ({
    query,
    items: [],
    truncated: false,
    totalMatchedCount: 0,
  })),
  ...overrides,
});
const setup = (config = buildConfig()) => {
  const textInputRef = createRef<HTMLTextAreaElement>();
  textInputRef.current = document.createElement("textarea");
  const onTextareaMutated = vi.fn();
  const view = renderHook(
    ({ config, enabled }: { config: PromptCompletionConfig | null; enabled: boolean }) =>
      usePromptCompletion({ config, enabled, textInputRef, onTextareaMutated }),
    { initialProps: { config: config as PromptCompletionConfig | null, enabled: true } },
  );
  const evaluate = (value: string) =>
    act(() => {
      const textarea = textInputRef.current!;
      textarea.value = value;
      textarea.setSelectionRange(value.length, value.length);
      view.result.current.evaluate(textarea);
    });
  const key = (key: string) =>
    act(() => {
      view.result.current.handleKeyDown({
        key,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });
  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
  return { ...view, config, evaluate, key, flush, textInputRef, onTextareaMutated };
};

describe("usePromptCompletion lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["pane", "agent", "disabled", "missing-config"] as const)(
    "invalidates the token on %s changes and does not revive it on return",
    async (change) => {
      const first = deferred();
      const config = buildConfig({ requestPromptCompletions: vi.fn(() => first.promise) });
      const view = setup(config);
      view.evaluate("$one");
      await view.flush();
      expect(view.result.current.loading).toBe(true);
      view.rerender({
        config:
          change === "missing-config"
            ? null
            : {
                ...config,
                paneId: change === "pane" ? "pane-b" : config.paneId,
                agent: change === "agent" ? "claude" : config.agent,
              },
        enabled: change !== "disabled",
      });
      expect(view.result.current.visible).toBe(false);
      expect(view.result.current.loading).toBe(false);
      await act(async () => first.resolve(completion("obsolete")));
      view.rerender({ config, enabled: true });
      expect(view.result.current.token).toBeNull();
      expect(view.result.current.options).toEqual([]);
      expect(config.requestPromptCompletions).toHaveBeenCalledTimes(1);
    },
  );

  it("retains a request across config wrappers and replaces it when the API function changes", async () => {
    const first = deferred();
    const oldRequest = vi.fn(() => first.promise);
    const config = buildConfig({ requestPromptCompletions: oldRequest });
    const view = setup(config);
    view.evaluate("$one");
    await view.flush();
    view.rerender({ config: { ...config }, enabled: true });
    await view.flush();
    expect(oldRequest).toHaveBeenCalledTimes(1);
    const nextRequest = vi.fn(async () => completion("new"));
    view.rerender({ config: { ...config, requestPromptCompletions: nextRequest }, enabled: true });
    expect(view.result.current.loading).toBe(true);
    await view.flush();
    await act(async () => first.reject(new Error("obsolete")));
    expect(view.result.current.options[0]?.label).toBe("new");
    expect(view.result.current.error).toBeNull();
  });

  it("dismisses unchanged tokens, starts a fresh same-query request, and resets keyboard selection", async () => {
    const first = deferred();
    const second = deferred();
    const request = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(completion("third"));
    const view = setup(buildConfig({ requestPromptCompletions: request }));
    view.evaluate("$one");
    await view.flush();
    view.key("Escape");
    view.evaluate("$one");
    expect(view.result.current.visible).toBe(false);
    view.evaluate("");
    view.evaluate("$one");
    await view.flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(view.result.current.loading).toBe(true);
    await act(async () =>
      second.resolve({ items: [...completion("new-1").items, ...completion("new-2").items] }),
    );
    view.key("ArrowDown");
    expect(view.result.current.activeIndex).toBe(1);
    await act(async () => first.resolve(completion("obsolete")));
    expect(view.result.current.options[0]?.label).toBe("new-1");
    view.key("Escape");
    view.evaluate("");
    view.evaluate("$one");
    expect(view.result.current.activeIndex).toBe(0);
    expect(view.result.current.options).toEqual([]);
    await view.flush();
    expect(view.result.current.options[0]?.label).toBe("third");
  });

  it("hides suggestions during IME and evaluates only when composition ends", async () => {
    const view = setup();
    view.evaluate("$one");
    await view.flush();
    act(() => view.result.current.handleCompositionStart());
    view.evaluate("$two");
    expect(view.result.current.visible).toBe(false);
    act(() => view.result.current.handleCompositionEnd(view.textInputRef.current!));
    expect(view.result.current.token?.query).toBe("two");
    await view.flush();
    expect(view.config.requestPromptCompletions).toHaveBeenCalledTimes(2);
  });

  it("does not request an empty non-Codex file query and releases debounce timers on unmount", async () => {
    const view = setup(buildConfig({ agent: "claude" }));
    view.evaluate("@");
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.emptyMessage).toBe("Type a file name to search.");
    await view.flush();
    expect(view.config.requestRepoFileSearch).not.toHaveBeenCalled();
    view.evaluate("@file");
    expect(view.result.current.loading).toBe(true);
    view.unmount();
    await view.flush();
    expect(view.config.requestRepoFileSearch).not.toHaveBeenCalled();
  });

  it("ignores an async failure after unmount", async () => {
    const pending = deferred();
    const view = setup(buildConfig({ requestPromptCompletions: () => pending.promise }));
    view.evaluate("$one");
    await view.flush();
    view.unmount();
    await act(async () => pending.reject(new Error("obsolete")));
    expect(view.result.current.error).toBeNull();
  });
});
