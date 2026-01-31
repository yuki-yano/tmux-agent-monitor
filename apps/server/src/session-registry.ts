import type { SessionDetail, SessionSummary } from "@tmux-agent-monitor/shared";

export type SessionChangeListener = (session: SessionSummary) => void;
export type SessionRemovedListener = (paneId: string) => void;

const toSummary = (detail: SessionDetail): SessionSummary => {
  const { startCommand: _startCommand, panePid: _panePid, ...summary } = detail;
  void _startCommand;
  void _panePid;
  return summary;
};

export const createSessionRegistry = () => {
  const sessions = new Map<string, SessionDetail>();
  const changeListeners = new Set<SessionChangeListener>();
  const removedListeners = new Set<SessionRemovedListener>();

  const snapshot = (): SessionSummary[] => {
    return Array.from(sessions.values()).map(toSummary);
  };

  const getDetail = (paneId: string): SessionDetail | null => {
    return sessions.get(paneId) ?? null;
  };

  const update = (detail: SessionDetail) => {
    const existing = sessions.get(detail.paneId);
    const next = detail;
    sessions.set(detail.paneId, next);

    const changed =
      !existing || JSON.stringify(toSummary(existing)) !== JSON.stringify(toSummary(next));
    if (changed) {
      const summary = toSummary(next);
      changeListeners.forEach((listener) => listener(summary));
    }
  };

  const removeMissing = (activePaneIds: Set<string>) => {
    const removed: string[] = [];
    sessions.forEach((_, paneId) => {
      if (!activePaneIds.has(paneId)) {
        sessions.delete(paneId);
        removed.push(paneId);
        removedListeners.forEach((listener) => listener(paneId));
      }
    });
    return removed;
  };

  const onChanged = (listener: SessionChangeListener) => {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  };

  const onRemoved = (listener: SessionRemovedListener) => {
    removedListeners.add(listener);
    return () => removedListeners.delete(listener);
  };

  const values = () => Array.from(sessions.values());

  return { snapshot, getDetail, update, removeMissing, onChanged, onRemoved, values };
};
