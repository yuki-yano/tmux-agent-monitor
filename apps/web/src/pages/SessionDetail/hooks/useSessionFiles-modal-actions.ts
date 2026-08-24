import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type { RepoFileContent } from "@vde-monitor/shared";
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { copyToClipboard } from "@/lib/copy-to-clipboard";

import type { FilesLocalState } from "./session-files-local-state";
import {
  type ContentQueryCleanupCoordinator,
  type ContentTarget,
  type FilesScopeIdentity,
  type PreviewLeaseController,
  normalizeAbsoluteLogFilePath,
  normalizeRepoFilePath,
  sameContentResource,
} from "./session-files-query-runtime";

const FILE_MODAL_COPY_INDICATOR_MS = 1200;

export const createFileModalCopyController = () => ({
  operation: 0,
  modalOperation: 0,
  activeTarget: null as ContentTarget | null,
  timers: new Set<number>(),
});
export type FileModalCopyController = ReturnType<typeof createFileModalCopyController>;

export const clearFileModalCopyTimers = (controller: FileModalCopyController) => {
  controller.timers.forEach((timer) => window.clearTimeout(timer));
  controller.timers.clear();
};

const nextCopyOperation = (controller: FileModalCopyController) => {
  controller.operation += 1;
  return controller.operation;
};

const nextModalOperation = (controller: FileModalCopyController) => {
  controller.modalOperation += 1;
  return controller.modalOperation;
};

export const syncActiveContentTarget = (
  controller: FileModalCopyController,
  target: ContentTarget | null,
) => {
  controller.activeTarget = target;
};

const isCurrentModalOperation = (controller: FileModalCopyController, operation: number) =>
  controller.modalOperation === operation;

const addCopyTimer = (controller: FileModalCopyController, timer: number) => {
  controller.timers.add(timer);
};

const deleteCopyTimer = (controller: FileModalCopyController, timer: number) => {
  controller.timers.delete(timer);
};

const contentTargetEquals = (left: ContentTarget | null, right: ContentTarget | null) =>
  left === right ||
  (left != null &&
    right != null &&
    left.targetPaneId === right.targetPaneId &&
    left.targetRoot === right.targetRoot &&
    left.targetWorktreePath === right.targetWorktreePath &&
    left.path === right.path &&
    left.origin === right.origin &&
    left.highlightLine === right.highlightLine);

export const useSessionFilesModalActions = ({
  contentCleanup,
  copyController,
  currentState,
  getContentQueryKey,
  paneId,
  previewLeases,
  revealFilePath,
  scope,
  setState,
}: {
  contentCleanup: ContentQueryCleanupCoordinator;
  copyController: FileModalCopyController;
  currentState: FilesLocalState;
  getContentQueryKey: (target: ContentTarget) => QueryKey;
  paneId: string;
  previewLeases: PreviewLeaseController;
  revealFilePath: (path: string) => void;
  scope: FilesScopeIdentity;
  setState: Dispatch<SetStateAction<FilesLocalState>>;
}) => {
  const queryClient = useQueryClient();
  const cleanupContentTarget = useCallback(
    (target: ContentTarget) => {
      const key = getContentQueryKey(target);
      const file = queryClient.getQueryData<RepoFileContent>(key);
      previewLeases.releaseToken(target.targetPaneId, file?.preview?.token);
      void queryClient.cancelQueries({ queryKey: key, exact: true });
      contentCleanup.invalidate(queryClient, key);
    },
    [contentCleanup, getContentQueryKey, previewLeases, queryClient],
  );
  const openFileModalByPath = useCallback(
    (
      rawPath: string,
      options: {
        paneId: string;
        targetRoot: string;
        targetWorktreePath: string | null;
        origin: "navigator" | "log";
        highlightLine?: number | null;
      },
    ) => {
      const modalOperation = nextModalOperation(copyController);
      contentCleanup.cancelReopens();
      const path =
        options.origin === "log" && rawPath.trim().startsWith("/")
          ? normalizeAbsoluteLogFilePath(rawPath)
          : normalizeRepoFilePath(rawPath);
      if (path == null) {
        setState((previous) => ({ ...previous, fileResolveError: "File not found." }));
        return;
      }
      const target: ContentTarget = {
        targetPaneId: options.paneId,
        targetRoot: options.targetRoot,
        targetWorktreePath: options.targetWorktreePath,
        path,
        origin: options.origin,
        highlightLine: options.highlightLine ?? null,
      };
      const targetKey = getContentQueryKey(target);
      const commitOpen = () => {
        if (!isCurrentModalOperation(copyController, modalOperation)) return;
        const previousTarget = copyController.activeTarget;
        if (!sameContentResource(previousTarget, target) && previousTarget != null) {
          cleanupContentTarget(previousTarget);
        }
        syncActiveContentTarget(copyController, target);
        if (options.origin === "navigator") revealFilePath(path);
        const copyOperationId = nextCopyOperation(copyController);
        setState((previous) => ({
          ...previous,
          selectedFilePath: options.origin === "navigator" ? path : previous.selectedFilePath,
          contentTarget: target,
          fileModalMarkdownViewMode: options.highlightLine != null ? "code" : null,
          fileModalShowLineNumbers: true,
          fileModalCopyError: null,
          fileModalCopiedPath: false,
          copyOperationId,
        }));
      };
      if (contentCleanup.reopenAfterCleanup(queryClient, targetKey, commitOpen)) return;
      commitOpen();
    },
    [
      cleanupContentTarget,
      contentCleanup,
      copyController,
      getContentQueryKey,
      queryClient,
      revealFilePath,
      setState,
    ],
  );
  const onOpenFileModal = useCallback(
    (path: string) => {
      if (scope.resolvedRoot == null) return;
      openFileModalByPath(path, {
        paneId,
        targetRoot: scope.resolvedRoot,
        targetWorktreePath: scope.worktreePath,
        origin: "navigator",
      });
    },
    [openFileModalByPath, paneId, scope],
  );
  const onCloseFileModal = useCallback(() => {
    nextModalOperation(copyController);
    contentCleanup.cancelReopens();
    const target = copyController.activeTarget;
    syncActiveContentTarget(copyController, null);
    if (target != null) cleanupContentTarget(target);
    clearFileModalCopyTimers(copyController);
    const copyOperationId = nextCopyOperation(copyController);
    setState((previous) => ({
      ...previous,
      contentTarget: null,
      fileModalMarkdownViewMode: null,
      fileModalShowLineNumbers: true,
      fileModalCopiedPath: false,
      fileModalCopyError: null,
      copyOperationId,
    }));
  }, [cleanupContentTarget, contentCleanup, copyController, setState]);
  const onCopyFileModalPath = useCallback(async () => {
    const target = currentState.contentTarget;
    if (target == null) return;
    const operationId = nextCopyOperation(copyController);
    const scopeGeneration = currentState.scopeGeneration;
    setState((previous) => ({
      ...previous,
      copyOperationId: operationId,
      fileModalCopyError: null,
    }));
    const copied = await copyToClipboard(target.path);
    setState((previous) => {
      if (
        previous.copyOperationId !== operationId ||
        previous.scopeGeneration !== scopeGeneration ||
        !contentTargetEquals(previous.contentTarget, target)
      ) {
        return previous;
      }
      return {
        ...previous,
        fileModalCopiedPath: copied,
        fileModalCopyError: copied ? null : "Failed to copy the file path.",
      };
    });
    if (copied) {
      const timer = window.setTimeout(() => {
        deleteCopyTimer(copyController, timer);
        setState((previous) =>
          previous.copyOperationId === operationId &&
          previous.scopeGeneration === scopeGeneration &&
          contentTargetEquals(previous.contentTarget, target)
            ? { ...previous, fileModalCopiedPath: false }
            : previous,
        );
      }, FILE_MODAL_COPY_INDICATOR_MS);
      addCopyTimer(copyController, timer);
    }
  }, [copyController, currentState.contentTarget, currentState.scopeGeneration, setState]);

  return {
    openFileModalByPath,
    onOpenFileModal,
    onCloseFileModal,
    onCopyFileModalPath,
    onSetFileModalMarkdownViewMode: (mode: "code" | "preview" | "diff") =>
      setState((previous) => ({ ...previous, fileModalMarkdownViewMode: mode })),
    onToggleFileModalLineNumbers: () =>
      setState((previous) => ({
        ...previous,
        fileModalShowLineNumbers: !previous.fileModalShowLineNumbers,
      })),
  };
};
