import { BarChart3, LayoutGrid, RefreshCw, Search, X } from "lucide-react";
import {
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Button,
  Callout,
  ConnectionStatusPill,
  FilterToggleGroup,
  Input,
  Toolbar,
} from "@/components/ui";

type SessionListHeaderProps = {
  connectionStatus: "healthy" | "degraded" | "disconnected";
  connectionIssue: string | null;
  transport?: "sse" | "polling";
  filter: string;
  searchQuery: string;
  filterOptions: { value: string; label: string }[];
  onFilterChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  onRefresh: () => void;
  onOpenChatGrid: () => void;
  onOpenUsage: () => void;
  themeControl?: ReactNode;
};

const SEARCH_INPUT_DEBOUNCE_MS = 180;

const handleClearMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
};

type SessionListSearchInputProps = {
  initialSearchQuery: string;
  onSearchQueryChange: (value: string) => void;
};

const SessionListSearchInput = ({
  initialSearchQuery,
  onSearchQueryChange,
}: SessionListSearchInputProps) => {
  const [draftSearchQuery, setDraftSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);
  const suppressNextDebounceRef = useRef(false);
  const clearTriggeredRef = useRef(false);
  const publishedSearchQueryRef = useRef(initialSearchQuery);
  const activeSearchQuery = isFocused ? draftSearchQuery : initialSearchQuery;

  useEffect(() => {
    publishedSearchQueryRef.current = initialSearchQuery;
  }, [initialSearchQuery]);

  const publishSearchQuery = useCallback(
    (value: string) => {
      if (publishedSearchQueryRef.current === value) {
        return;
      }
      publishedSearchQueryRef.current = value;
      onSearchQueryChange(value);
    },
    [onSearchQueryChange],
  );

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    if (suppressNextDebounceRef.current) {
      suppressNextDebounceRef.current = false;
      return;
    }
    if (draftSearchQuery === initialSearchQuery) {
      return;
    }
    const debounceMs = draftSearchQuery.length === 0 ? 0 : SEARCH_INPUT_DEBOUNCE_MS;
    const timeoutId = window.setTimeout(() => {
      debounceTimerRef.current = null;
      publishSearchQuery(draftSearchQuery);
    }, debounceMs);
    debounceTimerRef.current = timeoutId;

    return () => {
      window.clearTimeout(timeoutId);
      if (debounceTimerRef.current === timeoutId) {
        debounceTimerRef.current = null;
      }
    };
  }, [draftSearchQuery, initialSearchQuery, isFocused, publishSearchQuery]);

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    clearTriggeredRef.current = false;
    setIsFocused(true);
    setDraftSearchQuery(event.target.value);
  };
  const handleFocus = () => {
    clearTriggeredRef.current = false;
    suppressNextDebounceRef.current = false;
    setDraftSearchQuery(initialSearchQuery);
    setIsFocused(true);
  };
  const handleBlur = () => {
    const skipBlurCommit = clearTriggeredRef.current;
    clearTriggeredRef.current = false;
    suppressNextDebounceRef.current = false;
    setIsFocused(false);
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (skipBlurCommit) {
      return;
    }
    if (draftSearchQuery !== initialSearchQuery) {
      publishSearchQuery(draftSearchQuery);
    }
  };
  const handleClear = () => {
    clearTriggeredRef.current = isFocused;
    if (isFocused) {
      suppressNextDebounceRef.current = true;
    }
    setDraftSearchQuery("");
    publishSearchQuery("");
  };

  return (
    <div className="border-latte-surface2/80 text-latte-text focus-within:border-latte-blue focus-within:ring-latte-blue/25 bg-latte-crust/32 relative overflow-hidden rounded-2xl border shadow-[0_1px_3px_rgb(var(--ctp-shadow)/0.08)] transition-[border-color,box-shadow,background-color] duration-200 focus-within:bg-latte-base/82 focus-within:ring-2">
      <Search className="text-latte-subtext0 pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
      <Input
        value={activeSearchQuery}
        onChange={handleSearchChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="Search sessions"
        aria-label="Search sessions"
        className="h-10 border-none bg-transparent py-0 pl-11 pr-12 text-base shadow-none focus:ring-0 sm:pl-11 sm:pr-12 sm:text-sm"
      />
      {activeSearchQuery.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
          onMouseDown={handleClearMouseDown}
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

export const SessionListHeader = ({
  connectionStatus,
  connectionIssue,
  transport,
  filter,
  searchQuery,
  filterOptions,
  onFilterChange,
  onSearchQueryChange,
  onRefresh,
  onOpenChatGrid,
  onOpenUsage,
  themeControl,
}: SessionListHeaderProps) => {
  const connectionIssueLines = connectionIssue
    ? connectionIssue
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
  const lineCounts = new Map<string, number>();
  const connectionIssueRows = connectionIssueLines.map((line) => {
    const count = lineCounts.get(line) ?? 0;
    lineCounts.set(line, count + 1);
    return {
      key: `${line}-${count}`,
      line,
    };
  });

  return (
    <header className="animate-fade-in stagger-1 flex flex-col gap-3 rounded-3xl border border-[var(--material-stroke)] bg-[var(--material-canvas)] p-3 shadow-[var(--material-shadow)] backdrop-blur-2xl sm:gap-4 sm:p-5">
      <Toolbar className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 sm:flex sm:items-center sm:gap-3">
        <div className="min-w-0">
          <p className="text-latte-subtext0 text-xs font-medium uppercase tracking-[0.16em]">
            VDE Monitor
          </p>
          <h1 className="font-display text-latte-text text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
            Live Sessions
          </h1>
        </div>
        <div className="col-span-2 row-start-2 flex items-center sm:col-auto sm:row-auto sm:ml-auto">
          <ConnectionStatusPill status={connectionStatus} transport={transport} />
        </div>
        <div
          role="toolbar"
          aria-label="Session list actions"
          className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 self-center sm:col-auto sm:row-auto"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-7 gap-1.5 px-2.5 text-[11px] uppercase tracking-[0.1em] lg:inline-flex"
            onClick={onOpenUsage}
          >
            Usage
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-7 gap-1.5 px-2.5 text-[11px] uppercase tracking-[0.1em] lg:inline-flex"
            onClick={onOpenChatGrid}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Chat Grid
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative h-7 w-7 p-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] lg:hidden"
            onClick={onOpenUsage}
            aria-label="Usage"
            title="Usage"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative hidden h-7 w-7 p-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] md:inline-flex lg:hidden"
            onClick={onOpenChatGrid}
            aria-label="Open Chat Grid"
            title="Chat Grid"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="relative h-7 w-7 p-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
            onClick={onRefresh}
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
          {themeControl}
        </div>
      </Toolbar>
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto] lg:items-center">
        <SessionListSearchInput
          initialSearchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
        />
        <FilterToggleGroup
          value={filter}
          onChange={onFilterChange}
          buttonClassName="px-3 text-[11px] uppercase tracking-[0.08em]"
          options={filterOptions}
          className="gap-x-1.5 gap-y-2"
        />
      </div>
      {connectionIssueLines.length > 0 && (
        <Callout tone="warning" size="sm">
          {connectionIssueRows.map((item) => (
            <p
              key={item.key}
              className={item.key === connectionIssueRows[0]?.key ? undefined : "mt-1"}
            >
              {item.line}
            </p>
          ))}
        </Callout>
      )}
    </header>
  );
};
