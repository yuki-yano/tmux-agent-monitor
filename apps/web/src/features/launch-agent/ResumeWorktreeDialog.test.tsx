import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultLaunchConfig } from "@/state/launch-agent-options";

import { ResumeWorktreeDialog } from "./ResumeWorktreeDialog";

const buildSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  paneId: "pane-1",
  sessionId: "session-id-1",
  sessionName: "session-1",
  windowId: "window-id-1",
  windowIndex: 1,
  paneIndex: 0,
  paneActive: true,
  currentCommand: "codex",
  currentPath: "/repo/.worktree/feature/current",
  paneTty: null,
  title: "Session",
  customTitle: null,
  branch: "feature/current",
  worktreePath: "/repo/.worktree/feature/current",
  repoRoot: "/repo",
  agent: "codex",
  state: "RUNNING",
  stateReason: "running",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: null,
  lastRunStartedAt: null,
  manualSortAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  completion: null,
  ...overrides,
});

describe("ResumeWorktreeDialog", () => {
  const managedWorktreeEntry = {
    path: "/repo/.worktree/feature/current",
    branch: "feature/current",
    dirty: false,
    locked: false,
    lockOwner: null,
    lockReason: null,
    merged: false,
  } as const;
  const repoRootEntry = {
    path: "/repo",
    branch: "main",
    dirty: false,
    locked: false,
    lockOwner: null,
    lockReason: null,
    merged: false,
  } as const;
  const alternateWorktreeEntry = {
    path: "/repo/.worktree/feature/alternate",
    branch: "feature/alternate",
    dirty: false,
    locked: false,
    lockOwner: null,
    lockReason: null,
    merged: false,
  } as const;

  it("submits existing worktree resume request with source pane defaults", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    expect(screen.queryByText("Reuse Existing Session")).toBeNull();
    expect(screen.queryByRole("button", { name: "Codex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Claude" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Use vw worktree" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Existing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    expect(screen.getByText("Select existing vw worktree or repo root.")).toBeTruthy();
    expect(screen.queryByText(/repo root:/)).toBeNull();
    expect(screen.queryByRole("radio", { name: /Best effort/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Required/i })).toBeNull();
    expect(
      screen.getByText("Existing session reuse is always enabled for this action."),
    ).toBeTruthy();
    expect(screen.getByText("Current agent:")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("keeps source pane when Session ID override is set", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    fireEvent.change(screen.getByLabelText("Session ID override"), {
      target: { value: "sess-override-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeSessionId: "sess-override-1",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("hides existing session inputs for claude and submits with source pane", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession({
          agent: "claude",
        })}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    expect(screen.queryByLabelText("Source Pane")).toBeNull();
    expect(screen.queryByLabelText("Session ID override")).toBeNull();
    expect(screen.queryByText("Agent Options")).toBeNull();
    expect(screen.queryByText("Current agent:")).toBeNull();
    expect(screen.getByText("Claude keeps using the same pane for this action.")).toBeTruthy();
    expect(screen.getByText("Session ID override is not required.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "claude", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("shows required failure reason from resume metadata", async () => {
    const onLaunchAgentInSession = vi.fn(async () => ({
      ok: false as const,
      error: { code: "RESUME_AMBIGUOUS" as const, message: "ambiguous" },
      rollback: { attempted: false, ok: true },
      resume: {
        requested: true,
        reused: false,
        sessionId: null,
        source: null,
        confidence: "none" as const,
        policy: "required" as const,
        failureReason: "ambiguous" as const,
      },
    }));

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Multiple candidate sessions matched. Specify Session ID override or narrow Source Pane.",
        ),
      ).toBeTruthy();
    });
  });

  it("hides existing session fields when launching codex in a new window", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Window" }));
    expect(screen.queryByLabelText("Source Pane")).toBeNull();
    expect(screen.queryByLabelText("Session ID override")).toBeNull();
    expect(screen.getByText(/Source pane agent is stopped/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
        resumeTarget: "window",
      });
    });
  });

  it("hides claude existing session details when launching in a new window", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession({
          agent: "claude",
        })}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Window" }));
    expect(screen.queryByText("Claude keeps using the same pane for this action.")).toBeNull();
    expect(screen.getByText(/claude --resume <session-id> '!cd <worktree>'/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "claude", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
        resumeTarget: "window",
      });
    });
  });

  it("submits repo root as target worktree", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession({
          branch: "main",
          worktreePath: "/repo",
        })}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry, repoRootEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    expect(screen.getByText("Current target:")).toBeTruthy();
    expect(screen.getAllByText("repo root (main)").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo",
        worktreeBranch: "main",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("shows repo root at the top of target worktree options", () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[managedWorktreeEntry, repoRootEntry]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios[0]?.closest("label")?.textContent).toContain("repo root (main)");
    expect(screen.getByText("path: .")).toBeTruthy();
  });

  it("resets edited form state after close and reopen in StrictMode", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);
    const renderDialog = (open: boolean) => (
      <StrictMode>
        <ResumeWorktreeDialog
          open={open}
          onOpenChange={() => undefined}
          sessionName="dev-main"
          sourceSession={buildSession()}
          launchConfig={defaultLaunchConfig}
          worktreeEntries={[managedWorktreeEntry]}
          worktreeRepoRoot="/repo"
          onLaunchAgentInSession={onLaunchAgentInSession}
        />
      </StrictMode>
    );
    const { rerender } = render(renderDialog(true));

    fireEvent.change(screen.getByLabelText("Source Pane"), {
      target: { value: "pane-edited" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Override agent options" }));

    rerender(renderDialog(false));
    expect(screen.queryByLabelText("Source Pane")).toBeNull();

    rerender(renderDialog(true));
    expect(screen.getByLabelText("Source Pane")).toHaveProperty("value", "pane-1");
    expect(screen.getByRole("checkbox", { name: "Override agent options" })).toHaveProperty(
      "checked",
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));
    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("keeps a selected worktree while it remains in updated candidates", () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);
    const props = {
      open: true,
      onOpenChange: () => undefined,
      sessionName: "dev-main",
      sourceSession: buildSession(),
      launchConfig: defaultLaunchConfig,
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const { rerender } = render(
      <ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry, repoRootEntry]} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /repo root \(main\)/i }));
    rerender(
      <ResumeWorktreeDialog
        {...props}
        worktreeEntries={[alternateWorktreeEntry, repoRootEntry, managedWorktreeEntry]}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /repo root \(main\)/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("commits a fallback when the selected target disappears and keeps it when the target returns", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);
    const props = {
      open: true,
      onOpenChange: () => undefined,
      sessionName: "dev-main",
      sourceSession: buildSession(),
      launchConfig: defaultLaunchConfig,
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const { rerender } = render(
      <ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry, repoRootEntry]} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /repo root \(main\)/i }));
    rerender(<ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry]} />);

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: /feature\/current/i }).getAttribute("aria-checked"),
      ).toBe("true");
    });

    rerender(
      <ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry, repoRootEntry]} />,
    );
    expect(
      screen.getByRole("radio", { name: /feature\/current/i }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: /repo root \(main\)/i }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("uses the latest default when candidates arrive after an initially empty list", () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);
    const props = {
      open: true,
      onOpenChange: () => undefined,
      sessionName: "dev-main",
      launchConfig: defaultLaunchConfig,
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const { rerender } = render(
      <ResumeWorktreeDialog {...props} sourceSession={buildSession()} worktreeEntries={[]} />,
    );

    rerender(
      <ResumeWorktreeDialog
        {...props}
        sourceSession={buildSession({ branch: "main", worktreePath: "/repo" })}
        worktreeEntries={[]}
      />,
    );
    rerender(
      <ResumeWorktreeDialog
        {...props}
        sourceSession={buildSession({ branch: "main", worktreePath: "/repo" })}
        worktreeEntries={[managedWorktreeEntry, repoRootEntry]}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /repo root \(main\)/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("submits the resolved fallback when the selected target disappears", async () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);
    const props = {
      open: true,
      onOpenChange: () => undefined,
      sessionName: "dev-main",
      sourceSession: buildSession(),
      launchConfig: defaultLaunchConfig,
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const { rerender } = render(
      <ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry, repoRootEntry]} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /repo root \(main\)/i }));
    rerender(<ResumeWorktreeDialog {...props} worktreeEntries={[managedWorktreeEntry]} />);

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));

    await waitFor(() => {
      expect(onLaunchAgentInSession).toHaveBeenCalledWith("dev-main", "codex", {
        worktreePath: "/repo/.worktree/feature/current",
        worktreeBranch: "feature/current",
        resumeFromPaneId: "pane-1",
      });
    });
  });

  it("ignores an old successful submission after close and reopen", async () => {
    let resolveLaunch: ((value: undefined) => void) | undefined;
    const onLaunchAgentInSession = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    const props = {
      onOpenChange,
      sessionName: "dev-main",
      sourceSession: buildSession(),
      launchConfig: defaultLaunchConfig,
      worktreeEntries: [managedWorktreeEntry],
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const renderDialog = (open: boolean) => (
      <StrictMode>
        <ResumeWorktreeDialog {...props} open={open} />
      </StrictMode>
    );
    const { rerender } = render(renderDialog(true));

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));
    rerender(renderDialog(false));
    rerender(renderDialog(true));

    await act(async () => resolveLaunch?.(undefined));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resume / Move" })).toHaveProperty("disabled", false);
  });

  it("ignores an old failed submission after close and reopen", async () => {
    let rejectLaunch: ((reason: Error) => void) | undefined;
    const onLaunchAgentInSession = vi.fn(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectLaunch = reject;
        }),
    );
    const props = {
      onOpenChange: () => undefined,
      sessionName: "dev-main",
      sourceSession: buildSession(),
      launchConfig: defaultLaunchConfig,
      worktreeEntries: [managedWorktreeEntry],
      worktreeRepoRoot: "/repo",
      onLaunchAgentInSession,
    };
    const renderDialog = (open: boolean) => (
      <StrictMode>
        <ResumeWorktreeDialog {...props} open={open} />
      </StrictMode>
    );
    const { rerender } = render(renderDialog(true));

    fireEvent.click(screen.getByRole("button", { name: "Resume / Move" }));
    rerender(renderDialog(false));
    rerender(renderDialog(true));

    await act(async () => rejectLaunch?.(new Error("old failure")));

    expect(screen.queryByText("Failed to launch the agent.")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume / Move" })).toHaveProperty("disabled", false);
  });

  it("disables resume submit when no existing vw worktree is available", () => {
    const onLaunchAgentInSession = vi.fn(async () => undefined);

    render(
      <ResumeWorktreeDialog
        open={true}
        onOpenChange={() => undefined}
        sessionName="dev-main"
        sourceSession={buildSession()}
        launchConfig={defaultLaunchConfig}
        worktreeEntries={[]}
        worktreeRepoRoot="/repo"
        onLaunchAgentInSession={onLaunchAgentInSession}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Resume / Move" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    fireEvent.click(submitButton);
    expect(onLaunchAgentInSession).not.toHaveBeenCalled();
  });
});
