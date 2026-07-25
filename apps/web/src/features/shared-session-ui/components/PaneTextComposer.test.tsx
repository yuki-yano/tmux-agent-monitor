import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaneTextComposer } from "./PaneTextComposer";
import type { PromptCompletionConfig } from "./prompt-completion/usePromptCompletion";

describe("PaneTextComposer", () => {
  type ComposerState = Parameters<typeof PaneTextComposer>[0]["state"];
  type ComposerActions = Parameters<typeof PaneTextComposer>[0]["actions"];

  beforeEach(() => {
    window.localStorage.clear();
  });

  const buildState = (overrides: Partial<ComposerState> = {}): ComposerState => ({
    interactive: true,
    isSendingText: false,
    textInputRef: createRef<HTMLTextAreaElement>(),
    autoEnter: true,
    rawMode: false,
    allowDangerKeys: false,
    showPermissionShortcuts: false,
    ...overrides,
  });

  const buildActions = (overrides: Partial<ComposerActions> = {}): ComposerActions => ({
    onSendText: vi.fn(),
    onSendPermissionShortcut: vi.fn(),
    onPickImage: vi.fn(),
    onToggleAutoEnter: vi.fn(),
    onToggleRawMode: vi.fn(),
    onToggleAllowDangerKeys: vi.fn(),
    onRawBeforeInput: vi.fn(),
    onRawInput: vi.fn(),
    onRawKeyDown: vi.fn(),
    onRawCompositionStart: vi.fn(),
    onRawCompositionEnd: vi.fn(),
    ...overrides,
  });

  const buildCompletion = (
    agent: "codex" | "claude",
    overrides: Partial<PromptCompletionConfig> = {},
  ): PromptCompletionConfig => ({
    agent,
    paneId: "pane-1",
    requestPromptCompletions: vi.fn(async () => ({ items: [] })),
    requestRepoFileSearch: vi.fn(async (_paneId, query) => ({
      query,
      items: [],
      truncated: false,
      totalMatchedCount: 0,
    })),
    ...overrides,
  });

  it("sends on ctrl/cmd + enter in normal mode", () => {
    const onSendText = vi.fn();
    render(<PaneTextComposer state={buildState()} actions={buildActions({ onSendText })} />);

    const textarea = screen.getByPlaceholderText("Type a prompt…");
    fireEvent.input(textarea, { target: { value: "echo hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onSendText).toHaveBeenCalledTimes(1);
  });

  it("persists prompt draft and restores it after remount", () => {
    const draftStorageKey = "test:pane-draft:%1";
    const state = buildState({ draftStorageKey });
    const firstRender = render(<PaneTextComposer state={state} actions={buildActions()} />);

    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "continue this prompt" } });

    expect(window.localStorage.getItem(draftStorageKey)).toBe("continue this prompt");

    firstRender.unmount();
    render(<PaneTextComposer state={state} actions={buildActions()} />);

    expect((screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement).value).toBe(
      "continue this prompt",
    );
  });

  it("removes the persisted prompt draft after a successful send clears the textarea", async () => {
    const draftStorageKey = "test:pane-draft:%1";
    const textInputRef = createRef<HTMLTextAreaElement>();
    const onSendText = vi.fn(async () => {
      if (textInputRef.current) {
        textInputRef.current.value = "";
      }
    });
    render(
      <PaneTextComposer
        state={buildState({ draftStorageKey, textInputRef })}
        actions={buildActions({ onSendText })}
      />,
    );

    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "send this prompt" } });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(window.localStorage.getItem(draftStorageKey)).toBeNull();
    });
  });

  it("does not send on ctrl/cmd + enter in raw mode", () => {
    const onSendText = vi.fn();
    render(
      <PaneTextComposer
        state={buildState({ rawMode: true })}
        actions={buildActions({ onSendText })}
      />,
    );

    const textarea = screen.getByPlaceholderText("Raw input (sent immediately)...");
    fireEvent.input(textarea, { target: { value: "echo hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onSendText).not.toHaveBeenCalled();
  });

  it("disables send button while sending", () => {
    render(
      <PaneTextComposer state={buildState({ isSendingText: true })} actions={buildActions()} />,
    );

    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  it("reflects auto-enter state in the checkbox", () => {
    const actions = buildActions();
    const view = render(
      <PaneTextComposer state={buildState({ autoEnter: true })} actions={actions} />,
    );

    expect(
      (screen.getByRole("checkbox", { name: "Enter after send" }) as HTMLInputElement).checked,
    ).toBe(true);

    view.rerender(<PaneTextComposer state={buildState({ autoEnter: false })} actions={actions} />);

    expect(
      (screen.getByRole("checkbox", { name: "Enter after send" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("toggles auto-enter from the checkbox", () => {
    const onToggleAutoEnter = vi.fn();
    render(
      <PaneTextComposer
        state={buildState({ autoEnter: false })}
        actions={buildActions({ onToggleAutoEnter })}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Enter after send" }));

    expect(onToggleAutoEnter).toHaveBeenCalledTimes(1);
  });

  it("disables auto-enter in raw mode", () => {
    const onToggleAutoEnter = vi.fn();
    render(
      <PaneTextComposer
        state={buildState({ autoEnter: false, rawMode: true })}
        actions={buildActions({ onToggleAutoEnter })}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Enter after send",
    }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);

    fireEvent.click(checkbox);
    expect(onToggleAutoEnter).not.toHaveBeenCalled();
  });

  it("expands key options when Keys button is pressed", () => {
    const onSendKey = vi.fn();
    render(
      <PaneTextComposer
        state={buildState({ keyPanel: { shiftHeld: false, ctrlHeld: false } })}
        actions={buildActions({
          keyPanel: {
            onToggleShift: vi.fn(),
            onToggleCtrl: vi.fn(),
            onSendKey,
          },
        })}
      />,
    );

    expect(screen.queryByText("Shift")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show key options" }));
    expect(screen.getByText("Shift")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    expect(onSendKey).toHaveBeenCalledWith("Enter");
  });

  it("shows permission shortcuts and sends selected values", () => {
    const onSendPermissionShortcut = vi.fn();
    render(
      <PaneTextComposer
        state={buildState({ showPermissionShortcuts: true })}
        actions={buildActions({ onSendPermissionShortcut })}
      />,
    );

    expect(screen.getByTestId("permission-shortcuts-row")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));

    expect(onSendPermissionShortcut).toHaveBeenCalledTimes(2);
    expect(onSendPermissionShortcut).toHaveBeenNthCalledWith(1, "1");
    expect(onSendPermissionShortcut).toHaveBeenNthCalledWith(2, "Escape");
  });

  it("places compact Codex completion buttons after the image attachment button", () => {
    render(
      <PaneTextComposer
        state={buildState({ completion: buildCompletion("codex") })}
        actions={buildActions()}
      />,
    );

    const attachButton = screen.getByRole("button", { name: "Attach image" });
    const completionButtons = attachButton.nextElementSibling;
    expect(
      completionButtons?.contains(screen.getByRole("button", { name: "Open Skill completions" })),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Open Plugin and File completions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Command completions" })).toBeTruthy();
  });

  it("only shows file and slash completion buttons for Claude", () => {
    render(
      <PaneTextComposer
        state={buildState({ completion: buildCompletion("claude") })}
        actions={buildActions()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open Skill completions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open File completions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Skill and Command completions" })).toBeTruthy();
  });

  it("loads and inserts a Codex Skill from the dollar completion button", async () => {
    const requestPromptCompletions = vi.fn(async () => ({
      items: [
        {
          id: "codex-skill:react-doctor",
          label: "$react-doctor",
          insertText: "$react-doctor",
          description: "Run React diagnostics.",
          argumentHint: "",
          kind: "skill" as const,
          scope: "user",
        },
      ],
    }));
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", { requestPromptCompletions }),
        })}
        actions={buildActions()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Skill completions" }));
    fireEvent.click(await screen.findByText("$react-doctor"));

    expect(requestPromptCompletions).toHaveBeenCalledWith("pane-1", "dollar", "");
    expect((screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement).value).toBe(
      "$react-doctor ",
    );
  });

  it("shows Codex plugin cache Skills beyond the first five suggestions", async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id:
        index === 5
          ? "codex-skill:/home/user/.codex/plugins/cache/visualize/SKILL.md"
          : `codex-skill:skill-${String(index)}`,
      label: index === 5 ? "$visualize:visualize" : `$skill-${String(index)}`,
      insertText: index === 5 ? "$visualize:visualize" : `$skill-${String(index)}`,
      description: `Skill ${String(index)}`,
      argumentHint: "",
      kind: "skill" as const,
      scope: "user",
    }));
    const requestPromptCompletions = vi.fn(async () => ({ items }));
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", { requestPromptCompletions }),
        })}
        actions={buildActions()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Skill completions" }));

    expect(await screen.findByText("$visualize:visualize")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(items.length);
  });

  it("loads Codex plugins before repository files for at completions", async () => {
    const requestPromptCompletions = vi.fn(async () => ({
      items: [
        {
          id: "codex-plugin:chrome@openai-bundled",
          label: "@Chrome",
          insertText: "@Chrome",
          description: "Control Chrome with ChatGPT.",
          argumentHint: "",
          kind: "plugin" as const,
          scope: "openai-bundled",
        },
      ],
    }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => ({
      query,
      items: [
        {
          path: "docs/chrome.md",
          name: "chrome.md",
          kind: "file" as const,
          score: 1,
          highlights: [],
        },
      ],
      truncated: false,
      totalMatchedCount: 1,
    }));
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", {
            requestPromptCompletions,
            requestRepoFileSearch,
          }),
        })}
        actions={buildActions()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "@chr", selectionStart: 4 } });

    expect(await screen.findByText("@Chrome")).toBeTruthy();
    expect(screen.getByText("docs/chrome.md")).toBeTruthy();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("@Chrome"),
      expect.stringContaining("docs/chrome.md"),
    ]);
    expect(requestPromptCompletions).toHaveBeenCalledWith("pane-1", "at", "chr");
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-1", "chr", { limit: 5 });

    fireEvent.click(screen.getByText("@Chrome"));
    expect(textarea.value).toBe("@Chrome ");
  });

  it("opens and inserts slash completions at the current caret after existing text", async () => {
    const requestPromptCompletions = vi.fn(async () => ({
      items: [
        {
          id: "command:compact",
          label: "/compact",
          insertText: "/compact",
          description: "Compact conversation history.",
          argumentHint: "",
          kind: "command" as const,
          scope: "built-in",
        },
      ],
    }));
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", { requestPromptCompletions }),
        })}
        actions={buildActions()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "Please run", selectionStart: 10 } });
    fireEvent.click(screen.getByRole("button", { name: "Open Command completions" }));

    expect(textarea.value).toBe("Please run /");
    await waitFor(() =>
      expect(requestPromptCompletions).toHaveBeenCalledWith("pane-1", "slash", ""),
    );

    fireEvent.click(await screen.findByText("/compact"));
    expect(textarea.value).toBe("Please run /compact ");
  });

  it("does not reload unchanged suggestions when the completion config object is recreated", async () => {
    const requestPromptCompletions = vi.fn(async () => ({
      items: [
        {
          id: "codex-skill:react-doctor",
          label: "$react-doctor",
          insertText: "$react-doctor",
          description: "Run React diagnostics.",
          argumentHint: "",
          kind: "skill" as const,
          scope: "user",
        },
      ],
    }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => ({
      query,
      items: [],
      truncated: false,
      totalMatchedCount: 0,
    }));
    const view = render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", {
            requestPromptCompletions,
            requestRepoFileSearch,
          }),
        })}
        actions={buildActions()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Skill completions" }));
    expect(await screen.findByText("$react-doctor")).toBeTruthy();

    view.rerender(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", {
            requestPromptCompletions,
            requestRepoFileSearch,
          }),
        })}
        actions={buildActions()}
      />,
    );

    await waitFor(() => expect(requestPromptCompletions).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("does not let a stale completion response replace the current suggestions", async () => {
    type Result = Awaited<ReturnType<PromptCompletionConfig["requestPromptCompletions"]>>;
    const resolvers = new Map<string, (value: Result) => void>();
    const requestPromptCompletions = vi.fn(
      async (_paneId: string, _trigger: "at" | "dollar" | "slash", query = "") =>
        new Promise<Result>((resolve) => {
          resolvers.set(query, resolve);
        }),
    );
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", { requestPromptCompletions }),
        })}
        actions={buildActions()}
      />,
    );
    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;

    fireEvent.input(textarea, { target: { value: "$a", selectionStart: 2 } });
    await waitFor(() =>
      expect(requestPromptCompletions).toHaveBeenCalledWith("pane-1", "dollar", "a"),
    );
    fireEvent.input(textarea, { target: { value: "$b", selectionStart: 2 } });
    await waitFor(() =>
      expect(requestPromptCompletions).toHaveBeenCalledWith("pane-1", "dollar", "b"),
    );

    await act(async () => {
      resolvers.get("b")?.({
        items: [
          {
            id: "codex-skill:beta",
            label: "$beta",
            insertText: "$beta",
            description: "Current result.",
            argumentHint: "",
            kind: "skill",
            scope: "user",
          },
        ],
      });
    });
    expect(await screen.findByText("$beta")).toBeTruthy();

    await act(async () => {
      resolvers.get("a")?.({
        items: [
          {
            id: "codex-skill:alpha",
            label: "$alpha",
            insertText: "$alpha",
            description: "Stale result.",
            argumentHint: "",
            kind: "skill",
            scope: "user",
          },
        ],
      });
    });
    expect(screen.queryByText("$alpha")).toBeNull();
    expect(screen.getByText("$beta")).toBeTruthy();
  });

  it("renders suggestions after the input so they cannot cover the typed text", async () => {
    const requestPromptCompletions = vi.fn(async () => ({ items: [] }));
    render(
      <PaneTextComposer
        state={buildState({
          completion: buildCompletion("codex", { requestPromptCompletions }),
        })}
        actions={buildActions()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Skill completions" }));
    const textarea = screen.getByPlaceholderText("Type a prompt…");
    const listbox = await screen.findByRole("listbox", { name: "Prompt completions" });

    expect(textarea.compareDocumentPosition(listbox) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
  });

  it("searches and inserts a quoted repository file path", async () => {
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => ({
      query,
      items: [
        {
          path: "docs/My Guide.md",
          name: "My Guide.md",
          kind: "file" as const,
          score: 1,
          highlights: [],
        },
      ],
      truncated: false,
      totalMatchedCount: 1,
    }));
    render(
      <PaneTextComposer
        state={buildState({ completion: buildCompletion("claude", { requestRepoFileSearch }) })}
        actions={buildActions()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Type a prompt…") as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "@guide", selectionStart: 6 } });
    fireEvent.click(await screen.findByText("docs/My Guide.md"));

    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-1", "guide", { limit: 5 });
    expect(textarea.value).toBe('"docs/My Guide.md" ');
  });

  it("hides completion buttons in raw mode", () => {
    render(
      <PaneTextComposer
        state={buildState({ rawMode: true, completion: buildCompletion("codex") })}
        actions={buildActions()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open Skill completions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Plugin and File completions" })).toBeNull();
  });
});
