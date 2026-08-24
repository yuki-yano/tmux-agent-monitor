import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { memo } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SessionDetailSliceProviders,
  useSessionDetailHeaderActions,
  useSessionDetailLogModal,
  useSessionDetailQuickPanel,
  useSessionDetailSidebarActions,
} from "./SessionDetailContexts";

type SliceProps = ComponentProps<typeof SessionDetailSliceProviders>;

const renderSpies = {
  quick: vi.fn(),
  log: vi.fn(),
  header: vi.fn(),
  sidebar: vi.fn(),
};

const QuickProbe = memo(() => {
  renderSpies.quick(useSessionDetailQuickPanel());
  return null;
});
const LogProbe = memo(() => {
  renderSpies.log(useSessionDetailLogModal());
  return null;
});
const HeaderProbe = memo(() => {
  renderSpies.header(useSessionDetailHeaderActions());
  return null;
});
const SidebarProbe = memo(() => {
  renderSpies.sidebar(useSessionDetailSidebarActions());
  return null;
});

QuickProbe.displayName = "QuickProbe";
LogProbe.displayName = "LogProbe";
HeaderProbe.displayName = "HeaderProbe";
SidebarProbe.displayName = "SidebarProbe";

const controls = {
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
};

const base = {} as SliceProps["base"];
const repoPins = {} as SliceProps["repoPins"];
const terminal = { controls } as unknown as SliceProps["terminal"];

const buildLogsActions = () => ({
  logs: {
    quickPanelOpen: false,
    logModalOpen: false,
    selectedPaneId: null,
    selectedSession: null,
    selectedLogLines: [] as string[],
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
});

const renderTree = (logsActions: SliceProps["logsActions"]) => (
  <SessionDetailSliceProviders
    base={base}
    repoPins={repoPins}
    terminal={terminal}
    logsActions={logsActions}
  >
    <QuickProbe />
    <LogProbe />
    <HeaderProbe />
    <SidebarProbe />
  </SessionDetailSliceProviders>
);

const clearRenderSpies = () => {
  for (const spy of Object.values(renderSpies)) {
    spy.mockClear();
  }
};

describe("SessionDetailSliceProviders", () => {
  it("notifies only the consumer whose projected leaf changed", () => {
    const initial = buildLogsActions() as unknown as SliceProps["logsActions"];
    const view = render(renderTree(initial));
    clearRenderSpies();

    const logChanged = {
      ...initial,
      logs: { ...initial.logs, selectedLogLines: ["updated line"] },
    };
    view.rerender(renderTree(logChanged));

    expect(renderSpies.log).toHaveBeenCalledTimes(1);
    expect(renderSpies.quick).not.toHaveBeenCalled();
    expect(renderSpies.header).not.toHaveBeenCalled();
    expect(renderSpies.sidebar).not.toHaveBeenCalled();
    clearRenderSpies();

    const quickChanged = {
      ...logChanged,
      logs: { ...logChanged.logs, quickPanelOpen: true },
    };
    view.rerender(renderTree(quickChanged));

    expect(renderSpies.quick).toHaveBeenCalledTimes(1);
    expect(renderSpies.log).not.toHaveBeenCalled();
    expect(renderSpies.header).not.toHaveBeenCalled();
    expect(renderSpies.sidebar).not.toHaveBeenCalled();
  });
});
