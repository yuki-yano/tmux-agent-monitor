import { atom } from "jotai";

import {
  DEFAULT_SESSION_LIST_FILTER,
  type SessionListFilter,
} from "@/features/shared-session-ui/model/session-list-filters";

export const SIDEBAR_LIST_SCROLL_RESTORATION_ID = "session-sidebar-list";
export const sidebarListFilterAtom = atom<SessionListFilter>(DEFAULT_SESSION_LIST_FILTER);
export const sidebarListScrollTopAtom = atom(0);
export const sidebarListNavigationPendingAtom = atom(false);
