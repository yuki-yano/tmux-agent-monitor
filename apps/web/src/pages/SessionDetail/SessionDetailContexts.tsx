import { type ReactNode, createContext, use, useMemo } from "react";

import type { useSessionDetailLogsActions as useSessionDetailLogsActionsOwner } from "./hooks/useSessionDetailLogsActions";
import type { useSessionDetailScreenControls } from "./hooks/useSessionDetailScreenControls";
import type { useSessionDetailVMState } from "./hooks/useSessionDetailVMState";
import type { useSessionRepoPins } from "./hooks/useSessionRepoPins";

type LogsActionsOwnerValue = ReturnType<typeof useSessionDetailLogsActionsOwner>;

export type SessionDetailBaseContextValue = ReturnType<typeof useSessionDetailVMState> & {
  paneId: string;
};
export type SessionDetailRepoPinsContextValue = ReturnType<typeof useSessionRepoPins>;
export type SessionDetailTerminalContextValue = {
  controls: Omit<ReturnType<typeof useSessionDetailScreenControls>["controls"], "sendError">;
};
export type SessionDetailQuickPanelContextValue = {
  logs: Pick<
    LogsActionsOwnerValue["logs"],
    "quickPanelOpen" | "openLogModal" | "closeQuickPanel" | "toggleQuickPanel"
  >;
  actions: Pick<
    LogsActionsOwnerValue["actions"],
    "handleOpenPaneHere" | "handleOpenPaneInNewWindow"
  >;
};
export type SessionDetailLogModalContextValue = {
  logs: Pick<
    LogsActionsOwnerValue["logs"],
    | "logModalOpen"
    | "selectedSession"
    | "selectedLogLines"
    | "selectedLogLoading"
    | "selectedLogError"
    | "closeLogModal"
  >;
  actions: Pick<LogsActionsOwnerValue["actions"], "handleOpenHere" | "handleOpenInNewTab">;
};
export type SessionDetailHeaderActionsContextValue = Pick<
  LogsActionsOwnerValue["actions"],
  "handleTouchCurrentSession"
>;
export type SessionDetailSidebarActionsContextValue = Pick<
  LogsActionsOwnerValue["actions"],
  | "handleFocusPane"
  | "handleLaunchAgentInSession"
  | "handleTouchPaneSortAnchor"
  | "handleTouchRepoPin"
>;

const SessionDetailBaseContext = createContext<SessionDetailBaseContextValue | null>(null);
const SessionDetailRepoPinsContext = createContext<SessionDetailRepoPinsContextValue | null>(null);
const SessionDetailTerminalContext = createContext<SessionDetailTerminalContextValue | null>(null);
const SessionDetailQuickPanelContext = createContext<SessionDetailQuickPanelContextValue | null>(
  null,
);
const SessionDetailLogModalContext = createContext<SessionDetailLogModalContextValue | null>(null);
const SessionDetailHeaderActionsContext =
  createContext<SessionDetailHeaderActionsContextValue | null>(null);
const SessionDetailSidebarActionsContext =
  createContext<SessionDetailSidebarActionsContextValue | null>(null);

const useRequiredContext = <T,>(value: T | null, hookName: string): T => {
  if (value == null) {
    throw new Error(`${hookName} must be used within a SessionDetailProvider`);
  }
  return value;
};

export const useSessionDetailBase = () =>
  useRequiredContext(use(SessionDetailBaseContext), "useSessionDetailBase");
export const useSessionDetailRepoPins = () =>
  useRequiredContext(use(SessionDetailRepoPinsContext), "useSessionDetailRepoPins");
export const useSessionDetailTerminal = () =>
  useRequiredContext(use(SessionDetailTerminalContext), "useSessionDetailTerminal");
export const useSessionDetailQuickPanel = () =>
  useRequiredContext(use(SessionDetailQuickPanelContext), "useSessionDetailQuickPanel");
export const useSessionDetailLogModal = () =>
  useRequiredContext(use(SessionDetailLogModalContext), "useSessionDetailLogModal");
export const useSessionDetailHeaderActions = () =>
  useRequiredContext(use(SessionDetailHeaderActionsContext), "useSessionDetailHeaderActions");
export const useSessionDetailSidebarActions = () =>
  useRequiredContext(use(SessionDetailSidebarActionsContext), "useSessionDetailSidebarActions");

type SessionDetailSliceProvidersProps = {
  base: SessionDetailBaseContextValue;
  repoPins: SessionDetailRepoPinsContextValue;
  terminal: ReturnType<typeof useSessionDetailScreenControls>;
  logsActions: LogsActionsOwnerValue;
  children: ReactNode;
};

const useTerminalContextValue = (
  terminal: ReturnType<typeof useSessionDetailScreenControls>,
): SessionDetailTerminalContextValue => {
  const { controls } = terminal;
  return useMemo(
    () => ({
      controls: {
        textInputRef: controls.textInputRef,
        autoEnter: controls.autoEnter,
        shiftHeld: controls.shiftHeld,
        ctrlHeld: controls.ctrlHeld,
        rawMode: controls.rawMode,
        allowDangerKeys: controls.allowDangerKeys,
        isSendingText: controls.isSendingText,
        handleSendKey: controls.handleSendKey,
        handleSendPermissionShortcut: controls.handleSendPermissionShortcut,
        handleKillPane: controls.handleKillPane,
        handleKillWindow: controls.handleKillWindow,
        handleSendText: controls.handleSendText,
        handleUploadImage: controls.handleUploadImage,
        handleRawBeforeInput: controls.handleRawBeforeInput,
        handleRawInput: controls.handleRawInput,
        handleRawKeyDown: controls.handleRawKeyDown,
        handleRawCompositionStart: controls.handleRawCompositionStart,
        handleRawCompositionEnd: controls.handleRawCompositionEnd,
        toggleAutoEnter: controls.toggleAutoEnter,
        toggleShift: controls.toggleShift,
        toggleCtrl: controls.toggleCtrl,
        toggleRawMode: controls.toggleRawMode,
        toggleAllowDangerKeys: controls.toggleAllowDangerKeys,
      },
    }),
    [
      controls.allowDangerKeys,
      controls.autoEnter,
      controls.ctrlHeld,
      controls.handleKillPane,
      controls.handleKillWindow,
      controls.handleRawBeforeInput,
      controls.handleRawCompositionEnd,
      controls.handleRawCompositionStart,
      controls.handleRawInput,
      controls.handleRawKeyDown,
      controls.handleSendKey,
      controls.handleSendPermissionShortcut,
      controls.handleSendText,
      controls.handleUploadImage,
      controls.isSendingText,
      controls.rawMode,
      controls.shiftHeld,
      controls.textInputRef,
      controls.toggleAllowDangerKeys,
      controls.toggleAutoEnter,
      controls.toggleCtrl,
      controls.toggleRawMode,
      controls.toggleShift,
    ],
  );
};

const useQuickPanelContextValue = (
  owner: LogsActionsOwnerValue,
): SessionDetailQuickPanelContextValue => {
  const logs = useMemo(
    () => ({
      quickPanelOpen: owner.logs.quickPanelOpen,
      openLogModal: owner.logs.openLogModal,
      closeQuickPanel: owner.logs.closeQuickPanel,
      toggleQuickPanel: owner.logs.toggleQuickPanel,
    }),
    [
      owner.logs.closeQuickPanel,
      owner.logs.openLogModal,
      owner.logs.quickPanelOpen,
      owner.logs.toggleQuickPanel,
    ],
  );
  const actions = useMemo(
    () => ({
      handleOpenPaneHere: owner.actions.handleOpenPaneHere,
      handleOpenPaneInNewWindow: owner.actions.handleOpenPaneInNewWindow,
    }),
    [owner.actions.handleOpenPaneHere, owner.actions.handleOpenPaneInNewWindow],
  );
  return useMemo(() => ({ logs, actions }), [actions, logs]);
};

const useLogModalContextValue = (
  owner: LogsActionsOwnerValue,
): SessionDetailLogModalContextValue => {
  const logs = useMemo(
    () => ({
      logModalOpen: owner.logs.logModalOpen,
      selectedSession: owner.logs.selectedSession,
      selectedLogLines: owner.logs.selectedLogLines,
      selectedLogLoading: owner.logs.selectedLogLoading,
      selectedLogError: owner.logs.selectedLogError,
      closeLogModal: owner.logs.closeLogModal,
    }),
    [
      owner.logs.closeLogModal,
      owner.logs.logModalOpen,
      owner.logs.selectedLogError,
      owner.logs.selectedLogLines,
      owner.logs.selectedLogLoading,
      owner.logs.selectedSession,
    ],
  );
  const actions = useMemo(
    () => ({
      handleOpenHere: owner.actions.handleOpenHere,
      handleOpenInNewTab: owner.actions.handleOpenInNewTab,
    }),
    [owner.actions.handleOpenHere, owner.actions.handleOpenInNewTab],
  );
  return useMemo(() => ({ logs, actions }), [actions, logs]);
};

const useHeaderActionsContextValue = (
  owner: LogsActionsOwnerValue,
): SessionDetailHeaderActionsContextValue =>
  useMemo(
    () => ({ handleTouchCurrentSession: owner.actions.handleTouchCurrentSession }),
    [owner.actions.handleTouchCurrentSession],
  );

const useSidebarActionsContextValue = (
  owner: LogsActionsOwnerValue,
): SessionDetailSidebarActionsContextValue =>
  useMemo(
    () => ({
      handleFocusPane: owner.actions.handleFocusPane,
      handleLaunchAgentInSession: owner.actions.handleLaunchAgentInSession,
      handleTouchPaneSortAnchor: owner.actions.handleTouchPaneSortAnchor,
      handleTouchRepoPin: owner.actions.handleTouchRepoPin,
    }),
    [
      owner.actions.handleFocusPane,
      owner.actions.handleLaunchAgentInSession,
      owner.actions.handleTouchPaneSortAnchor,
      owner.actions.handleTouchRepoPin,
    ],
  );

export const SessionDetailSliceProviders = ({
  base,
  repoPins,
  terminal,
  logsActions,
  children,
}: SessionDetailSliceProvidersProps) => {
  const terminalContext = useTerminalContextValue(terminal);
  const quickPanelContext = useQuickPanelContextValue(logsActions);
  const logModalContext = useLogModalContextValue(logsActions);
  const headerActionsContext = useHeaderActionsContextValue(logsActions);
  const sidebarActionsContext = useSidebarActionsContextValue(logsActions);
  return (
    <SessionDetailBaseContext.Provider value={base}>
      <SessionDetailRepoPinsContext.Provider value={repoPins}>
        <SessionDetailTerminalContext.Provider value={terminalContext}>
          <SessionDetailQuickPanelContext.Provider value={quickPanelContext}>
            <SessionDetailLogModalContext.Provider value={logModalContext}>
              <SessionDetailHeaderActionsContext.Provider value={headerActionsContext}>
                <SessionDetailSidebarActionsContext.Provider value={sidebarActionsContext}>
                  {children}
                </SessionDetailSidebarActionsContext.Provider>
              </SessionDetailHeaderActionsContext.Provider>
            </SessionDetailLogModalContext.Provider>
          </SessionDetailQuickPanelContext.Provider>
        </SessionDetailTerminalContext.Provider>
      </SessionDetailRepoPinsContext.Provider>
    </SessionDetailBaseContext.Provider>
  );
};
