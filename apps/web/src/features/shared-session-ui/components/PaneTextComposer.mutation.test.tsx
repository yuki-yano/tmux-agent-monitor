import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaneTextComposer } from "./PaneTextComposer";

type MutationOutcome = "return" | "throw" | "resolve" | "reject";
type MutationSource = "send" | "paste" | "file selection";

describe.each<MutationSource>(["send", "paste", "file selection"])(
  "PaneTextComposer %s completion",
  (source) => {
    afterEach(() => {
      vi.restoreAllMocks();
      window.localStorage.clear();
    });

    it.each<MutationOutcome>(["return", "throw", "resolve", "reject"])(
      "preserves synchronization and error propagation for %s",
      async (outcome) => {
        const textInputRef = createRef<HTMLTextAreaElement>();
        const draftStorageKey = "test:composer-mutation";
        const failure = new Error("Mutation failed");
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const result = new Promise<void>((resolveResult, rejectResult) => {
          resolve = resolveResult;
          reject = rejectResult;
        });
        let continuation: Promise<void> | undefined;
        const finallyResult = result.finally.bind(result);
        // Observe the callback's continuation without leaving an intentional rejection unhandled.
        vi.spyOn(result, "finally").mockImplementation((onFinally) => {
          continuation = finallyResult(onFinally);
          void continuation.catch(() => undefined);
          return continuation;
        });
        const reportedErrors: unknown[] = [];
        const onError = (event: ErrorEvent) => {
          reportedErrors.push(event.error);
          event.preventDefault();
        };
        window.addEventListener("error", onError);
        let height = 56;
        const mutate = vi.fn(() => {
          textInputRef.current!.value = "after mutation";
          height = 120;
          if (outcome === "throw") {
            throw failure;
          }
          return outcome === "return" ? undefined : result;
        });

        try {
          const { container } = render(
            <PaneTextComposer
              state={{
                interactive: true,
                isSendingText: false,
                textInputRef,
                draftStorageKey,
                autoEnter: true,
                rawMode: false,
                allowDangerKeys: false,
              }}
              actions={{
                onSendText: mutate,
                onPickImage: mutate,
                onToggleAutoEnter: vi.fn(),
                onToggleRawMode: vi.fn(),
                onToggleAllowDangerKeys: vi.fn(),
                onRawBeforeInput: vi.fn(),
                onRawInput: vi.fn(),
                onRawKeyDown: vi.fn(),
                onRawCompositionStart: vi.fn(),
                onRawCompositionEnd: vi.fn(),
              }}
            />,
          );
          const textarea = textInputRef.current!;
          Object.defineProperty(textarea, "scrollHeight", { get: () => height });
          fireEvent.input(textarea, { target: { value: "before mutation" } });
          const file = new File(["image"], "image.png", { type: "image/png" });
          const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
          Object.defineProperty(fileInput, "value", {
            configurable: true,
            writable: true,
            value: "selected image",
          });

          const triggerMutation = () => {
            if (source === "send") {
              fireEvent.click(screen.getByRole("button", { name: "Send" }));
            } else if (source === "paste") {
              fireEvent.paste(textarea, {
                clipboardData: {
                  items: [{ kind: "file", getAsFile: () => file }],
                  files: [file],
                },
              });
            } else {
              fireEvent.change(fileInput, { target: { files: [file] } });
            }
          };
          try {
            triggerMutation();
          } catch (error) {
            reportedErrors.push(error);
          }

          expect(mutate).toHaveBeenCalledTimes(1);
          if (source !== "send") {
            expect(mutate).toHaveBeenCalledWith(file);
          }
          expect(textarea.value).toBe("after mutation");
          expect(textarea.style.height).toBe("56px");
          expect(window.localStorage.getItem(draftStorageKey)).toBe("before mutation");
          expect(fileInput.value).toBe("selected image");

          if (outcome === "throw") {
            expect(reportedErrors).toEqual([failure]);
            await act(async () => {});
            expect(textarea.style.height).toBe("56px");
            expect(window.localStorage.getItem(draftStorageKey)).toBe("before mutation");
            expect(fileInput.value).toBe("selected image");
            return;
          }

          expect(reportedErrors).toEqual([]);
          if (outcome === "resolve" || outcome === "reject") {
            await act(async () => {});
            expect(textarea.style.height).toBe("56px");
            expect(window.localStorage.getItem(draftStorageKey)).toBe("before mutation");
            expect(fileInput.value).toBe("selected image");
          }
          await act(async () => {
            if (outcome === "resolve") {
              resolve();
              await continuation;
            } else if (outcome === "reject") {
              reject(failure);
              await expect(continuation).rejects.toBe(failure);
            }
          });
          expect(textarea.style.height).toBe("120px");
          expect(window.localStorage.getItem(draftStorageKey)).toBe("after mutation");
          expect(fileInput.value).toBe(source === "file selection" ? "" : "selected image");
        } finally {
          window.removeEventListener("error", onError);
        }
      },
    );
  },
);
