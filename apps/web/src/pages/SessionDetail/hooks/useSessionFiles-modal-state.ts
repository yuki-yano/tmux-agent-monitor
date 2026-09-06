import { useCallback, useState } from "react";

import {
  type ContentTarget,
  type FilesScopeIdentity,
  sameFilesScope,
} from "./session-files-query-runtime";

type FileModalViewMode = "code" | "preview" | "diff";
type FileModalState = {
  scope: FilesScopeIdentity;
  scopeGeneration: number;
  contentTarget: ContentTarget | null;
  viewMode: FileModalViewMode | null;
  showLineNumbers: boolean;
  copiedPath: boolean;
  copyError: string | null;
  copyOperationId: number;
};
type FileModalCopyRequest = {
  target: ContentTarget;
  scopeGeneration: number;
  operationId: number;
};

const createFileModalState = (scope: FilesScopeIdentity, scopeGeneration = 0): FileModalState => ({
  scope,
  scopeGeneration,
  contentTarget: null,
  viewMode: null,
  showLineNumbers: true,
  copiedPath: false,
  copyError: null,
  copyOperationId: 0,
});

const contentTargetEquals = (left: ContentTarget | null, right: ContentTarget) =>
  left === right ||
  (left != null &&
    left.targetPaneId === right.targetPaneId &&
    left.targetRoot === right.targetRoot &&
    left.targetWorktreePath === right.targetWorktreePath &&
    left.path === right.path &&
    left.origin === right.origin &&
    left.highlightLine === right.highlightLine);

const isCurrentCopy = (state: FileModalState, request: FileModalCopyRequest) =>
  state.copyOperationId === request.operationId &&
  state.scopeGeneration === request.scopeGeneration &&
  contentTargetEquals(state.contentTarget, request.target);

// Owns display state only. The caller coordinates content invalidation and preview leases
// before opening or closing the modal.
export const useSessionFilesModalState = (scope: FilesScopeIdentity) => {
  const [state, setState] = useState(() => createFileModalState(scope));
  const scopeChanged = !sameFilesScope(state.scope, scope);
  const current = scopeChanged ? createFileModalState(scope, state.scopeGeneration + 1) : state;
  if (scopeChanged) setState(current);

  const open = useCallback((target: ContentTarget, copyOperationId: number) => {
    setState((previous) => ({
      ...previous,
      contentTarget: target,
      viewMode: target.highlightLine != null ? "code" : null,
      showLineNumbers: true,
      copiedPath: false,
      copyError: null,
      copyOperationId,
    }));
  }, []);
  const close = useCallback((copyOperationId: number) => {
    setState((previous) => ({
      ...createFileModalState(previous.scope, previous.scopeGeneration),
      copyOperationId,
    }));
  }, []);
  const beginCopy = useCallback(
    (operationId: number): FileModalCopyRequest | null => {
      if (current.contentTarget == null) return null;
      setState((previous) => ({ ...previous, copyOperationId: operationId, copyError: null }));
      return {
        target: current.contentTarget,
        scopeGeneration: current.scopeGeneration,
        operationId,
      };
    },
    [current.contentTarget, current.scopeGeneration],
  );
  const finishCopy = useCallback((request: FileModalCopyRequest, copied: boolean) => {
    setState((previous) =>
      isCurrentCopy(previous, request)
        ? {
            ...previous,
            copiedPath: copied,
            copyError: copied ? null : "Failed to copy the file path.",
          }
        : previous,
    );
  }, []);
  const clearCopiedPath = useCallback((request: FileModalCopyRequest) => {
    setState((previous) =>
      isCurrentCopy(previous, request) ? { ...previous, copiedPath: false } : previous,
    );
  }, []);
  const setViewMode = useCallback((viewMode: FileModalViewMode) => {
    setState((previous) => ({ ...previous, viewMode }));
  }, []);
  const toggleLineNumbers = useCallback(() => {
    setState((previous) => ({ ...previous, showLineNumbers: !previous.showLineNumbers }));
  }, []);

  return {
    contentTarget: current.contentTarget,
    viewMode: current.viewMode,
    showLineNumbers: current.showLineNumbers,
    copiedPath: current.copiedPath,
    copyError: current.copyError,
    open,
    close,
    beginCopy,
    finishCopy,
    clearCopiedPath,
    setViewMode,
    toggleLineNumbers,
  };
};

export type SessionFilesModalState = ReturnType<typeof useSessionFilesModalState>;
