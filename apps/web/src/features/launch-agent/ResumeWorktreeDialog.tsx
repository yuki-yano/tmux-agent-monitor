import type { LaunchConfig, SessionSummary, WorktreeListEntry } from "@vde-monitor/shared";
import { GitBranch } from "lucide-react";
import type { Dispatch, FormEvent } from "react";
import { useEffect, useMemo, useReducer } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  LoadingOverlay,
  PillToggle,
  SettingRadioGroup,
  ZoomSafeInput,
  ZoomSafeTextarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { isVwManagedWorktreePath } from "@/lib/session-format";
import {
  type LaunchAgentHandler,
  type LaunchAgentRequestOptions,
  isFailedLaunchResponse,
} from "@/state/launch-agent-options";

import {
  normalizePathForDisplay,
  parseAgentOptions,
  toRepoRelativePath,
} from "./launch-agent-utils";

const isRepoRootPath = (targetPath: string, repoRoot: string | null) => {
  if (!repoRoot) {
    return false;
  }
  return normalizePathForDisplay(targetPath) === normalizePathForDisplay(repoRoot);
};

const formatRepoRootLabel = (branch: string | null | undefined) => {
  const normalizedBranch = branch?.trim();
  if (normalizedBranch) {
    return `repo root (${normalizedBranch})`;
  }
  return "repo root";
};

const launchAgentLabels = { codex: "Codex", claude: "Claude" } as const;
const launchLocationLabels = { pane: "Current Pane", window: "New Window" } as const;

const REQUIRED_REASON_MESSAGE: Record<string, string> = {
  not_found:
    "Failed to resolve existing session. Update Source Pane or Session ID override and retry.",
  ambiguous:
    "Multiple candidate sessions matched. Specify Session ID override or narrow Source Pane.",
  invalid_input: "Invalid resume input. Update Source Pane or Session ID override and retry.",
  unsupported: "Resume is not supported for this pane.",
};

const CLAUDE_REQUIRED_REASON_MESSAGE: Record<string, string> = {
  not_found: "Failed to resolve the current pane session. Refresh and retry.",
  ambiguous: "Failed to resolve the current pane session. Refresh and retry.",
  invalid_input: "Failed to resolve the current pane session. Refresh and retry.",
  unsupported: "Resume is not supported for this pane.",
};

type ResumeTarget = "pane" | "window";

type ResumeWorktreeFormState = {
  overrideAgentOptions: boolean;
  agentOptionsText: string;
  selectedWorktreePath: string;
  resumeTarget: ResumeTarget;
  sourcePaneId: string;
  sessionIdOverride: string;
  submitError: string | null;
  submitting: boolean;
};

type ResumeWorktreeFormAction =
  | { type: "setOverrideAgentOptions"; overrideAgentOptions: boolean }
  | { type: "setAgentOptionsText"; agentOptionsText: string }
  | { type: "setSelectedWorktreePath"; selectedWorktreePath: string }
  | { type: "setResumeTarget"; resumeTarget: ResumeTarget }
  | { type: "setSourcePaneId"; sourcePaneId: string }
  | { type: "setSessionIdOverride"; sessionIdOverride: string }
  | {
      type: "syncTargetWorktrees";
      targetWorktrees: WorktreeListEntry[];
      defaultWorktreePath: string | undefined;
    }
  | { type: "setSubmitError"; submitError: string | null }
  | { type: "startSubmitting" }
  | { type: "finishSubmitting"; submitError?: string };

const selectDefaultWorktreePath = (
  targetWorktrees: WorktreeListEntry[],
  defaultWorktreePath: string | undefined,
) =>
  targetWorktrees.find((entry) => entry.path === defaultWorktreePath)?.path ??
  targetWorktrees[0]?.path ??
  "";

const buildResumeWorktreeFormState = (
  sourceSession: SessionSummary,
  targetWorktrees: WorktreeListEntry[],
  launchOptionsDefaultText: string,
): ResumeWorktreeFormState => ({
  overrideAgentOptions: false,
  agentOptionsText: launchOptionsDefaultText,
  selectedWorktreePath: selectDefaultWorktreePath(
    targetWorktrees,
    sourceSession.worktreePath?.trim(),
  ),
  resumeTarget: "pane",
  sourcePaneId: sourceSession.paneId,
  sessionIdOverride: "",
  submitError: null,
  submitting: false,
});

const resumeWorktreeFormReducer = (
  state: ResumeWorktreeFormState,
  action: ResumeWorktreeFormAction,
): ResumeWorktreeFormState => {
  switch (action.type) {
    case "setOverrideAgentOptions":
      return { ...state, overrideAgentOptions: action.overrideAgentOptions };
    case "setAgentOptionsText":
      return { ...state, agentOptionsText: action.agentOptionsText };
    case "setSelectedWorktreePath":
      return { ...state, selectedWorktreePath: action.selectedWorktreePath };
    case "setResumeTarget":
      return { ...state, resumeTarget: action.resumeTarget };
    case "setSourcePaneId":
      return { ...state, sourcePaneId: action.sourcePaneId };
    case "setSessionIdOverride":
      return { ...state, sessionIdOverride: action.sessionIdOverride };
    case "syncTargetWorktrees": {
      if (action.targetWorktrees.length === 0) {
        return state.selectedWorktreePath === "" ? state : { ...state, selectedWorktreePath: "" };
      }
      if (action.targetWorktrees.some((entry) => entry.path === state.selectedWorktreePath)) {
        return state;
      }
      return {
        ...state,
        selectedWorktreePath: selectDefaultWorktreePath(
          action.targetWorktrees,
          action.defaultWorktreePath,
        ),
      };
    }
    case "setSubmitError":
      return { ...state, submitError: action.submitError };
    case "startSubmitting":
      return { ...state, submitError: null, submitting: true };
    case "finishSubmitting":
      return { ...state, submitting: false, submitError: action.submitError ?? null };
  }
};

type ResumeWorktreeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  sourceSession: SessionSummary;
  launchConfig: LaunchConfig;
  worktreeEntries: WorktreeListEntry[];
  worktreeRepoRoot: string | null;
  onLaunchAgentInSession: LaunchAgentHandler;
  className?: string;
};

type ResumeWorktreeOption = {
  value: string;
  label: string;
  labelClassName: string;
  description: string;
  title: string;
  descriptionClassName: string;
};

type ResumeWorktreeDialogBodyProps = {
  sessionName: string;
  sourceSession: SessionSummary;
  inheritedAgent: "codex" | "claude";
  hasSourcePane: boolean;
  selectedWorktree: WorktreeListEntry | null;
  selectedWorktreeRelativePath: string | null;
  worktreeRepoRoot: string | null;
  existingWorktreeOptions: ResumeWorktreeOption[];
  launchOptionsDefaultOneLine: string;
  resolvedSelectedWorktreePath: string;
  state: ResumeWorktreeFormState;
  dispatch: Dispatch<ResumeWorktreeFormAction>;
  className?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

const ResumeWorktreeDialogBody = ({
  sessionName,
  sourceSession,
  inheritedAgent,
  hasSourcePane,
  selectedWorktree,
  selectedWorktreeRelativePath,
  worktreeRepoRoot,
  existingWorktreeOptions,
  launchOptionsDefaultOneLine,
  resolvedSelectedWorktreePath,
  state,
  dispatch,
  className,
  onSubmit,
  onCancel,
}: ResumeWorktreeDialogBodyProps) => {
  const {
    overrideAgentOptions,
    agentOptionsText,
    resumeTarget,
    sourcePaneId,
    sessionIdOverride,
    submitError,
    submitting,
  } = state;
  const isClaudeAgent = inheritedAgent === "claude";
  const hasTargetWorktrees = existingWorktreeOptions.length > 0;

  return (
    <>
      <form className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" onSubmit={onSubmit}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
          {!isClaudeAgent ? (
            <div className="space-y-2">
              <p className="text-latte-subtext0 text-xs font-semibold uppercase tracking-[0.2em]">
                Agent Options
              </p>
              <p className="text-latte-subtext1 text-xs">
                Current agent:{" "}
                <span className="font-mono">{launchAgentLabels[inheritedAgent]}</span>
              </p>
              <label className="border-latte-surface2/80 bg-latte-mantle/45 text-latte-subtext0 hover:border-latte-lavender/35 hover:bg-latte-mantle/65 flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition">
                <input
                  aria-label="Override agent options"
                  className="accent-latte-lavender border-latte-surface2 bg-latte-base focus:ring-latte-lavender/40 h-3.5 w-3.5 rounded-sm border outline-hidden transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                  type="checkbox"
                  checked={overrideAgentOptions}
                  onChange={(event) =>
                    dispatch({
                      type: "setOverrideAgentOptions",
                      overrideAgentOptions: event.currentTarget.checked,
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="text-latte-text block text-xs font-semibold uppercase tracking-[0.06em]">
                    Override options
                  </span>
                  <span className="text-latte-subtext1 mt-0.5 block text-[11px]">
                    Enable to edit launch arguments manually.
                  </span>
                </span>
              </label>
              <div className="border-latte-surface2/80 bg-latte-base/55 rounded-2xl border p-3">
                {!overrideAgentOptions ? (
                  <p className="text-latte-subtext1 border-latte-surface2/80 bg-latte-base/60 w-full rounded-xl border border-dashed px-3 py-2 font-mono text-xs">
                    {launchOptionsDefaultOneLine || "(no default options)"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="border-latte-lavender/30 bg-latte-lavender/10 text-latte-lavender-text rounded-lg border px-2.5 py-1.5 font-mono text-[11px]">
                      Override format: each line is evaluated by shell as-is.
                    </p>
                    <div className="border-latte-surface2 bg-latte-base/80 text-latte-text focus-within:border-latte-lavender focus-within:ring-latte-lavender/25 overflow-hidden rounded-2xl border transition focus-within:ring-2">
                      <ZoomSafeTextarea
                        aria-label="Agent options override"
                        className="min-h-[112px] w-full resize-y bg-transparent px-3 py-2 font-mono text-base outline-hidden"
                        value={agentOptionsText}
                        onChange={(event) => {
                          dispatch({
                            type: "setAgentOptionsText",
                            agentOptionsText: event.target.value,
                          });
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-latte-subtext0 text-xs font-semibold uppercase tracking-[0.2em]">
              Launch Location
            </p>
            <div className="border-latte-surface2/80 bg-latte-base/55 space-y-3 rounded-2xl border p-3">
              <div className="flex items-center gap-2">
                <PillToggle
                  type="button"
                  active={resumeTarget === "pane"}
                  onClick={() => dispatch({ type: "setResumeTarget", resumeTarget: "pane" })}
                >
                  {launchLocationLabels.pane}
                </PillToggle>
                <PillToggle
                  type="button"
                  active={resumeTarget === "window"}
                  onClick={() => dispatch({ type: "setResumeTarget", resumeTarget: "window" })}
                  disabled={!hasSourcePane}
                >
                  {launchLocationLabels.window}
                </PillToggle>
              </div>
              {!hasSourcePane ? (
                <p className="text-latte-subtext1 text-xs">
                  Source pane is unavailable for this session.
                </p>
              ) : null}
              {resumeTarget === "window" ? (
                <p className="text-latte-subtext1 text-xs">
                  Source pane agent is stopped, then{" "}
                  <span className="font-mono">
                    {isClaudeAgent
                      ? "claude --resume <session-id> '!cd <worktree>'"
                      : "cd <worktree> && codex resume <session-id>"}
                  </span>{" "}
                  runs in a new window.
                </p>
              ) : null}
            </div>
          </div>

          {resumeTarget === "pane" ? (
            isClaudeAgent ? (
              <div className="space-y-2">
                <p className="text-latte-subtext0 text-xs font-semibold uppercase tracking-[0.2em]">
                  Existing Session
                </p>
                <div className="border-latte-surface2/80 bg-latte-base/55 space-y-2 rounded-2xl border p-3">
                  <p className="text-latte-subtext0 text-xs">
                    Claude keeps using the same pane for this action.
                  </p>
                  <p className="text-latte-subtext1 text-xs">
                    The agent is not restarted. vde-monitor sends{" "}
                    <span className="font-mono">!cd &lt;worktree&gt;</span> to move the worktree.
                  </p>
                  <p className="text-latte-subtext1 text-xs">
                    Session ID override is not required.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-latte-subtext0 text-xs font-semibold uppercase tracking-[0.2em]">
                  Existing Session
                </p>
                <div className="border-latte-surface2/80 bg-latte-base/55 space-y-3 rounded-2xl border p-3">
                  <p className="text-latte-subtext0 text-xs">
                    Existing session reuse is always enabled for this action.
                  </p>
                  <label htmlFor="resume-source-pane-id" className="space-y-1 text-xs">
                    <span className="text-latte-subtext0 block font-semibold uppercase tracking-[0.18em]">
                      Source Pane
                    </span>
                    <ZoomSafeInput
                      id="resume-source-pane-id"
                      value={sourcePaneId}
                      onChange={(event) =>
                        dispatch({
                          type: "setSourcePaneId",
                          sourcePaneId: event.target.value,
                        })
                      }
                      placeholder={sourceSession.paneId}
                      aria-label="Source Pane"
                      className="font-mono"
                    />
                  </label>
                  <label htmlFor="resume-session-id-override" className="space-y-1 text-xs">
                    <span className="text-latte-subtext0 block font-semibold uppercase tracking-[0.18em]">
                      Session ID Override
                    </span>
                    <ZoomSafeInput
                      id="resume-session-id-override"
                      value={sessionIdOverride}
                      onChange={(event) =>
                        dispatch({
                          type: "setSessionIdOverride",
                          sessionIdOverride: event.target.value,
                        })
                      }
                      placeholder="Optional"
                      aria-label="Session ID override"
                      className="font-mono"
                    />
                  </label>
                </div>
              </div>
            )
          ) : null}

          <div className="space-y-2">
            <p className="text-latte-subtext0 text-xs font-semibold uppercase tracking-[0.2em]">
              Target Worktree
            </p>
            <div className="border-latte-surface2/80 bg-latte-base/55 space-y-3 rounded-2xl border p-3">
              <div className="space-y-3">
                <p className="text-latte-subtext1 text-xs">
                  Select existing vw worktree or repo root.
                </p>
                {hasTargetWorktrees ? (
                  <SettingRadioGroup
                    ariaLabel="Existing worktrees"
                    name={`resume-worktree-${sessionName}`}
                    className="pr-1"
                    optionClassName="py-1.5"
                    value={resolvedSelectedWorktreePath}
                    onValueChange={(nextPath) =>
                      dispatch({
                        type: "setSelectedWorktreePath",
                        selectedWorktreePath: nextPath,
                      })
                    }
                    options={existingWorktreeOptions}
                  />
                ) : (
                  <p className="text-latte-subtext1 text-xs">
                    No existing vw worktree or repo root found.
                  </p>
                )}
                {selectedWorktree ? (
                  <p className="text-latte-subtext0 text-xs">
                    Current target:{" "}
                    <span className="font-mono">
                      {isRepoRootPath(selectedWorktree.path, worktreeRepoRoot)
                        ? formatRepoRootLabel(selectedWorktree.branch)
                        : (selectedWorktree.branch ??
                          selectedWorktreeRelativePath ??
                          selectedWorktree.path)}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {submitError ? <p className="text-latte-red-text text-xs">{submitError}</p> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-latte-subtext0 hover:text-latte-text rounded-md px-2 py-1 text-xs"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              "border-latte-blue/45 bg-latte-blue/15 text-latte-blue-text hover:bg-latte-blue/20 disabled:hover:bg-latte-blue/15 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
            disabled={submitting || !hasTargetWorktrees}
          >
            <span className="inline-flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Resume / Move
            </span>
          </button>
        </div>
      </form>
      {submitting ? <LoadingOverlay className="z-10 rounded-2xl" label="Launching..." /> : null}
    </>
  );
};

type ResumeWorktreeDialogOpenContentProps = Omit<ResumeWorktreeDialogProps, "open">;

const ResumeWorktreeDialogOpenContent = ({
  onOpenChange,
  sessionName,
  sourceSession,
  launchConfig,
  worktreeEntries,
  worktreeRepoRoot,
  onLaunchAgentInSession,
  className,
}: ResumeWorktreeDialogOpenContentProps) => {
  const inheritedAgent: "codex" | "claude" = sourceSession.agent === "claude" ? "claude" : "codex";
  const isClaudeAgent = inheritedAgent === "claude";

  const targetWorktrees = useMemo(() => {
    const filtered = worktreeEntries.filter(
      (entry) =>
        isVwManagedWorktreePath(entry.path) || isRepoRootPath(entry.path, worktreeRepoRoot),
    );
    const repoRootEntries = filtered.filter((entry) =>
      isRepoRootPath(entry.path, worktreeRepoRoot),
    );
    const nonRepoRootEntries = filtered.filter(
      (entry) => !isRepoRootPath(entry.path, worktreeRepoRoot),
    );
    return [...repoRootEntries, ...nonRepoRootEntries];
  }, [worktreeEntries, worktreeRepoRoot]);
  const hasSourcePane = sourceSession.paneId.trim().length > 0;

  const launchOptionsDefaultText = useMemo(
    () => (launchConfig.agents[inheritedAgent]?.options ?? []).join("\n"),
    [inheritedAgent, launchConfig],
  );
  const launchOptionsDefaultOneLine = useMemo(
    () => (launchConfig.agents[inheritedAgent]?.options ?? []).join(" "),
    [inheritedAgent, launchConfig],
  );
  const [formState, dispatchFormState] = useReducer(
    resumeWorktreeFormReducer,
    { sourceSession, targetWorktrees, launchOptionsDefaultText },
    ({
      sourceSession: initialSourceSession,
      targetWorktrees: initialTargetWorktrees,
      launchOptionsDefaultText: initialLaunchOptionsDefaultText,
    }) =>
      buildResumeWorktreeFormState(
        initialSourceSession,
        initialTargetWorktrees,
        initialLaunchOptionsDefaultText,
      ),
  );

  const {
    overrideAgentOptions,
    agentOptionsText,
    selectedWorktreePath,
    resumeTarget,
    sourcePaneId,
    sessionIdOverride,
  } = formState;

  const selectedWorktree = useMemo(
    () => targetWorktrees.find((entry) => entry.path === selectedWorktreePath) ?? null,
    [selectedWorktreePath, targetWorktrees],
  );

  const selectedWorktreeRelativePath = useMemo(() => {
    if (!selectedWorktree) {
      return null;
    }
    return toRepoRelativePath(selectedWorktree.path, worktreeRepoRoot);
  }, [selectedWorktree, worktreeRepoRoot]);

  const existingWorktreeOptions = useMemo(() => {
    return targetWorktrees.map((entry) => {
      const relativePath = toRepoRelativePath(entry.path, worktreeRepoRoot);
      const repoRootTarget = isRepoRootPath(entry.path, worktreeRepoRoot);
      return {
        value: entry.path,
        label: repoRootTarget
          ? formatRepoRootLabel(entry.branch)
          : entry.branch?.trim().length
            ? entry.branch
            : relativePath,
        labelClassName: "normal-case tracking-normal font-mono",
        description: repoRootTarget ? `path: ${relativePath}` : relativePath,
        title: entry.path,
        descriptionClassName: "font-mono text-[10px]",
      };
    });
  }, [targetWorktrees, worktreeRepoRoot]);

  useEffect(() => {
    dispatchFormState({
      type: "syncTargetWorktrees",
      targetWorktrees,
      defaultWorktreePath: sourceSession.worktreePath?.trim(),
    });
  }, [sourceSession.worktreePath, targetWorktrees]);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
    selectedWorktree: WorktreeListEntry | null,
  ) => {
    event.preventDefault();
    const submissionForm = event.currentTarget;

    let parsedOptions: string[] | undefined;
    if (overrideAgentOptions) {
      parsedOptions = parseAgentOptions(agentOptionsText);
      if (parsedOptions.length > 32) {
        dispatchFormState({
          type: "setSubmitError",
          submitError: "Agent options can contain up to 32 lines.",
        });
        return;
      }
      if (parsedOptions.some((option) => option.length > 256 || option.includes("\0"))) {
        dispatchFormState({
          type: "setSubmitError",
          submitError: "Agent options include an invalid value.",
        });
        return;
      }
    }

    const launchOptions: Pick<
      LaunchAgentRequestOptions,
      | "cwd"
      | "agentOptions"
      | "worktreePath"
      | "worktreeBranch"
      | "worktreeCreateIfMissing"
      | "resumeSessionId"
      | "resumeFromPaneId"
      | "resumeTarget"
    > = {};
    if (parsedOptions) {
      launchOptions.agentOptions = parsedOptions;
    }

    if (!selectedWorktree) {
      dispatchFormState({ type: "setSubmitError", submitError: "No target worktree found." });
      return;
    }
    launchOptions.worktreePath = selectedWorktree.path;
    if (selectedWorktree.branch) {
      launchOptions.worktreeBranch = selectedWorktree.branch;
    }

    const normalizedSourcePaneId = sourceSession.paneId.trim();
    if (!normalizedSourcePaneId) {
      dispatchFormState({ type: "setSubmitError", submitError: "Failed to resolve source pane." });
      return;
    }
    if (resumeTarget === "window") {
      launchOptions.resumeTarget = "window";
      launchOptions.resumeFromPaneId = normalizedSourcePaneId;
    } else if (isClaudeAgent) {
      launchOptions.resumeFromPaneId = normalizedSourcePaneId;
    } else {
      const normalizedPaneId = sourcePaneId.trim();
      if (!normalizedPaneId) {
        dispatchFormState({ type: "setSubmitError", submitError: "Source Pane is required." });
        return;
      }
      launchOptions.resumeFromPaneId = normalizedPaneId;

      const overrideId = sessionIdOverride.trim();
      if (overrideId) {
        launchOptions.resumeSessionId = overrideId;
      }
    }

    dispatchFormState({ type: "startSubmitting" });
    try {
      const launchResult = await onLaunchAgentInSession(sessionName, inheritedAgent, launchOptions);
      if (submissionForm.isConnected && isFailedLaunchResponse(launchResult)) {
        const requiredReason = launchResult.resume?.failureReason;
        const requiredReasonMessages = isClaudeAgent
          ? CLAUDE_REQUIRED_REASON_MESSAGE
          : REQUIRED_REASON_MESSAGE;
        dispatchFormState({
          type: "finishSubmitting",
          submitError:
            (requiredReason ? requiredReasonMessages[requiredReason] : null) ??
            launchResult.error?.message ??
            "Failed to launch the agent.",
        });
        return;
      }
      if (submissionForm.isConnected) {
        dispatchFormState({ type: "finishSubmitting" });
        onOpenChange(false);
      }
    } catch {
      if (submissionForm.isConnected) {
        dispatchFormState({
          type: "finishSubmitting",
          submitError: "Failed to launch the agent.",
        });
      }
    }
  };

  return (
    <DialogContent className="top-[50%] flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-3rem)] w-[min(760px,calc(100vw-1rem))] max-w-none translate-y-[-50%] flex-col overflow-hidden sm:w-[min(760px,calc(100vw-1.5rem))]">
      <DialogHeader>
        <DialogTitle>Resume / Move Worktree</DialogTitle>
        <DialogDescription>
          Session <span className="font-mono">{sessionName}</span>
        </DialogDescription>
      </DialogHeader>
      <ResumeWorktreeDialogBody
        sessionName={sessionName}
        sourceSession={sourceSession}
        inheritedAgent={inheritedAgent}
        hasSourcePane={hasSourcePane}
        selectedWorktree={selectedWorktree}
        selectedWorktreeRelativePath={selectedWorktreeRelativePath}
        worktreeRepoRoot={worktreeRepoRoot}
        existingWorktreeOptions={existingWorktreeOptions}
        launchOptionsDefaultOneLine={launchOptionsDefaultOneLine}
        resolvedSelectedWorktreePath={selectedWorktreePath}
        state={formState}
        dispatch={dispatchFormState}
        className={className}
        onSubmit={(event) => handleSubmit(event, selectedWorktree)}
        onCancel={() => onOpenChange(false)}
      />
    </DialogContent>
  );
};

export const ResumeWorktreeDialog = ({
  open,
  onOpenChange,
  ...openContentProps
}: ResumeWorktreeDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ResumeWorktreeDialogOpenContent {...openContentProps} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  );
};
