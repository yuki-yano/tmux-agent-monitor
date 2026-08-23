import { useEffect, useMemo, useState } from "react";

const DETAIL_SECTION_TAB_VALUES = [
  "keys",
  "timeline",
  "file",
  "changes",
  "commits",
  "branches",
  "worktrees",
  "notes",
] as const;
const DETAIL_SECTION_TAB_STORAGE_KEY_PREFIX = "vde-monitor-session-detail-section-tab";
const DEFAULT_DETAIL_SECTION_TAB: DetailSectionTab = "timeline";
const DETAIL_SECTION_TAB_TEXT_MIN_WIDTH = 340;
const SECTION_TAB_STORAGE_REPO_FALLBACK = "__unknown_repo__";
const SECTION_TAB_STORAGE_BRANCH_FALLBACK = "__no_branch__";

export const CLOSE_DETAIL_TAB_VALUE = "__close__";
export const SECTION_TAB_ICON_ONLY_CLASS = "inline-flex h-8 items-center justify-center p-0 sm:h-9";
export const SECTION_TAB_TEXT_CLASS =
  "inline-flex h-8 items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] leading-tight sm:h-9 sm:gap-1.5 sm:px-2 sm:text-[11px]";

export type DetailSectionTab = (typeof DETAIL_SECTION_TAB_VALUES)[number];
type SectionTabValue = DetailSectionTab | typeof CLOSE_DETAIL_TAB_VALUE;

type SectionTabStorageScope = {
  repoRoot?: null | string;
  branch?: null | string;
};

const isDetailSectionTab = (value: unknown): value is DetailSectionTab =>
  typeof value === "string" && DETAIL_SECTION_TAB_VALUES.includes(value as DetailSectionTab);

const isSectionTabValue = (value: unknown): value is SectionTabValue =>
  value === CLOSE_DETAIL_TAB_VALUE || isDetailSectionTab(value);

const buildDetailSectionTabStorageKey = (
  scope: SectionTabStorageScope | null | undefined,
): string =>
  `${DETAIL_SECTION_TAB_STORAGE_KEY_PREFIX}:${encodeURIComponent(scope?.repoRoot ?? SECTION_TAB_STORAGE_REPO_FALLBACK)}:${encodeURIComponent(scope?.branch ?? SECTION_TAB_STORAGE_BRANCH_FALLBACK)}`;

const readStoredSectionTabValue = (storageKey: string): SectionTabValue => {
  if (typeof window === "undefined") {
    return DEFAULT_DETAIL_SECTION_TAB;
  }
  const stored = window.localStorage.getItem(storageKey);
  return isSectionTabValue(stored) ? stored : DEFAULT_DETAIL_SECTION_TAB;
};

type UseSessionDetailSectionTabsInput = {
  scope: SectionTabStorageScope | null | undefined;
};

export const useSessionDetailSectionTabs = ({ scope }: UseSessionDetailSectionTabsInput) => {
  const repoRoot = scope?.repoRoot ?? null;
  const branch = scope?.branch ?? null;
  const sectionTabStorageKey = useMemo(
    () =>
      buildDetailSectionTabStorageKey({
        repoRoot,
        branch,
      }),
    [branch, repoRoot],
  );
  const [sectionTabsListElement, setSectionTabsListElement] = useState<HTMLDivElement | null>(null);
  const [selectedSectionTabState, setSelectedSectionTabState] = useState(() => ({
    storageKey: sectionTabStorageKey,
    value: readStoredSectionTabValue(sectionTabStorageKey),
  }));
  const [sectionTabsIconOnly, setSectionTabsIconOnly] = useState(false);
  const selectedSectionTabValue =
    selectedSectionTabState.storageKey === sectionTabStorageKey
      ? selectedSectionTabState.value
      : readStoredSectionTabValue(sectionTabStorageKey);
  const handleSectionTabChange = (value: string) => {
    if (!isSectionTabValue(value)) {
      return;
    }
    setSelectedSectionTabState({
      storageKey: sectionTabStorageKey,
      value,
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(sectionTabStorageKey, selectedSectionTabValue);
  }, [sectionTabStorageKey, selectedSectionTabValue]);

  useEffect(() => {
    const tabListElement = sectionTabsListElement;
    if (!tabListElement) {
      return;
    }

    const evaluateTabLabelVisibility = () => {
      const nextIconOnly = tabListElement.clientWidth < DETAIL_SECTION_TAB_TEXT_MIN_WIDTH;
      setSectionTabsIconOnly((previous) => (previous === nextIconOnly ? previous : nextIconOnly));
    };

    const rafId = window.requestAnimationFrame(evaluateTabLabelVisibility);
    let settleInnerRafId: number | null = null;
    const settleRafId = window.requestAnimationFrame(() => {
      settleInnerRafId = window.requestAnimationFrame(evaluateTabLabelVisibility);
    });
    const settleTimeoutId = window.setTimeout(evaluateTabLabelVisibility, 180);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            evaluateTabLabelVisibility();
          });
    resizeObserver?.observe(tabListElement);
    window.addEventListener("resize", evaluateTabLabelVisibility);
    const fontFaceSet =
      typeof document !== "undefined" && "fonts" in document ? document.fonts : null;
    const onFontLoadingDone = () => {
      evaluateTabLabelVisibility();
    };
    fontFaceSet?.addEventListener("loadingdone", onFontLoadingDone);
    void fontFaceSet?.ready.then(() => {
      evaluateTabLabelVisibility();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      window.cancelAnimationFrame(settleRafId);
      if (settleInnerRafId != null) {
        window.cancelAnimationFrame(settleInnerRafId);
      }
      window.clearTimeout(settleTimeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", evaluateTabLabelVisibility);
      fontFaceSet?.removeEventListener("loadingdone", onFontLoadingDone);
    };
  }, [sectionTabsListElement]);

  return {
    selectedSectionTabValue,
    sectionTabsIconOnly,
    sectionTabsListElement,
    setSectionTabsListElement,
    handleSectionTabChange,
  };
};
