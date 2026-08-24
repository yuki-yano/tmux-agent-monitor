import { memo, useMemo } from "react";

import { useSessionDetailBase, useSessionDetailHeaderActions } from "../../SessionDetailContexts";
import { useSessionDetailTitle } from "../../SessionDetailTitleProvider";
import { SessionHeader } from "../SessionHeader";

export const ConnectedSessionHeader = memo(() => {
  const base = useSessionDetailBase();
  const actions = useSessionDetailHeaderActions();
  const title = useSessionDetailTitle();
  const state = useMemo(
    () =>
      base.session == null
        ? null
        : {
            session: base.session,
            connectionIssue: base.connectionIssue,
            nowMs: base.nowMs,
            titleDraft: title.titleDraft,
            titleEditing: title.titleEditing,
            titleSaving: title.titleSaving,
            titleError: title.titleError,
          },
    [
      base.connectionIssue,
      base.nowMs,
      base.session,
      title.titleDraft,
      title.titleEditing,
      title.titleError,
      title.titleSaving,
    ],
  );
  const headerActions = useMemo(
    () => ({
      onTitleDraftChange: title.updateTitleDraft,
      onTitleSave: title.saveTitle,
      onTitleReset: title.resetTitle,
      onOpenTitleEditor: title.openTitleEditor,
      onCloseTitleEditor: title.closeTitleEditor,
      onTouchSession: actions.handleTouchCurrentSession,
    }),
    [
      actions.handleTouchCurrentSession,
      title.closeTitleEditor,
      title.openTitleEditor,
      title.resetTitle,
      title.saveTitle,
      title.updateTitleDraft,
    ],
  );

  return state == null ? null : <SessionHeader state={state} actions={headerActions} />;
});

ConnectedSessionHeader.displayName = "ConnectedSessionHeader";
