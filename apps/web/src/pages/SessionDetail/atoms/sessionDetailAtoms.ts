import type {
  AllowedKey,
  CommandResponse,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffSummary,
  HighlightCorrectionConfig,
  ImageAttachment,
  RawItem,
  ScreenResponse,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionSummary,
} from "@vde-monitor/shared";
import { atom } from "jotai";

import type { Theme } from "@/lib/theme";

export type SessionApi = {
  reconnect: () => void;
  requestDiffSummary: (paneId: string, options?: { force?: boolean }) => Promise<DiffSummary>;
  requestDiffFile: (
    paneId: string,
    path: string,
    rev?: string | null,
    options?: { force?: boolean },
  ) => Promise<DiffFile>;
  requestCommitLog: (
    paneId: string,
    options?: { limit?: number; skip?: number; force?: boolean },
  ) => Promise<CommitLog>;
  requestCommitDetail: (
    paneId: string,
    hash: string,
    options?: { force?: boolean },
  ) => Promise<CommitDetail>;
  requestCommitFile: (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean },
  ) => Promise<CommitFileDiff>;
  requestStateTimeline: (
    paneId: string,
    options?: { range?: SessionStateTimelineRange; limit?: number },
  ) => Promise<SessionStateTimeline>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  focusPane: (paneId: string) => Promise<CommandResponse>;
  uploadImageAttachment: (paneId: string, file: File) => Promise<ImageAttachment>;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  touchSession: (paneId: string) => Promise<void>;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
};

export type ConnectionStatus = "healthy" | "degraded" | "disconnected";

export const paneIdAtom = atom<string | null>(null);
export const sessionsAtom = atom<SessionSummary[]>([]);
export const connectedAtom = atom(false);
export const connectionStatusAtom = atom<ConnectionStatus>("degraded");
export const connectionIssueAtom = atom<string | null>(null);
export const highlightCorrectionsAtom = atom<HighlightCorrectionConfig>({
  codex: true,
  claude: true,
});
export const resolvedThemeAtom = atom<Theme>("latte");
export const sessionApiAtom = atom<SessionApi | null>(null);

export const currentSessionAtom = atom((get) => {
  const paneId = get(paneIdAtom);
  if (!paneId) return null;
  return get(sessionsAtom).find((session) => session.paneId === paneId) ?? null;
});
