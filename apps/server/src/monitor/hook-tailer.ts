import { claudeHookEventSchema, type HookStateSignal } from "@vde-monitor/shared";

import { deriveHookState, mapHookToPane } from "./monitor-utils.js";

export type HookEventContext = {
  paneId: string;
  hookState: HookStateSignal;
};

export type HookPaneSnapshot = {
  paneId: string;
  paneTty: string | null;
  currentPath: string | null;
};

export const handleHookLine = (
  line: string,
  panes: HookPaneSnapshot[],
  onHook: (context: HookEventContext) => void,
) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const result = claudeHookEventSchema.safeParse(parsed);
  if (!result.success) {
    return false;
  }
  const event = result.data;
  const hookState = deriveHookState(event.hook_event_name, event.notification_type);
  if (!hookState) {
    return false;
  }
  const paneId = mapHookToPane(panes, {
    tmux_pane: event.tmux_pane ?? null,
    tty: event.tty,
    cwd: event.cwd,
  });
  if (!paneId) {
    return false;
  }
  onHook({ paneId, hookState: { ...hookState, at: event.ts } });
  return true;
};
