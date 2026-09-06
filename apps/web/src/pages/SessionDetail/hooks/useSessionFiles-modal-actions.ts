import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type { RepoFileContent } from "@vde-monitor/shared";
import { useCallback } from "react";

import { copyToClipboard } from "@/lib/copy-to-clipboard";

import type { SessionFilesModalState } from "./useSessionFiles-modal-state";
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

export const useSessionFilesModalActions = ({
  contentCleanup,
  copyController,
  modal,
  getContentQueryKey,
  paneId,
  previewLeases,
  selectNavigatorFile,
  reportResolveError,
  scope,
}: {
  contentCleanup: ContentQueryCleanupCoordinator;
  copyController: FileModalCopyController;
  modal: SessionFilesModalState;
  getContentQueryKey: (target: ContentTarget) => QueryKey;
  paneId: string;
  previewLeases: PreviewLeaseController;
  selectNavigatorFile: (path: string) => void;
  reportResolveError: (message: string) => void;
  scope: FilesScopeIdentity;
}) => {
  const queryClient = useQueryClient();
  const { contentTarget, open, close, beginCopy, finishCopy, clearCopiedPath } = modal;
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
        reportResolveError("File not found.");
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
        if (options.origin === "navigator") selectNavigatorFile(path);
        open(target, nextCopyOperation(copyController));
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
      selectNavigatorFile,
      reportResolveError,
      open,
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
    close(nextCopyOperation(copyController));
  }, [cleanupContentTarget, contentCleanup, copyController, close]);
  const onCopyFileModalPath = useCallback(async () => {
    if (contentTarget == null) return;
    const request = beginCopy(nextCopyOperation(copyController));
    if (request == null) return;
    const copied = await copyToClipboard(request.target.path);
    finishCopy(request, copied);
    if (copied) {
      const timer = window.setTimeout(() => {
        deleteCopyTimer(copyController, timer);
        clearCopiedPath(request);
      }, FILE_MODAL_COPY_INDICATOR_MS);
      addCopyTimer(copyController, timer);
    }
  }, [copyController, contentTarget, beginCopy, finishCopy, clearCopiedPath]);

  return {
    openFileModalByPath,
    onOpenFileModal,
    onCloseFileModal,
    onCopyFileModalPath,
    onSetFileModalMarkdownViewMode: modal.setViewMode,
    onToggleFileModalLineNumbers: modal.toggleLineNumbers,
  };
};
