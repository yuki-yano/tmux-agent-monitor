import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useWorkspaceTabs } from "../context/workspace-tabs-context";
import { usePwaWorkspaceTabsVM } from "../hooks/usePwaWorkspaceTabsVM";
import { toGroupSortableId, usePwaTabsDnd } from "../hooks/usePwaTabsDnd";
import { resolveWorkspaceTabNavigationIndex } from "../model/workspace-tab-keyboard-navigation";
import { CloseAllWorkspaceTabsButton } from "./CloseAllWorkspaceTabsButton";
import { SortableSessionGroup } from "./SortableSessionGroup";
import { StaticTabChip } from "./StaticTabChip";
import { WorkspaceOverviewTab } from "./WorkspaceOverviewTab";

const PWA_TABS_OFFSET_CSS_VAR = "--vde-pwa-tabs-offset";

export const PwaWorkspaceTabs = () => {
  const {
    enabled,
    activeTabId,
    tabs,
    activateTab,
    closeTab,
    closeAllTabs,
    reorderTabs,
    reorderTabsByClosableOrder,
  } = useWorkspaceTabs();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [controlsGroupElement, setControlsGroupElement] = useState<HTMLDivElement | null>(null);
  const restoreFocusAfterCloseRef = useRef(false);
  const focusedWorkspaceTabIdRef = useRef<string | null>(null);
  const focusedGroupControlKeyRef = useRef<string | null>(null);
  const previousActiveTabIdRef = useRef(activeTabId);
  const { fixedSessionsTab, closableTabs, tabGroups, resolveTabLabel, resolveTabStateClass } =
    usePwaWorkspaceTabsVM(tabs);

  const {
    sensors,
    dragKind,
    activeDragGroup,
    displayedGroupSortableItems,
    orderedTabGroups,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = usePwaTabsDnd({
    tabGroups,
    closableTabs,
    reorderTabs,
    reorderTabsByClosableOrder,
  });
  const previousGroupKeysRef = useRef<string[]>([]);
  let nextGridColumn = fixedSessionsTab == null ? 1 : 2;
  const orderedGroupLayouts = orderedTabGroups.map((group) => {
    const groupColumnStart = nextGridColumn;
    nextGridColumn += group.tabs.length + 1;
    return { group, groupColumnStart };
  });
  const tabGridColumnCount = Math.max(1, nextGridColumn - 1);
  const closeAllGridColumn = tabGridColumnCount + 1;
  const gridColumnCount = closeAllGridColumn;

  const handleTabListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (dragKind != null || event.defaultPrevented) {
        return;
      }
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>("[role=tab]") : null;
      if (target == null || !event.currentTarget.contains(target)) return;
      const tabElements = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")];
      const nextIndex = resolveWorkspaceTabNavigationIndex({
        key: event.key,
        currentIndex: tabElements.indexOf(target),
        tabCount: tabElements.length,
      });
      if (nextIndex == null) return;
      const nextTab = tabElements[nextIndex];
      const nextTabId = nextTab?.dataset.tabId;
      if (nextTab == null || nextTabId == null) return;
      event.preventDefault();
      nextTab.focus();
      activateTab(nextTabId);
    },
    [activateTab, dragKind],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) {
        restoreFocusAfterCloseRef.current = true;
      }
      closeTab(tabId);
    },
    [activeTabId, closeTab],
  );

  useLayoutEffect(() => {
    const currentGroupKeys = orderedTabGroups.map((group) => group.key);
    const focusedGroupKey = focusedGroupControlKeyRef.current;
    const focusedGroupWasRemoved =
      focusedGroupKey != null && !currentGroupKeys.includes(focusedGroupKey);
    if (focusedGroupWasRemoved) {
      const previousGroupIndex = previousGroupKeysRef.current.indexOf(focusedGroupKey);
      const successorGroupKey =
        currentGroupKeys[Math.min(Math.max(previousGroupIndex, 0), currentGroupKeys.length - 1)] ??
        null;
      const successorGroupControl = [
        ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-group-control-key]") ?? []),
      ].find((element) => element.dataset.groupControlKey === successorGroupKey);
      const activeTab = [
        ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []),
      ].find((element) => element.dataset.tabId === activeTabId);
      const focusTarget = successorGroupControl ?? activeTab;
      if (focusTarget != null) {
        focusedGroupControlKeyRef.current = successorGroupKey;
        focusedWorkspaceTabIdRef.current = successorGroupKey == null ? activeTabId : null;
        focusTarget.focus();
      }
    }
    previousGroupKeysRef.current = currentGroupKeys;

    const previousActiveTabId = previousActiveTabIdRef.current;
    const focusedActiveTabWasRemoved =
      previousActiveTabId !== activeTabId &&
      focusedWorkspaceTabIdRef.current === previousActiveTabId &&
      !tabs.some((tab) => tab.id === previousActiveTabId);
    previousActiveTabIdRef.current = activeTabId;
    if (!restoreFocusAfterCloseRef.current && !focusedActiveTabWasRemoved) return;
    const nextActiveTab = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []),
    ].find((element) => element.dataset.tabId === activeTabId);
    if (nextActiveTab == null) return;
    restoreFocusAfterCloseRef.current = false;
    focusedWorkspaceTabIdRef.current = activeTabId;
    nextActiveTab.focus();
  }, [activeTabId, controlsGroupElement, orderedTabGroups, tabs]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const tab =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tab-id]") : null;
    const groupControl =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-group-control-key]")
        : null;
    focusedWorkspaceTabIdRef.current = tab?.dataset.tabId ?? null;
    focusedGroupControlKeyRef.current = groupControl?.dataset.groupControlKey ?? null;
  }, []);

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Element) || !event.currentTarget.contains(nextTarget)) {
      focusedWorkspaceTabIdRef.current = null;
      focusedGroupControlKeyRef.current = null;
      return;
    }
    const nextTab = nextTarget.closest<HTMLElement>("[data-tab-id]");
    const nextGroupControl = nextTarget.closest<HTMLElement>("[data-group-control-key]");
    focusedWorkspaceTabIdRef.current = nextTab?.dataset.tabId ?? null;
    focusedGroupControlKeyRef.current = nextGroupControl?.dataset.groupControlKey ?? null;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (!enabled) {
      document.documentElement.style.removeProperty(PWA_TABS_OFFSET_CSS_VAR);
      return;
    }
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const applyOffset = () => {
      const nextHeight = Math.max(0, Math.ceil(element.getBoundingClientRect().height));
      document.documentElement.style.setProperty(PWA_TABS_OFFSET_CSS_VAR, `${nextHeight}px`);
    };
    applyOffset();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => applyOffset());
    resizeObserver?.observe(element);
    window.addEventListener("resize", applyOffset);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", applyOffset);
      document.documentElement.style.removeProperty(PWA_TABS_OFFSET_CSS_VAR);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      className="pointer-events-none fixed inset-x-0 top-0 z-90 pb-2 pt-[env(safe-area-inset-top)]"
    >
      <div
        aria-hidden="true"
        className="bg-latte-mantle absolute inset-x-0 top-0 h-[env(safe-area-inset-top)]"
      />
      <div className="pointer-events-auto w-full border-b border-[var(--material-stroke)] bg-[var(--material-raised)] px-2 shadow-[var(--shadow-popover)] backdrop-blur-xl">
        <div className="no-scrollbar h-11 overflow-x-auto overflow-y-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={{
              droppable: {
                strategy: MeasuringStrategy.Always,
              },
            }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div
              className="relative grid h-full min-w-max items-center gap-x-1.5"
              style={{ gridTemplateColumns: `repeat(${gridColumnCount}, max-content)` }}
            >
              <div
                role="tablist"
                aria-label="PWA workspace tabs"
                onKeyDown={handleTabListKeyDown}
                className="grid h-full items-center gap-x-1.5"
                style={{
                  gridColumn: `1 / ${closeAllGridColumn}`,
                  gridRow: 1,
                  gridTemplateColumns: "subgrid",
                }}
              >
                {fixedSessionsTab && (
                  <WorkspaceOverviewTab
                    tab={fixedSessionsTab}
                    active={activeTabId === fixedSessionsTab.id}
                    onActivate={activateTab}
                  />
                )}
                <SortableContext
                  items={displayedGroupSortableItems}
                  strategy={horizontalListSortingStrategy}
                >
                  {orderedGroupLayouts.map(({ group, groupColumnStart }) => (
                    <SortableSessionGroup
                      key={group.key}
                      group={group}
                      groupSortableId={toGroupSortableId(group.key)}
                      activeTabId={activeTabId}
                      dragKind={dragKind}
                      groupColumnStart={groupColumnStart}
                      controlsGroupElement={controlsGroupElement}
                      resolveTabLabel={resolveTabLabel}
                      resolveTabStateClass={resolveTabStateClass}
                      onActivateTab={activateTab}
                      onCloseTab={handleCloseTab}
                    />
                  ))}
                </SortableContext>
              </div>
              <div
                ref={setControlsGroupElement}
                role="group"
                aria-label="Workspace tab controls"
                className="pointer-events-none grid h-full items-center gap-x-1.5"
                style={{
                  gridColumn: `1 / ${closeAllGridColumn}`,
                  gridRow: 1,
                  gridTemplateColumns: "subgrid",
                }}
              />
              <div
                className="flex h-full items-center"
                data-close-all-tabs-control=""
                style={{ gridColumn: closeAllGridColumn, gridRow: 1 }}
              >
                <CloseAllWorkspaceTabsButton
                  tabCount={closableTabs.length}
                  onConfirm={closeAllTabs}
                />
              </div>
            </div>
            <DragOverlay>
              {activeDragGroup && (
                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--material-stroke)] bg-[var(--material-raised)] px-1.5 py-1.5 shadow-[var(--shadow-popover)] backdrop-blur-xl">
                  <span className="text-latte-text inline-flex h-7 items-center rounded-md bg-[var(--control-track)] px-1.5 text-[10px] font-semibold tracking-wide">
                    {activeDragGroup.label}
                  </span>
                  {activeDragGroup.tabs.map((tab) => (
                    <StaticTabChip
                      key={tab.id}
                      tab={tab}
                      label={resolveTabLabel(tab)}
                      active={activeTabId === tab.id}
                      statusClassName={resolveTabStateClass(tab)}
                    />
                  ))}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
};
