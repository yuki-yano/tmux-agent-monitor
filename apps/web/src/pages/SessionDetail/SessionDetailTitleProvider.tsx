import { type ReactNode, createContext, use, useMemo } from "react";

import { useSessionDetailBase } from "./SessionDetailContexts";
import { useSessionTitleEditor } from "./hooks/useSessionTitleEditor";

type SessionDetailTitleContextValue = Pick<
  ReturnType<typeof useSessionTitleEditor>,
  | "titleDraft"
  | "titleEditing"
  | "titleSaving"
  | "titleError"
  | "openTitleEditor"
  | "closeTitleEditor"
  | "updateTitleDraft"
  | "saveTitle"
  | "resetTitle"
>;

const SessionDetailTitleContext = createContext<SessionDetailTitleContextValue | null>(null);

export const SessionDetailTitleProvider = ({ children }: { children: ReactNode }) => {
  const base = useSessionDetailBase();
  const {
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    closeTitleEditor,
    updateTitleDraft,
    saveTitle,
    resetTitle,
  } = useSessionTitleEditor({
    session: base.session,
    paneId: base.paneId,
    updateSessionTitle: base.updateSessionTitle,
    resetSessionTitle: base.resetSessionTitle,
  });
  const value = useMemo<SessionDetailTitleContextValue>(
    () => ({
      titleDraft,
      titleEditing,
      titleSaving,
      titleError,
      openTitleEditor,
      closeTitleEditor,
      updateTitleDraft,
      saveTitle,
      resetTitle,
    }),
    [
      closeTitleEditor,
      openTitleEditor,
      resetTitle,
      saveTitle,
      titleDraft,
      titleEditing,
      titleError,
      titleSaving,
      updateTitleDraft,
    ],
  );

  return (
    <SessionDetailTitleContext.Provider value={value}>
      {children}
    </SessionDetailTitleContext.Provider>
  );
};

export const useSessionDetailTitle = (): SessionDetailTitleContextValue => {
  const value = use(SessionDetailTitleContext);
  if (value == null) {
    throw new Error("useSessionDetailTitle must be used within a SessionDetailTitleProvider");
  }
  return value;
};
