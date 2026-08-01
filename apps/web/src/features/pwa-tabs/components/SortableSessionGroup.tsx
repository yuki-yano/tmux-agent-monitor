import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createPortal } from "react-dom";

import { type DragKind, animateGroupLayoutChanges, toTabSortableId } from "../hooks/usePwaTabsDnd";
import { SYSTEM_CHAT_GRID_TAB_ID, type WorkspaceTab } from "../model/workspace-tabs";
import type { WorkspaceTabGroup } from "../hooks/usePwaWorkspaceTabsVM";
import { SortableTabItem } from "./SortableTabItem";

export type SortableSessionGroupProps = {
  group: WorkspaceTabGroup;
  groupSortableId: string;
  activeTabId: string;
  dragKind: DragKind;
  groupColumnStart: number;
  controlsGroupElement: HTMLDivElement | null;
  resolveTabLabel: (tab: WorkspaceTab) => string;
  resolveTabStateClass: (tab: WorkspaceTab) => string;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
};

export const SortableSessionGroup = ({
  group,
  groupSortableId,
  activeTabId,
  dragKind,
  groupColumnStart,
  controlsGroupElement,
  resolveTabLabel,
  resolveTabStateClass,
  onActivateTab,
  onCloseTab,
}: SortableSessionGroupProps) => {
  const sortableDisabled = dragKind === "tab";
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: groupSortableId,
    disabled: sortableDisabled,
    animateLayoutChanges: animateGroupLayoutChanges,
    transition: {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });
  const style = {
    display: "grid",
    gridColumn: `${groupColumnStart} / span ${group.tabs.length + 1}`,
    gridRow: 1,
    gridTemplateColumns: "subgrid",
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    zIndex: isDragging ? 40 : undefined,
  };
  const latestTabInGroup = group.tabs.reduce<WorkspaceTab | null>((latest, candidate) => {
    if (latest == null) {
      return candidate;
    }
    if (candidate.lastActivatedAt > latest.lastActivatedAt) {
      return candidate;
    }
    if (candidate.lastActivatedAt === latest.lastActivatedAt && candidate.id === activeTabId) {
      return candidate;
    }
    return latest;
  }, null);
  const isActiveGroup = group.tabs.some((tab) => tab.id === activeTabId);

  const groupControl = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      style={{
        gridColumn: groupColumnStart,
        gridRow: 1,
        transform: CSS.Transform.toString(transform) ?? undefined,
        transition: transition ?? undefined,
        zIndex: isDragging ? 40 : 10,
      }}
      data-group-control-key={group.key}
      aria-label={`Reorder session group ${group.label}`}
      onClick={(event) => {
        if (event.defaultPrevented || isDragging) {
          return;
        }
        if (latestTabInGroup == null) {
          return;
        }
        onActivateTab(latestTabInGroup.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      className={[
        "text-latte-subtext0 hover:text-latte-text hover:border-latte-blue/38 pointer-events-auto relative ml-1.5 inline-flex h-7 items-center rounded-md border border-[var(--control-stroke)] bg-[var(--control-track)] px-1.5 text-[10px] font-semibold tracking-wide transition-[scale,background-color,color,border-color,box-shadow] duration-200 ease-out after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] active:scale-[0.96] active:duration-100",
        isActiveGroup
          ? "text-latte-text border-latte-blue/62 bg-latte-blue/14 shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.12)]"
          : "",
        "cursor-grab touch-pan-x select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none] active:cursor-grabbing",
        isDragging ? "bg-latte-base/90 text-latte-text" : "",
      ].join(" ")}
      {...attributes}
      {...listeners}
    >
      {group.label}
    </button>
  );

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={[
          "relative items-center pl-1.5 before:absolute before:left-0 before:top-1/2 before:h-5 before:-translate-y-1/2 before:border-l before:border-latte-surface2/65 before:content-['']",
          isDragging ? "opacity-45" : "",
        ].join(" ")}
        data-group-key={group.key}
        data-dragging={isDragging ? "true" : "false"}
      >
        <span
          aria-hidden="true"
          style={{ gridColumn: 1, gridRow: 1 }}
          className="invisible inline-flex h-7 items-center rounded-md border px-1.5 text-[10px] font-semibold tracking-wide"
        >
          {group.label}
        </span>
        <SortableContext
          items={group.tabs.map((tab) => toTabSortableId(tab.id))}
          strategy={rectSortingStrategy}
        >
          {group.tabs.map((tab, index) => {
            const label = resolveTabLabel(tab);
            const isActive = activeTabId === tab.id;
            const stateClass = resolveTabStateClass(tab);
            return (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                tabSortableId={toTabSortableId(tab.id)}
                label={label}
                active={isActive}
                showGridIcon={tab.id === SYSTEM_CHAT_GRID_TAB_ID}
                dragKind={dragKind}
                statusClassName={stateClass}
                gridColumn={index + 2}
                controlsColumn={groupColumnStart + index + 1}
                controlsGroupElement={controlsGroupElement}
                onActivate={onActivateTab}
                onClose={onCloseTab}
              />
            );
          })}
        </SortableContext>
      </div>
      {controlsGroupElement != null && createPortal(groupControl, controlsGroupElement)}
    </>
  );
};
