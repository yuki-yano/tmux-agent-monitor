import type { RepoFileContent } from "@vde-monitor/shared";
import { Check, Copy, ListOrdered, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Callout,
  Card,
  FilePathLabel,
  IconButton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Theme } from "@/lib/theme";

import { ShikiCodeBlock } from "./ShikiCodeBlock";

type FileContentModalState = {
  open: boolean;
  path: string | null;
  loading: boolean;
  error: string | null;
  file: RepoFileContent | null;
  markdownViewMode: "code" | "preview" | "diff";
  diffAvailable: boolean;
  diffLoading: boolean;
  diffPatch: string | null;
  diffBinary: boolean;
  diffError: string | null;
  showLineNumbers: boolean;
  copiedPath: boolean;
  copyError: string | null;
  highlightLine: number | null;
  theme: Theme;
};

const resolveCodeSource = (children: unknown): string => {
  if (
    typeof children === "string" ||
    typeof children === "number" ||
    typeof children === "bigint"
  ) {
    return String(children);
  }
  return Array.isArray(children) ? children.map(resolveCodeSource).join("") : "";
};

type FileContentModalActions = {
  onClose: () => void;
  onToggleLineNumbers: () => void;
  onCopyPath: () => Promise<void>;
  onMarkdownViewModeChange: (mode: "code" | "preview" | "diff") => void;
  onLoadDiff: (path: string) => void;
};

type FileContentModalProps = {
  state: FileContentModalState;
  actions: FileContentModalActions;
};

const markdownPathPattern = /\.(md|markdown)$/i;
const htmlPathPattern = /\.html?$/i;

const isMarkdownContent = (file: RepoFileContent | null, path: string | null) => {
  if (file?.languageHint === "markdown") {
    return true;
  }
  if (file?.path && markdownPathPattern.test(file.path)) {
    return true;
  }
  if (path && markdownPathPattern.test(path)) {
    return true;
  }
  return false;
};

const isHtmlContent = (file: RepoFileContent | null, path: string | null) => {
  if (file?.languageHint === "html") {
    return true;
  }
  if (file?.path && htmlPathPattern.test(file.path)) {
    return true;
  }
  if (path && htmlPathPattern.test(path)) {
    return true;
  }
  return false;
};

const FileContentModalHeader = ({
  activePath,
  title,
  file,
  showLineNumbers,
  copiedPath,
  onToggleLineNumbers,
  onCopyPath,
  onClose,
}: {
  activePath: string;
  title: string;
  file: RepoFileContent | null;
  showLineNumbers: boolean;
  copiedPath: boolean;
  onToggleLineNumbers: () => void;
  onCopyPath: () => Promise<void>;
  onClose: () => void;
}) => (
  <div className="flex min-w-0 items-start gap-2 rounded-2xl px-2 py-2 sm:px-3 sm:py-2.5 md:px-3.5">
    <div className="min-w-0 flex-1">
      {activePath.length > 0 ? (
        <FilePathLabel
          path={activePath}
          size="sm"
          tailSegments={4}
          dirTruncate="segments"
          className="font-mono"
        />
      ) : (
        <p className="text-latte-text truncate font-mono text-sm font-semibold" title={title}>
          {title}
        </p>
      )}
      {file?.truncated ? (
        <p className="text-latte-subtext0 mt-1 text-xs">
          Showing only the first {file.content?.length ?? 0} bytes.
        </p>
      ) : null}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        type="button"
        variant={showLineNumbers ? "lavenderStrong" : "lavender"}
        size="sm"
        onClick={onToggleLineNumbers}
        aria-label={showLineNumbers ? "Hide line numbers" : "Show line numbers"}
      >
        <ListOrdered className="h-4 w-4" />
      </IconButton>
      <IconButton
        type="button"
        variant={copiedPath ? "lavenderStrong" : "lavender"}
        size="sm"
        onClick={() => {
          void onCopyPath();
        }}
        aria-label={copiedPath ? "File path copied" : "Copy file path"}
      >
        {copiedPath ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </IconButton>
      <IconButton
        type="button"
        variant="dangerOutline"
        size="sm"
        onClick={onClose}
        aria-label="Close file content modal"
      >
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
);

const FileContentModalBody = ({
  loading,
  error,
  file,
  previewImageSrc,
  htmlPreviewSrc,
  activePath,
  markdownEnabled,
  htmlEnabled,
  resolvedViewMode,
  markdownComponents,
  effectiveCode,
  effectiveLanguage,
  theme,
  showLineNumbers,
  highlightLine,
  diffLoading,
  diffError,
  diffBinary,
  diffPatch,
}: {
  loading: boolean;
  error: string | null;
  file: RepoFileContent | null;
  previewImageSrc: string | null;
  htmlPreviewSrc: string | null;
  activePath: string;
  markdownEnabled: boolean;
  htmlEnabled: boolean;
  resolvedViewMode: "code" | "preview" | "diff";
  markdownComponents: Components;
  effectiveCode: string;
  effectiveLanguage: string | null;
  theme: Theme;
  showLineNumbers: boolean;
  highlightLine: number | null;
  diffLoading: boolean;
  diffError: string | null;
  diffBinary: boolean;
  diffPatch: string | null;
}) => {
  const previewEnabled = markdownEnabled || (htmlEnabled && htmlPreviewSrc != null);

  return (
    <div className="border-latte-surface2/55 bg-latte-crust/65 relative min-h-0 flex-1 overflow-hidden rounded-xl border p-0">
      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 px-3 sm:px-4">
          <Spinner size="sm" />
          <span className="text-latte-subtext0 text-xs">Loading file...</span>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="p-3 sm:p-4">
          <Callout tone="error" size="xs">
            {error}
          </Callout>
        </div>
      ) : null}

      {!loading && !error && previewImageSrc && resolvedViewMode !== "diff" ? (
        <div className="flex h-full items-center justify-center p-2 sm:p-4">
          <img
            src={previewImageSrc}
            alt={`Preview of ${activePath || "image file"}`}
            className="border-latte-surface2/50 bg-latte-crust/80 max-h-full max-w-full rounded-lg border object-contain"
            loading="lazy"
          />
        </div>
      ) : null}

      {!loading && !error && file?.isBinary && !previewImageSrc && resolvedViewMode !== "diff" ? (
        <div className="p-3 sm:p-4">
          <Callout tone="warning" size="xs">
            Binary file preview is not available.
          </Callout>
        </div>
      ) : null}

      {!loading &&
      !error &&
      !file?.isBinary &&
      markdownEnabled &&
      resolvedViewMode === "preview" ? (
        <div className="custom-scrollbar h-full overflow-auto overscroll-contain">
          <article className="vde-markdown text-latte-text space-y-4 p-3 sm:p-4 md:p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {effectiveCode}
            </ReactMarkdown>
          </article>
        </div>
      ) : null}

      {!loading &&
      !error &&
      !file?.isBinary &&
      htmlEnabled &&
      htmlPreviewSrc &&
      resolvedViewMode === "preview" ? (
        <iframe
          title={`Preview of ${activePath || "HTML file"}`}
          src={htmlPreviewSrc}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
        />
      ) : null}

      {!loading &&
      !error &&
      !file?.isBinary &&
      !previewImageSrc &&
      resolvedViewMode !== "diff" &&
      (!previewEnabled || resolvedViewMode === "code") ? (
        <ShikiCodeBlock
          code={effectiveCode}
          language={effectiveLanguage}
          theme={theme}
          flush
          showLineNumbers={showLineNumbers}
          highlightLine={highlightLine}
          className="vde-file-content-modal-code h-full"
        />
      ) : null}

      {!loading && !error && resolvedViewMode === "diff" ? (
        diffLoading ? (
          <div className="flex h-full items-center justify-center gap-2 px-3 sm:px-4">
            <Spinner size="sm" />
            <span className="text-latte-subtext0 text-xs">Loading diff...</span>
          </div>
        ) : diffError ? (
          <div className="p-3 sm:p-4">
            <Callout tone="error" size="xs">
              {diffError}
            </Callout>
          </div>
        ) : diffBinary ? (
          <div className="p-3 sm:p-4">
            <Callout tone="warning" size="xs">
              Binary diff preview is not available.
            </Callout>
          </div>
        ) : diffPatch == null ? (
          <div className="p-3 sm:p-4">
            <Callout tone="warning" size="xs">
              No textual diff is available.
            </Callout>
          </div>
        ) : (
          <ShikiCodeBlock
            code={diffPatch}
            language="diff"
            theme={theme}
            flush
            showLineNumbers={showLineNumbers}
            highlightLine={null}
            className="vde-file-content-modal-code h-full"
          />
        )
      ) : null}
    </div>
  );
};

export const FileContentModal = ({ state, actions }: FileContentModalProps) => {
  const {
    open,
    path,
    loading,
    error,
    file,
    markdownViewMode,
    diffAvailable,
    diffLoading,
    diffPatch,
    diffBinary,
    diffError,
    showLineNumbers,
    copiedPath,
    copyError,
    highlightLine,
    theme,
  } = state;
  const { onClose, onToggleLineNumbers, onCopyPath, onMarkdownViewModeChange, onLoadDiff } =
    actions;

  const markdownEnabled = isMarkdownContent(file, path) && !file?.isBinary && !error && !loading;
  const htmlEnabled = isHtmlContent(file, path) && !file?.isBinary && !error && !loading;
  const previewUrl = file?.preview?.url ?? null;
  const htmlPreviewSrc = htmlEnabled ? previewUrl : null;
  const previewEnabled = markdownEnabled || htmlPreviewSrc != null;
  const activePath = path ?? file?.path ?? "";
  const title = activePath.length > 0 ? activePath : "File content";
  const effectiveCode = file?.content ?? "";
  const effectiveLanguage = htmlEnabled
    ? "html"
    : (file?.languageHint ?? (markdownEnabled ? "markdown" : null));
  const resolvedViewMode =
    markdownViewMode === "diff" && !diffAvailable
      ? "code"
      : markdownViewMode === "preview" && !previewEnabled
        ? "code"
        : markdownViewMode;
  const previewImageSrc = file?.preview?.mimeType.startsWith("image/") ? previewUrl : null;
  const showViewTabs = previewEnabled || diffAvailable;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || markdownViewMode !== "diff") {
      return;
    }
    if (!diffAvailable) {
      onMarkdownViewModeChange("code");
      return;
    }
    if (!activePath || diffPatch != null || diffBinary || diffLoading || diffError) {
      return;
    }
    onLoadDiff(activePath);
  }, [
    activePath,
    diffAvailable,
    diffBinary,
    diffError,
    diffLoading,
    diffPatch,
    markdownViewMode,
    onLoadDiff,
    onMarkdownViewModeChange,
    open,
  ]);

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-latte-blue-text decoration-latte-lavender/60 hover:text-latte-lavender-text underline underline-offset-4 transition-colors"
        >
          {children}
        </a>
      ),
      h1: ({ children, ...props }) => (
        <h1 {...props} className="mt-1 text-2xl font-semibold tracking-tight md:text-[1.7rem]">
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2
          {...props}
          className="border-latte-lavender/40 mt-8 border-b pb-2 text-xl font-semibold tracking-tight"
        >
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 {...props} className="mt-6 text-lg font-semibold">
          {children}
        </h3>
      ),
      p: ({ children, ...props }) => (
        <p {...props} className="text-latte-text text-[0.92rem] leading-7">
          {children}
        </p>
      ),
      ul: ({ children, ...props }) => (
        <ul
          {...props}
          className="marker:text-latte-lavender-text my-3 list-disc space-y-2 pl-5 text-[0.92rem] leading-7"
        >
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol
          {...props}
          className="marker:text-latte-blue-text my-3 list-decimal space-y-2 pl-5 text-[0.92rem] leading-7"
        >
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li {...props} className="marker:font-semibold">
          {children}
        </li>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote
          {...props}
          className="border-latte-peach/65 bg-latte-lavender/10 shadow-inner-highlight my-4 rounded-r-xl border-l-4 px-3 py-2.5 text-[0.9rem] leading-7 sm:px-4 sm:py-3"
        >
          {children}
        </blockquote>
      ),
      table: ({ children, ...props }) => (
        <div className="my-4 overflow-x-auto">
          <table
            {...props}
            className="border-latte-surface2/65 w-full min-w-[420px] border-collapse overflow-hidden rounded-xl border text-left text-[0.85rem]"
          >
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }) => (
        <thead {...props} className="bg-latte-lavender/15 text-latte-lavender-text">
          {children}
        </thead>
      ),
      th: ({ children, ...props }) => (
        <th
          {...props}
          className="border-latte-surface2/65 border-b px-2.5 py-1.5 font-semibold sm:px-3 sm:py-2"
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }) => (
        <td
          {...props}
          className="border-latte-surface2/55 border-t px-2.5 py-1.5 align-top leading-6 sm:px-3 sm:py-2"
        >
          {children}
        </td>
      ),
      hr: (props) => <hr {...props} className="border-latte-lavender/45 my-6" />,
      code: ({ children, className, ...props }) => {
        const source = resolveCodeSource(children).replace(/\n$/, "");
        const match = /language-([\w-]+)/.exec(className ?? "");
        if (!match) {
          return (
            <code
              {...props}
              className={cn(
                "bg-latte-surface0/75 text-latte-blue-text border-latte-lavender/30 rounded-md border px-1.5 py-0.5 font-mono text-[0.8rem]",
                className,
              )}
            >
              {children}
            </code>
          );
        }
        return (
          <ShikiCodeBlock
            code={source}
            language={match[1] ?? null}
            theme={theme}
            showLineNumbers={showLineNumbers}
            highlightLine={null}
            className="vde-file-content-modal-code"
          />
        );
      },
    }),
    [showLineNumbers, theme],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-1.5 sm:p-3 md:p-6">
      <button
        type="button"
        aria-label="Close file content modal backdrop"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <Card className="border-latte-lavender/25 bg-latte-mantle/95 shadow-modal ring-latte-overlay2/25 relative z-10 flex h-[min(calc(100dvh-var(--vde-pwa-tabs-offset,0px)-5rem),860px)] min-h-0 w-[min(1160px,calc(100vw-0.75rem))] flex-col gap-2 overflow-hidden rounded-3xl border-2 p-2.5 ring-1 ring-inset sm:h-[min(calc(100dvh-var(--vde-pwa-tabs-offset,0px)-5.5rem),860px)] sm:w-[min(1160px,calc(100vw-1.5rem))] sm:p-4 md:h-[min(92dvh,920px)] md:p-5">
        <FileContentModalHeader
          activePath={activePath}
          title={title}
          file={file}
          showLineNumbers={showLineNumbers}
          copiedPath={copiedPath}
          onToggleLineNumbers={onToggleLineNumbers}
          onCopyPath={onCopyPath}
          onClose={onClose}
        />

        {copyError ? (
          <Callout tone="error" size="xs">
            {copyError}
          </Callout>
        ) : null}

        {showViewTabs ? (
          <div className="flex items-center justify-end px-0.5">
            <Tabs
              value={resolvedViewMode}
              onValueChange={(nextValue) => {
                if (nextValue === "code" || nextValue === "preview" || nextValue === "diff") {
                  onMarkdownViewModeChange(nextValue);
                }
              }}
            >
              <TabsList>
                <TabsTrigger value="code">Code</TabsTrigger>
                {previewEnabled ? <TabsTrigger value="preview">Preview</TabsTrigger> : null}
                {diffAvailable ? <TabsTrigger value="diff">Diff</TabsTrigger> : null}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <FileContentModalBody
          loading={loading}
          error={error}
          file={file}
          previewImageSrc={previewImageSrc}
          htmlPreviewSrc={htmlPreviewSrc}
          activePath={activePath}
          markdownEnabled={markdownEnabled}
          htmlEnabled={htmlEnabled}
          resolvedViewMode={resolvedViewMode}
          markdownComponents={markdownComponents}
          effectiveCode={effectiveCode}
          effectiveLanguage={effectiveLanguage}
          theme={theme}
          showLineNumbers={showLineNumbers}
          highlightLine={highlightLine}
          diffLoading={diffLoading}
          diffError={diffError}
          diffBinary={diffBinary}
          diffPatch={diffPatch}
        />
      </Card>
    </div>
  );
};
