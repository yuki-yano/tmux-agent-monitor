import type { DiffFile } from "@vde-monitor/shared";
import { atom } from "jotai";

export const diffErrorAtom = atom<string | null>(null);
export const diffFilesAtom = atom<Record<string, DiffFile>>({});
export const diffOpenAtom = atom<Record<string, boolean>>({});
export const diffLoadingFilesAtom = atom<Record<string, boolean>>({});
export const diffExpandedAtom = atom<Record<string, boolean>>({});
