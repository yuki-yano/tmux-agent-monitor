import type { HookStateSignal } from "@vde-monitor/shared";

export type PaneRuntimeState = {
  hookState: HookStateSignal | null;
  lastOutputAt: string | null;
  lastEventAt: string | null;
  lastMessage: string | null;
  lastInputAt: string | null;
  lastFingerprint: string | null;
};

const createDefaultState = (): PaneRuntimeState => ({
  hookState: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastMessage: null,
  lastInputAt: null,
  lastFingerprint: null,
});

export const createPaneStateStore = () => {
  const store = new Map<string, PaneRuntimeState>();

  const get = (paneId: string) => {
    let state = store.get(paneId);
    if (!state) {
      state = createDefaultState();
      store.set(paneId, state);
    }
    return state;
  };

  const remove = (paneId: string) => {
    store.delete(paneId);
  };

  const pruneMissing = (activePaneIds: Set<string>) => {
    store.forEach((_state, paneId) => {
      if (!activePaneIds.has(paneId)) {
        store.delete(paneId);
      }
    });
  };

  return { get, remove, pruneMissing };
};

export const updateOutputAt = (state: PaneRuntimeState, next: string | null) => {
  if (!next) {
    return state.lastOutputAt;
  }
  const nextTs = Date.parse(next);
  if (Number.isNaN(nextTs)) {
    return state.lastOutputAt;
  }
  const prevTs = state.lastOutputAt ? Date.parse(state.lastOutputAt) : null;
  if (!prevTs || Number.isNaN(prevTs) || nextTs > prevTs) {
    state.lastOutputAt = new Date(nextTs).toISOString();
  }
  return state.lastOutputAt;
};
