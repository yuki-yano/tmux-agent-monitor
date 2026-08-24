import { render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SessionDetailSliceProviders } from "../../SessionDetailContexts";
import { ConnectedControlsPanel } from "./ConnectedControlsPanel";

const mocks = vi.hoisted(() => ({ presentation: vi.fn() }));

vi.mock("../ControlsPanel", async () => {
  const { memo } = await import("react");
  return {
    ControlsPanel: memo((props: unknown) => {
      mocks.presentation(props);
      return null;
    }),
  };
});

type SliceProps = ComponentProps<typeof SessionDetailSliceProviders>;

const buildControls = () => ({
  textInputRef: { current: null },
  autoEnter: true,
  shiftHeld: false,
  ctrlHeld: false,
  rawMode: false,
  allowDangerKeys: false,
  isSendingText: false,
  handleSendText: vi.fn(),
  handleUploadImage: vi.fn(),
  toggleAutoEnter: vi.fn(),
  toggleRawMode: vi.fn(),
  toggleAllowDangerKeys: vi.fn(),
  toggleShift: vi.fn(),
  toggleCtrl: vi.fn(),
  handleSendKey: vi.fn(),
  handleSendPermissionShortcut: vi.fn(),
  handleKillPane: vi.fn(),
  handleKillWindow: vi.fn(),
  handleRawBeforeInput: vi.fn(),
  handleRawInput: vi.fn(),
  handleRawKeyDown: vi.fn(),
  handleRawCompositionStart: vi.fn(),
  handleRawCompositionEnd: vi.fn(),
});

const logsActions = {
  logs: {
    quickPanelOpen: false,
    logModalOpen: false,
    selectedPaneId: null,
    selectedSession: null,
    selectedLogLines: [],
    selectedLogLoading: false,
    selectedLogError: null,
    openLogModal: vi.fn(),
    closeLogModal: vi.fn(),
    toggleQuickPanel: vi.fn(),
    closeQuickPanel: vi.fn(),
  },
  actions: {
    handleOpenPaneInNewWindow: vi.fn(),
    handleOpenInNewTab: vi.fn(),
    handleFocusPane: vi.fn(),
    handleOpenPaneHere: vi.fn(),
    handleOpenHere: vi.fn(),
    handleTouchRepoPin: vi.fn(),
    handleLaunchAgentInSession: vi.fn(),
    handleTouchCurrentSession: vi.fn(),
    handleTouchPaneSortAnchor: vi.fn(),
  },
} as unknown as SliceProps["logsActions"];

const renderWithSlices = ({
  base,
  terminal,
  children,
}: {
  base: SliceProps["base"];
  terminal: SliceProps["terminal"];
  children: ReactNode;
}) => (
  <SessionDetailSliceProviders
    base={base}
    repoPins={{} as SliceProps["repoPins"]}
    terminal={terminal}
    logsActions={logsActions}
  >
    {children}
  </SessionDetailSliceProviders>
);

describe("ConnectedControlsPanel", () => {
  it("shares the terminal ref and actions across multiple presentations", () => {
    const controls = buildControls();
    const base = {
      paneId: "pane-1",
      session: null,
      connectionStatus: "healthy",
      requestPromptCompletions: vi.fn(),
      requestRepoFileSearch: vi.fn(),
      nowMs: 0,
    } as unknown as SliceProps["base"];
    const terminal = { controls } as unknown as SliceProps["terminal"];
    mocks.presentation.mockClear();

    render(
      renderWithSlices({
        base,
        terminal,
        children: (
          <>
            <ConnectedControlsPanel showComposerSection={false} />
            <ConnectedControlsPanel showKeysSection={false} />
          </>
        ),
      }),
    );

    type CapturedProps = {
      state: { textInputRef: unknown };
      actions: { onSendText: unknown };
      showComposerSection?: boolean;
      showKeysSection?: boolean;
    };
    const first = mocks.presentation.mock.calls[0]?.[0] as CapturedProps;
    const second = mocks.presentation.mock.calls[1]?.[0] as CapturedProps;
    expect(first.state.textInputRef).toBe(second.state.textInputRef);
    expect(first.actions.onSendText).toBe(second.actions.onSendText);
    expect(first.showComposerSection).toBe(false);
    expect(second.showKeysSection).toBe(false);
  });

  it("keeps presentation props stable when only base nowMs changes", () => {
    const controls = buildControls();
    const base = {
      paneId: "pane-1",
      session: null,
      connectionStatus: "healthy",
      requestPromptCompletions: vi.fn(),
      requestRepoFileSearch: vi.fn(),
      nowMs: 0,
    } as unknown as SliceProps["base"];
    const terminal = { controls } as unknown as SliceProps["terminal"];
    mocks.presentation.mockClear();
    const view = render(renderWithSlices({ base, terminal, children: <ConnectedControlsPanel /> }));
    const initialProps = mocks.presentation.mock.calls[0]?.[0] as {
      state: unknown;
      actions: unknown;
    };

    view.rerender(
      renderWithSlices({
        base: { ...base, nowMs: 1 },
        terminal,
        children: <ConnectedControlsPanel />,
      }),
    );

    expect(mocks.presentation).toHaveBeenCalledTimes(1);
    expect(initialProps.state).toBeDefined();
    expect(initialProps.actions).toBeDefined();

    view.rerender(
      renderWithSlices({
        base: { ...base, connectionStatus: "disconnected", nowMs: 2 },
        terminal,
        children: <ConnectedControlsPanel />,
      }),
    );
    expect(mocks.presentation).toHaveBeenCalledTimes(2);
  });
});
