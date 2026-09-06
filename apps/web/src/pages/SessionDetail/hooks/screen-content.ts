import type { ScreenResponse } from "@vde-monitor/shared";
import { startTransition } from "react";

import { applyScreenDeltas } from "@/lib/screen-delta";
import type { ScreenMode } from "@/lib/screen-loading";

type ScreenDisplay = {
  setScreen: (text: string) => void;
  setImageBase64: (image: string | null) => void;
  setScreenContentContextKey: (contextKey: string | null) => void;
};

export const createScreenContent = ({
  setScreen,
  setImageBase64,
  setScreenContentContextKey,
}: ScreenDisplay) => {
  // Received lines and cursor advance even while the displayed screen is held during a gesture.
  let receivedLines: string[] = [];
  let cursor: string | null = null;
  let displayedText = "";
  let displayedImage: string | null = null;
  let pendingText: { screen: string; contextKey: string } | null = null;

  const updateText = (
    nextScreen: string,
    nextLines: string[],
    nextCursor: string | null,
    contextKey: string,
    suppressRender: boolean,
    immediate: boolean,
  ) => {
    receivedLines = nextLines;
    cursor = nextCursor;
    // Holding text during gestures preserves vertical momentum and horizontal position.
    if (suppressRender) {
      pendingText = { screen: nextScreen, contextKey };
      return;
    }
    const changed = displayedText !== nextScreen || displayedImage != null;
    pendingText = null;
    displayedText = nextScreen;
    displayedImage = null;
    const commit = () => {
      if (changed) {
        setScreen(nextScreen);
        setImageBase64(null);
      }
      setScreenContentContextKey(contextKey);
    };
    if (immediate) commit();
    else startTransition(commit);
  };
  const updateImage = (nextImage: string | null, contextKey: string, immediate: boolean) => {
    const changed = displayedImage !== nextImage || displayedText !== "";
    const commit = () => {
      if (changed) {
        setImageBase64(nextImage);
        setScreen("");
      }
      setScreenContentContextKey(contextKey);
    };
    if (immediate) commit();
    else startTransition(commit);
    if (changed) {
      displayedImage = nextImage;
      displayedText = "";
      pendingText = null;
    }
  };
  const applyResponse = (
    response: ScreenResponse,
    { isUserScrolling, immediate }: { isUserScrolling: boolean; immediate: boolean },
  ) => {
    const contextKey = `${response.paneId}\0${response.mode}`;
    if (response.mode === "image") {
      updateImage(response.imageBase64 ?? null, contextKey, immediate);
      return;
    }
    const nextCursor = response.cursor ?? null;
    if (response.full || response.screen != null || !response.deltas) {
      const nextScreen = response.screen ?? "";
      updateText(
        nextScreen,
        nextScreen.replace(/\r\n/g, "\n").split("\n"),
        nextCursor,
        contextKey,
        isUserScrolling,
        immediate,
      );
      return;
    }
    const applied = applyScreenDeltas(receivedLines, response.deltas ?? []);
    if (!applied.ok) {
      cursor = null;
      return;
    }
    updateText(
      applied.lines.join("\n"),
      applied.lines,
      nextCursor,
      contextKey,
      isUserScrolling,
      immediate,
    );
  };
  const flushPending = () => {
    if (pendingText == null) return;
    const pending = pendingText;
    pendingText = null;
    startTransition(() => {
      setScreen(pending.screen);
      setImageBase64(null);
      setScreenContentContextKey(pending.contextKey);
    });
    displayedText = pending.screen;
    displayedImage = null;
  };
  const clearPending = () => {
    pendingText = null;
  };
  const resetDeltaBase = () => {
    cursor = null;
    receivedLines = [];
  };
  const reset = () => {
    resetDeltaBase();
    displayedText = "";
    displayedImage = null;
    pendingText = null;
    setScreen("");
    setImageBase64(null);
    setScreenContentContextKey(null);
  };

  return {
    applyResponse,
    getCursor: () => cursor,
    hasContent: (mode: ScreenMode) =>
      mode === "image" ? displayedImage != null : displayedText.length > 0,
    invalidateCursor: () => {
      cursor = null;
    },
    resetDeltaBase,
    flushPending,
    clearPending,
    reset,
  };
};

export type ScreenContent = ReturnType<typeof createScreenContent>;
