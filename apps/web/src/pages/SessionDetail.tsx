import {
  type CommitDetail,
  type CommitFileDiff,
  type CommitLog,
  defaultDangerCommandPatterns,
  defaultDangerKeys,
  type DiffFile,
  type DiffSummary,
} from "@tmux-agent-monitor/shared";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { useStickToBottom } from "use-stick-to-bottom";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { renderAnsi } from "@/lib/ansi";
import {
  initialScreenLoadingState,
  screenLoadingReducer,
  type ScreenMode,
} from "@/lib/screen-loading";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

const stateTone = (state: string) => {
  switch (state) {
    case "RUNNING":
      return "running";
    case "WAITING_INPUT":
      return "waiting";
    case "WAITING_PERMISSION":
      return "permission";
    default:
      return "unknown";
  }
};

const compilePatterns = () =>
  defaultDangerCommandPatterns.map((pattern) => new RegExp(pattern, "i"));

const AUTO_REFRESH_INTERVAL_MS = 15_000;
const DISCONNECTED_MESSAGE = "Disconnected. Reconnecting...";
const backLinkClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-latte-surface2 bg-transparent px-3 py-1.5 text-xs font-semibold text-latte-subtext0 transition hover:bg-latte-crust hover:text-latte-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-latte-lavender";
const formatPath = (value: string | null) => {
  if (!value) return "—";
  const match = value.match(/^\/(Users|home)\/[^/]+(\/.*)?$/);
  if (match) {
    return `~${match[2] ?? ""}`;
  }
  return value;
};

const formatRelativeTime = (value: string | null, nowMs: number) => {
  if (!value) return "-";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "-";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
};

const getLastInputTone = (value: string | null, nowMs: number) => {
  if (!value) {
    return {
      pill: "border-latte-surface2/70 bg-latte-crust/60 text-latte-subtext0",
      dot: "bg-latte-subtext0",
    };
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return {
      pill: "border-latte-surface2/70 bg-latte-crust/60 text-latte-subtext0",
      dot: "bg-latte-subtext0",
    };
  }
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 300) {
    return {
      pill: "border-latte-green/40 bg-latte-green/10 text-latte-green",
      dot: "bg-latte-green shadow-[0_0_8px_rgba(64,160,43,0.6)]",
    };
  }
  if (diffSec < 1800) {
    return {
      pill: "border-latte-yellow/40 bg-latte-yellow/10 text-latte-yellow",
      dot: "bg-latte-yellow shadow-[0_0_8px_rgba(223,142,29,0.6)]",
    };
  }
  if (diffSec < 7200) {
    return {
      pill: "border-latte-peach/40 bg-latte-peach/10 text-latte-peach",
      dot: "bg-latte-peach shadow-[0_0_8px_rgba(239,159,118,0.6)]",
    };
  }
  return {
    pill: "border-latte-red/40 bg-latte-red/10 text-latte-red",
    dot: "bg-latte-red shadow-[0_0_8px_rgba(210,15,57,0.6)]",
  };
};

const isDangerousText = (text: string) => {
  const patterns = compilePatterns();
  const normalized = text.replace(/\r\n/g, "\n").split("\n");
  return normalized.some((line) =>
    patterns.some((pattern) => pattern.test(line.toLowerCase().replace(/\s+/g, " ").trim())),
  );
};

const diffLineClass = (line: string) => {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) {
    return "text-latte-subtext0";
  }
  if (line.startsWith("@@")) {
    return "text-latte-lavender";
  }
  if (line.startsWith("+")) {
    return "text-latte-green";
  }
  if (line.startsWith("-")) {
    return "text-latte-red";
  }
  return "text-latte-text";
};

const diffStatusClass = (status: string) => {
  switch (status) {
    case "A":
      return "text-latte-green";
    case "M":
      return "text-latte-yellow";
    case "D":
      return "text-latte-red";
    case "R":
    case "C":
      return "text-latte-lavender";
    case "U":
      return "text-latte-peach";
    default:
      return "text-latte-subtext0";
  }
};

const formatTimestamp = (value: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const buildDiffSummarySignature = (summary: DiffSummary) => {
  const files = summary.files
    .map((file) => ({
      path: file.path,
      status: file.status,
      staged: file.staged,
      renamedFrom: file.renamedFrom ?? null,
      additions: file.additions ?? null,
      deletions: file.deletions ?? null,
    }))
    .sort((a, b) => {
      const pathCompare = a.path.localeCompare(b.path);
      if (pathCompare !== 0) return pathCompare;
      const statusCompare = a.status.localeCompare(b.status);
      if (statusCompare !== 0) return statusCompare;
      if (a.staged !== b.staged) return a.staged ? 1 : -1;
      return (a.renamedFrom ?? "").localeCompare(b.renamedFrom ?? "");
    });
  return JSON.stringify({
    repoRoot: summary.repoRoot ?? null,
    rev: summary.rev ?? null,
    truncated: summary.truncated ?? false,
    reason: summary.reason ?? null,
    files,
  });
};

const buildCommitLogSignature = (log: CommitLog) =>
  JSON.stringify({
    repoRoot: log.repoRoot ?? null,
    rev: log.rev ?? null,
    reason: log.reason ?? null,
    commits: log.commits.map((commit) => commit.hash),
  });

const KeyButton = ({
  label,
  onClick,
  danger,
  disabled,
  ariaLabel,
}: {
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <Button
    variant={danger ? "danger" : "ghost"}
    size="sm"
    onClick={onClick}
    className="min-w-[70px]"
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {label}
  </Button>
);

export const SessionDetailPage = () => {
  const { paneId: paneIdEncoded } = useParams();
  const paneId = paneIdEncoded ?? "";
  const {
    connected,
    connectionIssue,
    getSessionDetail,
    reconnect,
    requestCommitDetail,
    requestCommitFile,
    requestCommitLog,
    requestDiffFile,
    requestDiffSummary,
    requestScreen,
    sendText,
    sendKeys,
    updateSessionTitle,
    readOnly,
  } = useSessions();
  const { resolvedTheme } = useTheme();
  const session = getSessionDetail(paneId);
  const sessionCustomTitle = session?.customTitle ?? null;
  const sessionAutoTitle = session?.title ?? session?.sessionName ?? "";
  const sessionDisplayTitle = sessionCustomTitle ?? sessionAutoTitle;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastInputTone = getLastInputTone(session?.lastInputAt ?? null, nowMs);
  const [mode, setMode] = useState<ScreenMode>("text");
  const [screen, setScreen] = useState<string>("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [autoEnter, setAutoEnter] = useState(true);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [screenLoadingState, dispatchScreenLoading] = useReducer(
    screenLoadingReducer,
    initialScreenLoadingState,
  );
  const [modeLoaded, setModeLoaded] = useState({ text: false, image: false });
  const [controlsOpen, setControlsOpen] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffFiles, setDiffFiles] = useState<Record<string, DiffFile>>({});
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [diffLoadingFiles, setDiffLoadingFiles] = useState<Record<string, boolean>>({});
  const [commitLog, setCommitLog] = useState<CommitLog | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitLoadingMore, setCommitLoadingMore] = useState(false);
  const [commitHasMore, setCommitHasMore] = useState(true);
  const [commitDetails, setCommitDetails] = useState<Record<string, CommitDetail>>({});
  const [commitFileDetails, setCommitFileDetails] = useState<Record<string, CommitFileDiff>>({});
  const [commitFileOpen, setCommitFileOpen] = useState<Record<string, boolean>>({});
  const [commitFileLoading, setCommitFileLoading] = useState<Record<string, boolean>>({});
  const [commitOpen, setCommitOpen] = useState<Record<string, boolean>>({});
  const [commitLoadingDetails, setCommitLoadingDetails] = useState<Record<string, boolean>>({});
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const diffOpenRef = useRef<Record<string, boolean>>({});
  const diffSignatureRef = useRef<string | null>(null);
  const commitLogRef = useRef<CommitLog | null>(null);
  const commitSignatureRef = useRef<string | null>(null);
  const commitCopyTimeoutRef = useRef<number | null>(null);
  const modeLoadedRef = useRef(modeLoaded);
  const modeSwitchRef = useRef<ScreenMode | null>(null);
  const refreshInFlightRef = useRef<null | { id: number; mode: ScreenMode }>(null);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const renderedScreen = useMemo(
    () => renderAnsi(screen || "No screen data", resolvedTheme),
    [screen, resolvedTheme],
  );
  const commitPageSize = 10;
  const { scrollRef, contentRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevModeRef = useRef<ScreenMode>(mode);
  const snapToBottomRef = useRef(false);
  const isScreenLoading = screenLoadingState.loading && screenLoadingState.mode === mode;
  const updateScrollState = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    setIsAtBottom(distanceFromBottom <= 8);
  }, [scrollRef]);

  useEffect(() => {
    const prevMode = prevModeRef.current;
    if (prevMode === "image" && mode === "text") {
      snapToBottomRef.current = true;
    }
    prevModeRef.current = mode;
  }, [mode]);

  useLayoutEffect(() => {
    if (!snapToBottomRef.current || mode !== "text") {
      return;
    }
    void scrollToBottom({ animation: "instant", ignoreEscapes: true });
    snapToBottomRef.current = false;
  }, [mode, screen, renderedScreen, scrollToBottom]);

  useLayoutEffect(() => {
    if (mode !== "text") {
      setIsAtBottom(true);
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distanceFromBottom <= 8) {
      void scrollToBottom({ animation: "instant" });
    }
    setIsAtBottom(distanceFromBottom <= 8);
  }, [mode, renderedScreen, scrollRef, scrollToBottom]);

  useEffect(() => {
    if (mode !== "text") {
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const handleScroll = () => updateScrollState();
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    updateScrollState();
    return () => {
      scrollEl.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [mode, scrollRef, updateScrollState]);

  const refreshScreen = useCallback(async () => {
    if (!paneId) return;
    if (!connected) {
      refreshInFlightRef.current = null;
      modeSwitchRef.current = null;
      dispatchScreenLoading({ type: "reset" });
      if (!connectionIssue) {
        setError(DISCONNECTED_MESSAGE);
      }
      return;
    }
    const requestId = (refreshRequestIdRef.current += 1);
    const inflight = refreshInFlightRef.current;
    const isModeOverride = inflight && inflight.mode !== mode;
    if (inflight && !isModeOverride) {
      return;
    }
    const isModeSwitch = modeSwitchRef.current === mode;
    const shouldShowLoading = isModeSwitch || !modeLoadedRef.current[mode];
    setError(null);
    if (shouldShowLoading) {
      dispatchScreenLoading({ type: "start", mode });
    }
    refreshInFlightRef.current = { id: requestId, mode };
    try {
      const response = await requestScreen(paneId, { mode });
      if (refreshInFlightRef.current?.id !== requestId) {
        return;
      }
      if (!response.ok) {
        setError(response.error?.message ?? "Failed to capture screen");
        return;
      }
      setFallbackReason(response.fallbackReason ?? null);
      if (response.mode === "image") {
        setImageBase64(response.imageBase64 ?? null);
        setScreen("");
      } else {
        setScreen(response.screen ?? "");
        setImageBase64(null);
      }
      setModeLoaded((prev) => ({ ...prev, [mode]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screen request failed");
    } finally {
      if (refreshInFlightRef.current?.id === requestId) {
        refreshInFlightRef.current = null;
        if (shouldShowLoading) {
          dispatchScreenLoading({ type: "finish", mode });
        }
        if (isModeSwitch && modeSwitchRef.current === mode) {
          modeSwitchRef.current = null;
        }
      }
    }
  }, [connected, connectionIssue, mode, paneId, requestScreen]);

  useEffect(() => {
    refreshScreen();
  }, [refreshScreen]);

  useEffect(() => {
    if (!connected) {
      refreshInFlightRef.current = null;
      modeSwitchRef.current = null;
      dispatchScreenLoading({ type: "reset" });
      if (!connectionIssue && !error) {
        setError(DISCONNECTED_MESSAGE);
      }
      return;
    }
    if (error === DISCONNECTED_MESSAGE) {
      setError(null);
    }
  }, [connected, connectionIssue, error]);

  useEffect(() => {
    if (!paneId || !connected) {
      return;
    }
    const intervalMs = mode === "image" ? 2000 : 1000;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      refreshScreen();
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, mode, paneId, refreshScreen]);

  const applyDiffSummary = useCallback(
    async (summary: DiffSummary, refreshOpenFiles: boolean) => {
      setDiffSummary(summary);
      setDiffFiles({});
      const fileSet = new Set(summary.files.map((file) => file.path));
      setDiffOpen((prev) => {
        if (!summary.files.length) {
          return {};
        }
        const next: Record<string, boolean> = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (fileSet.has(key)) {
            next[key] = value;
          }
        });
        return next;
      });
      const openTargets = Object.entries(diffOpenRef.current).filter(
        ([path, value]) => value && fileSet.has(path),
      );
      if (openTargets.length > 0 && refreshOpenFiles) {
        await Promise.all(
          openTargets.map(async ([path]) => {
            try {
              const file = await requestDiffFile(paneId, path, summary.rev, { force: true });
              setDiffFiles((prev) => ({ ...prev, [path]: file }));
            } catch (err) {
              setDiffError(err instanceof Error ? err.message : "Failed to load diff file");
            }
          }),
        );
      }
    },
    [paneId, requestDiffFile],
  );

  const loadDiffSummary = useCallback(async () => {
    if (!paneId) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const summary = await requestDiffSummary(paneId, { force: true });
      await applyDiffSummary(summary, true);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : "Failed to load diff summary");
    } finally {
      setDiffLoading(false);
    }
  }, [applyDiffSummary, paneId, requestDiffSummary]);

  const pollDiffSummary = useCallback(async () => {
    if (!paneId) return;
    try {
      const summary = await requestDiffSummary(paneId, { force: true });
      const signature = buildDiffSummarySignature(summary);
      if (signature === diffSignatureRef.current) {
        return;
      }
      setDiffError(null);
      await applyDiffSummary(summary, true);
    } catch {
      return;
    }
  }, [applyDiffSummary, paneId, requestDiffSummary]);

  const loadDiffFile = useCallback(
    async (path: string) => {
      if (!paneId || !diffSummary?.rev) return;
      if (diffLoadingFiles[path]) return;
      setDiffLoadingFiles((prev) => ({ ...prev, [path]: true }));
      try {
        const file = await requestDiffFile(paneId, path, diffSummary.rev, { force: true });
        setDiffFiles((prev) => ({ ...prev, [path]: file }));
      } catch (err) {
        setDiffError(err instanceof Error ? err.message : "Failed to load diff file");
      } finally {
        setDiffLoadingFiles((prev) => ({ ...prev, [path]: false }));
      }
    },
    [diffLoadingFiles, diffSummary?.rev, paneId, requestDiffFile],
  );

  const applyCommitLog = useCallback(
    (log: CommitLog, options: { append: boolean; updateSignature: boolean }) => {
      setCommitLog((prev) => {
        const prevCommits = options.append && prev ? prev.commits : [];
        const merged = options.append ? [...prevCommits, ...log.commits] : log.commits;
        const unique = new Map<string, (typeof merged)[number]>();
        merged.forEach((commit) => {
          if (!unique.has(commit.hash)) {
            unique.set(commit.hash, commit);
          }
        });
        return {
          ...log,
          commits: Array.from(unique.values()),
        };
      });
      if (!options.append) {
        const commitSet = new Set(log.commits.map((commit) => commit.hash));
        setCommitDetails((prev) => {
          const next: Record<string, CommitDetail> = {};
          Object.entries(prev).forEach(([hash, detail]) => {
            if (commitSet.has(hash)) {
              next[hash] = detail;
            }
          });
          return next;
        });
        setCommitFileDetails((prev) => {
          const next: Record<string, CommitFileDiff> = {};
          Object.entries(prev).forEach(([key, detail]) => {
            const [hash] = key.split(":");
            if (hash && commitSet.has(hash)) {
              next[key] = detail;
            }
          });
          return next;
        });
        setCommitFileOpen((prev) => {
          const next: Record<string, boolean> = {};
          Object.entries(prev).forEach(([key, value]) => {
            const [hash] = key.split(":");
            if (hash && commitSet.has(hash)) {
              next[key] = value;
            }
          });
          return next;
        });
        setCommitFileLoading((prev) => {
          const next: Record<string, boolean> = {};
          Object.entries(prev).forEach(([key, value]) => {
            const [hash] = key.split(":");
            if (hash && commitSet.has(hash)) {
              next[key] = value;
            }
          });
          return next;
        });
        setCommitOpen((prev) => {
          if (!log.commits.length) {
            return {};
          }
          const next: Record<string, boolean> = {};
          Object.entries(prev).forEach(([hash, value]) => {
            if (commitSet.has(hash)) {
              next[hash] = value;
            }
          });
          return next;
        });
      }
      setCommitHasMore(log.commits.length === commitPageSize);
      if (options.updateSignature) {
        commitSignatureRef.current = buildCommitLogSignature(log);
      }
    },
    [commitPageSize],
  );

  const loadCommitLog = useCallback(
    async (options?: { append?: boolean; force?: boolean }) => {
      if (!paneId) return;
      const append = options?.append ?? false;
      if (append) {
        setCommitLoadingMore(true);
      } else {
        setCommitLoading(true);
      }
      setCommitError(null);
      try {
        const skip = append ? (commitLogRef.current?.commits.length ?? 0) : 0;
        const log = await requestCommitLog(paneId, {
          limit: commitPageSize,
          skip,
          force: options?.force,
        });
        applyCommitLog(log, { append, updateSignature: !append });
      } catch (err) {
        if (!append) {
          setCommitError(err instanceof Error ? err.message : "Failed to load commit log");
        }
      } finally {
        if (append) {
          setCommitLoadingMore(false);
        } else {
          setCommitLoading(false);
        }
      }
    },
    [applyCommitLog, commitPageSize, paneId, requestCommitLog],
  );

  const loadCommitDetail = useCallback(
    async (hash: string) => {
      if (!paneId || commitLoadingDetails[hash]) return;
      setCommitLoadingDetails((prev) => ({ ...prev, [hash]: true }));
      try {
        const detail = await requestCommitDetail(paneId, hash, { force: true });
        setCommitDetails((prev) => ({ ...prev, [hash]: detail }));
      } catch (err) {
        setCommitError(err instanceof Error ? err.message : "Failed to load commit detail");
      } finally {
        setCommitLoadingDetails((prev) => ({ ...prev, [hash]: false }));
      }
    },
    [commitLoadingDetails, paneId, requestCommitDetail],
  );

  const loadCommitFile = useCallback(
    async (hash: string, path: string) => {
      if (!paneId) return;
      const key = `${hash}:${path}`;
      if (commitFileLoading[key]) return;
      setCommitFileLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const file = await requestCommitFile(paneId, hash, path, { force: true });
        setCommitFileDetails((prev) => ({ ...prev, [key]: file }));
      } catch (err) {
        setCommitError(err instanceof Error ? err.message : "Failed to load commit file");
      } finally {
        setCommitFileLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [commitFileLoading, paneId, requestCommitFile],
  );

  const pollCommitLog = useCallback(async () => {
    if (!paneId) return;
    try {
      const log = await requestCommitLog(paneId, {
        limit: commitPageSize,
        skip: 0,
        force: true,
      });
      const signature = buildCommitLogSignature(log);
      if (signature === commitSignatureRef.current) {
        return;
      }
      setCommitError(null);
      applyCommitLog(log, { append: false, updateSignature: true });
    } catch {
      return;
    }
  }, [applyCommitLog, commitPageSize, paneId, requestCommitLog]);

  useEffect(() => {
    loadDiffSummary();
  }, [loadDiffSummary]);

  useEffect(() => {
    if (!paneId || !connected) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void pollDiffSummary();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, paneId, pollDiffSummary]);

  useEffect(() => {
    setDiffSummary(null);
    setDiffFiles({});
    setDiffOpen({});
    setDiffError(null);
    diffSignatureRef.current = null;
  }, [paneId]);

  useEffect(() => {
    diffOpenRef.current = diffOpen;
  }, [diffOpen]);

  useEffect(() => {
    diffSignatureRef.current = diffSummary ? buildDiffSummarySignature(diffSummary) : null;
  }, [diffSummary]);

  useEffect(() => {
    commitLogRef.current = commitLog;
  }, [commitLog]);

  useEffect(() => {
    setCommitLog(null);
    setCommitDetails({});
    setCommitFileDetails({});
    setCommitFileOpen({});
    setCommitFileLoading({});
    setCommitOpen({});
    setCommitError(null);
    setCommitHasMore(true);
    setCommitLoading(false);
    setCommitLoadingMore(false);
    setCommitLoadingDetails({});
    setCopiedHash(null);
    commitSignatureRef.current = null;
    commitLogRef.current = null;
    if (commitCopyTimeoutRef.current) {
      window.clearTimeout(commitCopyTimeoutRef.current);
      commitCopyTimeoutRef.current = null;
    }
  }, [paneId]);

  useEffect(() => {
    loadCommitLog({ force: true });
  }, [loadCommitLog]);

  useEffect(() => {
    if (!paneId || !connected) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void pollCommitLog();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, paneId, pollCommitLog]);

  useEffect(() => {
    return () => {
      if (commitCopyTimeoutRef.current) {
        window.clearTimeout(commitCopyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    modeLoadedRef.current = modeLoaded;
  }, [modeLoaded]);

  useEffect(() => {
    setModeLoaded({ text: false, image: false });
    dispatchScreenLoading({ type: "reset" });
    modeSwitchRef.current = null;
  }, [paneId]);

  useEffect(() => {
    setTitleEditing(false);
    setTitleSaving(false);
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
  }, [paneId, sessionCustomTitle]);

  useEffect(() => {
    if (titleEditing) return;
    setTitleDraft(sessionCustomTitle ?? "");
  }, [sessionCustomTitle, titleEditing]);

  const openTitleEditor = useCallback(() => {
    if (readOnly || !session) return;
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
    setTitleEditing(true);
  }, [readOnly, session, sessionCustomTitle]);

  const closeTitleEditor = useCallback(() => {
    setTitleEditing(false);
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
  }, [sessionCustomTitle]);

  const handleTitleSave = useCallback(async () => {
    if (!session || titleSaving) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length > 80) {
      setTitleError("Title must be 80 characters or less.");
      return;
    }
    setTitleSaving(true);
    try {
      await updateSessionTitle(session.paneId, trimmed.length > 0 ? trimmed : null);
      setTitleEditing(false);
      setTitleError(null);
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Failed to update title");
    } finally {
      setTitleSaving(false);
    }
  }, [session, titleDraft, titleSaving, updateSessionTitle]);

  const handleTitleClear = useCallback(async () => {
    if (!session || titleSaving) return;
    setTitleSaving(true);
    try {
      await updateSessionTitle(session.paneId, null);
      setTitleEditing(false);
      setTitleDraft("");
      setTitleError(null);
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Failed to update title");
    } finally {
      setTitleSaving(false);
    }
  }, [session, titleSaving, updateSessionTitle]);

  const mapKeyWithModifiers = useCallback(
    (key: string) => {
      if (shiftHeld && key === "Tab") {
        return "BTab";
      }
      if (ctrlHeld) {
        const ctrlMap: Record<string, string> = {
          Left: "C-Left",
          Right: "C-Right",
          Up: "C-Up",
          Down: "C-Down",
          Tab: "C-Tab",
          Enter: "C-Enter",
          Escape: "C-Escape",
          BTab: "C-BTab",
        };
        if (ctrlMap[key]) {
          return ctrlMap[key];
        }
      }
      return key;
    },
    [ctrlHeld, shiftHeld],
  );

  const handleSendKey = async (key: string) => {
    if (readOnly) return;
    const mapped = mapKeyWithModifiers(key);
    const hasDanger = defaultDangerKeys.includes(mapped);
    if (hasDanger) {
      const confirmed = window.confirm("Dangerous key detected. Send anyway?");
      if (!confirmed) return;
    }
    const result = await sendKeys(paneId, [mapped]);
    if (!result.ok) {
      setError(result.error?.message ?? "Failed to send keys");
    }
  };

  const handleSendText = async () => {
    if (readOnly) return;
    const currentValue = textInputRef.current?.value ?? "";
    if (!currentValue.trim()) return;
    if (isDangerousText(currentValue)) {
      const confirmed = window.confirm("Dangerous command detected. Send anyway?");
      if (!confirmed) return;
    }
    const result = await sendText(paneId, currentValue, autoEnter);
    if (!result.ok) {
      setError(result.error?.message ?? "Failed to send text");
      return;
    }
    if (textInputRef.current) {
      textInputRef.current.value = "";
    }
    if (mode === "text") {
      void scrollToBottom({ animation: "instant", ignoreEscapes: true });
    }
  };

  const handleToggleDiff = (path: string) => {
    setDiffOpen((prev) => {
      const nextOpen = !prev[path];
      if (nextOpen) {
        void loadDiffFile(path);
      }
      return { ...prev, [path]: nextOpen };
    });
  };

  const handleToggleCommit = (hash: string) => {
    setCommitOpen((prev) => {
      const nextOpen = !prev[hash];
      if (nextOpen && !commitDetails[hash]) {
        void loadCommitDetail(hash);
      }
      return { ...prev, [hash]: nextOpen };
    });
  };

  const handleToggleCommitFile = (hash: string, path: string) => {
    const key = `${hash}:${path}`;
    setCommitFileOpen((prev) => {
      const nextOpen = !prev[key];
      if (nextOpen && !commitFileDetails[key]) {
        void loadCommitFile(hash, path);
      }
      return { ...prev, [key]: nextOpen };
    });
  };

  const handleCopyHash = useCallback(async (hash: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(hash);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = hash;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
    if (!copied) return;
    setCopiedHash(hash);
    if (commitCopyTimeoutRef.current) {
      window.clearTimeout(commitCopyTimeoutRef.current);
    }
    commitCopyTimeoutRef.current = window.setTimeout(() => {
      setCopiedHash((prev) => (prev === hash ? null : prev));
    }, 1200);
  }, []);

  const renderDiffPatch = (patch: string) =>
    patch.split("\n").map((line, index) => (
      <span key={`${index}-${line.slice(0, 12)}`} className={diffLineClass(line)}>
        {line}
        {"\n"}
      </span>
    ));

  const tabLabel = "Tab";
  const agentTone =
    session?.agent === "codex" ? "codex" : session?.agent === "claude" ? "claude" : "unknown";
  const agentLabel =
    session?.agent === "codex" ? "CODEX" : session?.agent === "claude" ? "CLAUDE" : "UNKNOWN";

  if (!session) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10">
        <Card>
          <p className="text-latte-subtext0 text-sm">Session not found.</p>
          <Link to="/" className={`${backLinkClass} mt-4`}>
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className={backLinkClass}>
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Link>
        <ThemeToggle />
      </div>
      <header className="shadow-glass border-latte-surface1/60 bg-latte-base/80 flex flex-col gap-4 rounded-[32px] border p-6 backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {titleEditing ? (
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    if (titleError) {
                      setTitleError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleTitleSave();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeTitleEditor();
                    }
                  }}
                  onBlur={() => {
                    if (titleSaving) return;
                    closeTitleEditor();
                  }}
                  placeholder={sessionAutoTitle || "Untitled session"}
                  maxLength={80}
                  enterKeyHint="done"
                  disabled={titleSaving}
                  className="border-latte-surface2 text-latte-text focus:border-latte-lavender focus:ring-latte-lavender/30 bg-latte-base/70 min-w-[180px] flex-1 rounded-2xl border px-3 py-1.5 text-xl shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Custom session title"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={openTitleEditor}
                  disabled={readOnly}
                  className={`font-display text-latte-text text-left text-xl transition ${
                    readOnly ? "cursor-default" : "hover:text-latte-lavender cursor-text"
                  } disabled:opacity-70`}
                  aria-label="Edit session title"
                >
                  {sessionDisplayTitle}
                </button>
              )}
              {sessionCustomTitle && !readOnly && !titleEditing && (
                <button
                  type="button"
                  onClick={handleTitleClear}
                  disabled={titleSaving}
                  className="border-latte-surface2 text-latte-subtext0 hover:text-latte-red hover:border-latte-red/60 inline-flex h-6 w-6 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Clear custom title"
                  title="Clear custom title"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-4">
              <p className="text-latte-subtext0 text-sm">{formatPath(session.currentPath)}</p>
              <div className="text-latte-overlay1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                  Session {session.sessionName}
                </span>
                <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                  Window {session.windowIndex}
                </span>
                <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                  Pane {session.paneId}
                </span>
              </div>
            </div>
            {titleError && <p className="text-latte-red text-xs">{titleError}</p>}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={stateTone(session.state)}>{session.state}</Badge>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={agentTone}>{agentLabel}</Badge>
              <span
                className={`${lastInputTone.pill} inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${lastInputTone.dot}`} />
                <span className="text-[9px] uppercase tracking-[0.2em]">Last input</span>
                <span>{formatRelativeTime(session.lastInputAt, nowMs)}</span>
              </span>
            </div>
          </div>
        </div>
        {session.pipeConflict && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-sm">
            Another pipe-pane is attached. Screen is capture-only.
          </div>
        )}
        {readOnly && (
          <div className="border-latte-peach/50 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-sm">
            Read-only mode is active. Actions are disabled.
          </div>
        )}
        {connectionIssue && (
          <div className="border-latte-peach/50 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-sm">
            {connectionIssue}
          </div>
        )}
      </header>

      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex min-w-0 flex-col gap-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tabs
                value={mode}
                onValueChange={(value) => {
                  if ((value === "text" || value === "image") && value !== mode) {
                    const nextMode = value;
                    if (!connected) {
                      modeSwitchRef.current = null;
                      dispatchScreenLoading({ type: "reset" });
                      setMode(nextMode);
                      return;
                    }
                    modeSwitchRef.current = nextMode;
                    dispatchScreenLoading({ type: "start", mode: nextMode });
                    setMode(nextMode);
                  }
                }}
              >
                <TabsList aria-label="Screen mode">
                  <TabsTrigger value="text">Text</TabsTrigger>
                  <TabsTrigger value="image">Image</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (connected ? refreshScreen() : reconnect())}
              aria-label={connected ? "Refresh screen" : "Reconnect"}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">{connected ? "Refresh" : "Reconnect"}</span>
            </Button>
          </div>
          {fallbackReason && (
            <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
              Image fallback: {fallbackReason}
            </div>
          )}
          {error && (
            <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
              {error}
            </div>
          )}
          <div className="border-latte-surface1 bg-latte-mantle/40 relative flex min-h-[320px] w-full min-w-0 max-w-full flex-1 overflow-hidden rounded-2xl border p-5">
            {isScreenLoading && (
              <div className="bg-latte-base/60 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
                <div className="border-latte-lavender/40 border-t-latte-lavender h-8 w-8 animate-spin rounded-full border-2" />
              </div>
            )}
            {mode === "image" && imageBase64 ? (
              <div className="flex w-full items-center justify-center">
                <img
                  src={`data:image/png;base64,${imageBase64}`}
                  alt="screen"
                  className="border-latte-surface2 max-h-[480px] w-full rounded-xl border object-contain"
                />
              </div>
            ) : (
              <>
                <div
                  ref={scrollRef}
                  className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto"
                  style={{ maxHeight: "60vh" }}
                >
                  <div ref={contentRef}>
                    <pre
                      className="text-latte-text w-max whitespace-pre font-mono text-xs"
                      dangerouslySetInnerHTML={{ __html: renderedScreen }}
                    />
                  </div>
                </div>
                {!isAtBottom && (
                  <button
                    type="button"
                    onClick={() => scrollToBottom({ animation: "smooth", ignoreEscapes: true })}
                    aria-label="Scroll to bottom"
                    className="border-latte-surface2 bg-latte-base/80 text-latte-text hover:border-latte-lavender/60 hover:text-latte-lavender focus-visible:ring-latte-lavender absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-md backdrop-blur transition focus-visible:outline-none focus-visible:ring-2"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="pt-4">
            {!readOnly ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <textarea
                    placeholder="Type a prompt…"
                    ref={textInputRef}
                    rows={2}
                    disabled={!connected}
                    className="border-latte-surface2 text-latte-text focus:border-latte-lavender focus:ring-latte-lavender/30 bg-latte-base/70 min-h-[64px] min-w-0 flex-1 resize-y rounded-2xl border px-4 py-2 text-base shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
                  />
                  <div className="flex shrink-0 items-center self-center">
                    <Button onClick={handleSendText} aria-label="Send" className="h-11 w-11 p-0">
                      <Send className="h-4 w-4" />
                      <span className="sr-only">Send</span>
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setControlsOpen((prev) => !prev)}
                    aria-expanded={controlsOpen}
                    aria-controls="session-controls"
                    className="text-latte-subtext0 flex items-center gap-2 text-[11px] uppercase tracking-[0.32em]"
                  >
                    {controlsOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Keys
                  </Button>
                  <button
                    type="button"
                    onClick={() => setAutoEnter((prev) => !prev)}
                    aria-pressed={autoEnter}
                    title="Auto-enter after send"
                    className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] transition ${
                      autoEnter
                        ? "border-latte-lavender/60 bg-latte-lavender/10 text-latte-lavender shadow-[inset_0_0_0_1px_rgba(114,135,253,0.12)]"
                        : "border-latte-surface2/70 text-latte-subtext0 hover:border-latte-overlay1 hover:text-latte-text"
                    }`}
                  >
                    <span className="text-[9px] font-semibold tracking-[0.3em]">Auto</span>
                    <CornerDownLeft className="h-3.5 w-3.5" />
                    <span className="sr-only">Auto-enter</span>
                  </button>
                </div>
                {controlsOpen && (
                  <div id="session-controls" className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant={shiftHeld ? "primary" : "ghost"}
                          size="sm"
                          onClick={() => setShiftHeld((prev) => !prev)}
                          aria-pressed={shiftHeld}
                          className="font-mono text-[11px] uppercase tracking-[0.3em]"
                        >
                          Shift
                        </Button>
                        <Button
                          variant={ctrlHeld ? "primary" : "ghost"}
                          size="sm"
                          onClick={() => setCtrlHeld((prev) => !prev)}
                          aria-pressed={ctrlHeld}
                          className="font-mono text-[11px] uppercase tracking-[0.3em]"
                        >
                          Ctrl
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Esc", key: "Escape" },
                        { label: tabLabel, key: "Tab" },
                        { label: "Enter", key: "Enter" },
                      ].map((item) => (
                        <KeyButton
                          key={item.key}
                          label={item.label}
                          onClick={() => handleSendKey(item.key)}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {[
                        {
                          label: (
                            <>
                              <ArrowLeft className="h-4 w-4" />
                              <span className="sr-only">Left</span>
                            </>
                          ),
                          key: "Left",
                          ariaLabel: "Left",
                        },
                        {
                          label: (
                            <>
                              <ArrowUp className="h-4 w-4" />
                              <span className="sr-only">Up</span>
                            </>
                          ),
                          key: "Up",
                          ariaLabel: "Up",
                        },
                        {
                          label: (
                            <>
                              <ArrowDown className="h-4 w-4" />
                              <span className="sr-only">Down</span>
                            </>
                          ),
                          key: "Down",
                          ariaLabel: "Down",
                        },
                        {
                          label: (
                            <>
                              <ArrowRight className="h-4 w-4" />
                              <span className="sr-only">Right</span>
                            </>
                          ),
                          key: "Right",
                          ariaLabel: "Right",
                        },
                      ].map((item) => (
                        <KeyButton
                          key={item.key}
                          label={item.label}
                          ariaLabel={item.ariaLabel}
                          onClick={() => handleSendKey(item.key)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-latte-peach/50 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-sm">
                Read-only mode is active. Interactive controls are hidden.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-latte-subtext0 text-xs uppercase tracking-[0.3em]">Changes</p>
            <p className="text-latte-text text-sm">
              {diffSummary?.files.length ?? 0} file
              {(diffSummary?.files.length ?? 0) === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadDiffSummary}
            disabled={diffLoading}
            aria-label="Refresh changes"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
        {diffSummary?.repoRoot && (
          <p className="text-latte-subtext0 text-xs">Repo: {formatPath(diffSummary.repoRoot)}</p>
        )}
        {diffLoading && <p className="text-latte-subtext0 text-sm">Loading diff…</p>}
        {diffSummary?.reason === "cwd_unknown" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Working directory is unknown for this session.
          </div>
        )}
        {diffSummary?.reason === "not_git" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Current directory is not a git repository.
          </div>
        )}
        {diffSummary?.reason === "error" && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            Failed to load git status.
          </div>
        )}
        {diffError && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            {diffError}
          </div>
        )}
        {!diffLoading && diffSummary && diffSummary.files.length === 0 && !diffSummary.reason && (
          <p className="text-latte-subtext0 text-sm">No changes detected.</p>
        )}
        <div className="flex flex-col gap-2">
          {diffSummary?.files.map((file) => {
            const isOpen = Boolean(diffOpen[file.path]);
            const loadingFile = Boolean(diffLoadingFiles[file.path]);
            const fileData = diffFiles[file.path];
            const statusLabel = file.status === "?" ? "U" : file.status;
            const additionsLabel =
              file.additions === null || typeof file.additions === "undefined"
                ? "—"
                : String(file.additions);
            const deletionsLabel =
              file.deletions === null || typeof file.deletions === "undefined"
                ? "—"
                : String(file.deletions);
            return (
              <div
                key={`${file.path}-${file.status}`}
                className="border-latte-surface2/70 bg-latte-base/70 rounded-2xl border"
              >
                <button
                  type="button"
                  onClick={() => handleToggleDiff(file.path)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`${diffStatusClass(
                        statusLabel,
                      )} text-[10px] font-semibold uppercase tracking-[0.25em]`}
                    >
                      {statusLabel}
                    </span>
                    <span className="text-latte-text truncate text-sm">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-latte-green">+{additionsLabel}</span>
                    <span className="text-latte-red">-{deletionsLabel}</span>
                    {isOpen ? (
                      <ChevronUp className="text-latte-subtext0 h-4 w-4" />
                    ) : (
                      <ChevronDown className="text-latte-subtext0 h-4 w-4" />
                    )}
                    <span className="sr-only">{isOpen ? "Hide" : "Show"}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-latte-surface2/70 border-t px-4 py-3">
                    {loadingFile && <p className="text-latte-subtext0 text-xs">Loading diff…</p>}
                    {!loadingFile && fileData?.binary && (
                      <p className="text-latte-subtext0 text-xs">Binary file (no diff).</p>
                    )}
                    {!loadingFile && !fileData?.binary && fileData?.patch && (
                      <div className="max-h-[360px] overflow-auto">
                        <pre className="whitespace-pre pl-4 font-mono text-xs">
                          {renderDiffPatch(fileData.patch)}
                        </pre>
                        {fileData.truncated && (
                          <p className="text-latte-subtext0 mt-2 text-xs">Diff truncated.</p>
                        )}
                      </div>
                    )}
                    {!loadingFile && !fileData?.binary && !fileData?.patch && (
                      <p className="text-latte-subtext0 text-xs">No diff available.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-latte-subtext0 text-xs uppercase tracking-[0.3em]">Commit Log</p>
            <p className="text-latte-text text-sm">
              {commitLog?.commits.length ?? 0} commit
              {(commitLog?.commits.length ?? 0) === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadCommitLog({ force: true })}
            disabled={commitLoading}
            aria-label="Refresh commit log"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
        {commitLog?.repoRoot && (
          <p className="text-latte-subtext0 text-xs">Repo: {formatPath(commitLog.repoRoot)}</p>
        )}
        {commitLoading && <p className="text-latte-subtext0 text-sm">Loading commits…</p>}
        {commitLog?.reason === "cwd_unknown" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Working directory is unknown for this session.
          </div>
        )}
        {commitLog?.reason === "not_git" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Current directory is not a git repository.
          </div>
        )}
        {commitLog?.reason === "error" && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            Failed to load commit log.
          </div>
        )}
        {commitError && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            {commitError}
          </div>
        )}
        {!commitLoading && commitLog && commitLog.commits.length === 0 && !commitLog.reason && (
          <p className="text-latte-subtext0 text-sm">No commits found.</p>
        )}
        <div className="flex flex-col gap-2">
          {commitLog?.commits.map((commit) => {
            const isOpen = Boolean(commitOpen[commit.hash]);
            const detail = commitDetails[commit.hash];
            const loadingDetail = Boolean(commitLoadingDetails[commit.hash]);
            const commitBody = detail?.body ?? commit.body;
            return (
              <div
                key={commit.hash}
                className="border-latte-surface2/70 bg-latte-base/70 rounded-2xl border"
              >
                <div className="flex w-full flex-wrap items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => handleCopyHash(commit.hash)}
                    className="border-latte-surface2/70 text-latte-subtext0 hover:text-latte-text flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.2em] transition"
                    aria-label={`Copy commit hash ${commit.shortHash}`}
                  >
                    <span className="font-mono">{commit.shortHash}</span>
                    {copiedHash === commit.hash ? (
                      <Check className="text-latte-green h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-latte-text text-sm">{commit.subject}</p>
                      <p className="text-latte-subtext0 text-xs">
                        {commit.authorName} · {formatTimestamp(commit.authoredAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleCommit(commit.hash)}
                      className="ml-auto flex items-center border-0 px-2 text-xs"
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <span className="sr-only">{isOpen ? "Hide" : "Show"}</span>
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-latte-surface2/70 border-t px-4 py-3">
                    {loadingDetail && (
                      <p className="text-latte-subtext0 text-xs">Loading commit…</p>
                    )}
                    {!loadingDetail && commitBody && (
                      <pre className="text-latte-subtext0 mb-3 whitespace-pre-wrap text-xs">
                        {commitBody}
                      </pre>
                    )}
                    {!loadingDetail && detail?.files && detail.files.length > 0 && (
                      <div className="flex flex-col gap-2 text-xs">
                        {detail.files.map((file) => {
                          const statusLabel = file.status === "?" ? "U" : file.status;
                          const fileKey = `${commit.hash}:${file.path}`;
                          const fileOpen = Boolean(commitFileOpen[fileKey]);
                          const fileDetail = commitFileDetails[fileKey];
                          const loadingFile = Boolean(commitFileLoading[fileKey]);
                          const additions =
                            file.additions === null || typeof file.additions === "undefined"
                              ? "—"
                              : String(file.additions);
                          const deletions =
                            file.deletions === null || typeof file.deletions === "undefined"
                              ? "—"
                              : String(file.deletions);
                          const pathLabel = file.renamedFrom
                            ? `${file.renamedFrom} → ${file.path}`
                            : file.path;
                          return (
                            <div
                              key={`${file.path}-${file.status}`}
                              className="flex flex-col gap-2"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={`${diffStatusClass(
                                      statusLabel,
                                    )} text-[10px] font-semibold uppercase tracking-[0.25em]`}
                                  >
                                    {statusLabel}
                                  </span>
                                  <span className="text-latte-text truncate">{pathLabel}</span>
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                                  <span className="text-latte-green">+{additions}</span>
                                  <span className="text-latte-red">-{deletions}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCommitFile(commit.hash, file.path)}
                                    className="text-latte-subtext0 hover:text-latte-text inline-flex items-center gap-1"
                                  >
                                    {fileOpen ? (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                    <span className="sr-only">{fileOpen ? "Hide" : "Show"}</span>
                                  </button>
                                </div>
                              </div>
                              {fileOpen && (
                                <div className="border-latte-surface2/70 bg-latte-base/60 rounded-xl border px-3 py-2">
                                  {loadingFile && (
                                    <p className="text-latte-subtext0 text-xs">Loading diff…</p>
                                  )}
                                  {!loadingFile && fileDetail?.binary && (
                                    <p className="text-latte-subtext0 text-xs">
                                      Binary file (no diff).
                                    </p>
                                  )}
                                  {!loadingFile && !fileDetail?.binary && fileDetail?.patch && (
                                    <div className="max-h-[240px] overflow-auto">
                                      <pre className="whitespace-pre pl-4 font-mono text-xs">
                                        {renderDiffPatch(fileDetail.patch)}
                                      </pre>
                                      {fileDetail.truncated && (
                                        <p className="text-latte-subtext0 mt-2 text-xs">
                                          Diff truncated.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {!loadingFile && !fileDetail?.binary && !fileDetail?.patch && (
                                    <p className="text-latte-subtext0 text-xs">
                                      No diff available.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!loadingDetail && detail?.files && detail.files.length === 0 && (
                      <p className="text-latte-subtext0 text-xs">No files changed.</p>
                    )}
                    {!loadingDetail && !detail && (
                      <p className="text-latte-subtext0 text-xs">No commit details.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {commitLog && commitHasMore && !commitLog.reason && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadCommitLog({ append: true, force: true })}
            disabled={commitLoadingMore}
          >
            {commitLoadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </Card>
    </div>
  );
};
