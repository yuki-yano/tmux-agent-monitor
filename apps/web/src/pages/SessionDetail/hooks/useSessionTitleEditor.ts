import type { SessionSummary } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  titleDraftAtom,
  titleEditingAtom,
  titleErrorAtom,
  titleSavingAtom,
} from "../atoms/titleAtoms";
type UseSessionTitleEditorParams = {
  session: SessionSummary | null;
  paneId: string;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
};

export const useSessionTitleEditor = ({
  session,
  paneId,
  updateSessionTitle,
}: UseSessionTitleEditorParams) => {
  const sessionCustomTitle = session?.customTitle ?? null;
  const [titleDraft, setTitleDraft] = useAtom(titleDraftAtom);
  const [titleEditing, setTitleEditing] = useAtom(titleEditingAtom);
  const [titleSaving, setTitleSaving] = useAtom(titleSavingAtom);
  const [titleError, setTitleError] = useAtom(titleErrorAtom);

  useEffect(() => {
    setTitleEditing(false);
    setTitleSaving(false);
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
  }, [paneId, sessionCustomTitle, setTitleDraft, setTitleEditing, setTitleError, setTitleSaving]);

  useEffect(() => {
    if (titleEditing) return;
    setTitleDraft(sessionCustomTitle ?? "");
  }, [sessionCustomTitle, titleEditing, setTitleDraft]);

  const openTitleEditor = useCallback(() => {
    if (!session) return;
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
    setTitleEditing(true);
  }, [session, sessionCustomTitle, setTitleDraft, setTitleEditing, setTitleError]);

  const closeTitleEditor = useCallback(() => {
    setTitleEditing(false);
    setTitleError(null);
    setTitleDraft(sessionCustomTitle ?? "");
  }, [sessionCustomTitle, setTitleDraft, setTitleEditing, setTitleError]);

  const updateTitleDraft = useCallback(
    (value: string) => {
      setTitleDraft(value);
      setTitleError(null);
    },
    [setTitleDraft, setTitleError],
  );

  const saveTitle = useCallback(async () => {
    if (!session || titleSaving) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length > 80) {
      setTitleError("Title must be 80 characters or less.");
      return;
    }
    setTitleSaving(true);
    try {
      await updateSessionTitle(session.paneId, trimmed.length > 0 ? trimmed : null);
      setTitleEditing(false);
      setTitleError(null);
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : API_ERROR_MESSAGES.updateTitle);
    } finally {
      setTitleSaving(false);
    }
  }, [
    session,
    titleDraft,
    titleSaving,
    updateSessionTitle,
    setTitleEditing,
    setTitleError,
    setTitleSaving,
  ]);

  const clearTitle = useCallback(async () => {
    if (!session || titleSaving) return;
    setTitleSaving(true);
    try {
      await updateSessionTitle(session.paneId, null);
      setTitleEditing(false);
      setTitleDraft("");
      setTitleError(null);
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : API_ERROR_MESSAGES.updateTitle);
    } finally {
      setTitleSaving(false);
    }
  }, [
    session,
    titleSaving,
    updateSessionTitle,
    setTitleDraft,
    setTitleEditing,
    setTitleError,
    setTitleSaving,
  ]);

  return {
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    closeTitleEditor,
    updateTitleDraft,
    saveTitle,
    clearTitle,
  };
};
