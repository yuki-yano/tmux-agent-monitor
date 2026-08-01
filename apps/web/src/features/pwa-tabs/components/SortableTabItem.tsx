import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Grid2x2, X } from "lucide-react";
import { createPortal } from "react-dom";

import type { WorkspaceTab } from "../model/workspace-tabs";
import {
  type DragKind,
  TAB_LAYOUT_TRANSITION,
  animateTabLayoutChanges,
} from "../hooks/usePwaTabsDnd";

export type SortableTabItemProps = {
  tab: WorkspaceTab;
  tabSortableId: string;
  label: string;
  active: boolean;
  showGridIcon: boolean;
  dragKind: DragKind;
  statusClassName: string;
  gridColumn: number;
  controlsColumn: number;
  controlsGroupElement: HTMLDivElement | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

export const SortableTabItem = ({
  tab,
  tabSortableId,
  label,
  active,
  showGridIcon,
  dragKind,
  statusClassName,
  gridColumn,
  controlsColumn,
  controlsGroupElement,
  onActivate,
  onClose,
}: SortableTabItemProps) => {
  const sortableDisabled = dragKind === "group";
  const showCloseButton = active && dragKind == null;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tabSortableId,
    disabled: sortableDisabled,
    attributes: {
      role: "tab",
      tabIndex: active ? 0 : -1,
    },
    animateLayoutChanges: animateTabLayoutChanges,
    transition: {
      duration: 180,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });
  const style = {
    gridColumn,
    gridRow: 1,
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: dragKind === "group" ? undefined : (transition ?? TAB_LAYOUT_TRANSITION),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex items-center gap-1"
      data-dragging={isDragging ? "true" : "false"}
    >
      {showGridIcon && (
        <span className="text-latte-overlay1 inline-flex h-4 w-4 items-center justify-center">
          <Grid2x2 className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
      {/* dnd-kit labels sortables as "sortable". Keep native tab semantics while forwarding
          its current and future interaction attributes. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        role="tab"
        aria-pressed={undefined}
        aria-roledescription={undefined}
        {...listeners}
        aria-selected={active}
        aria-keyshortcuts={active ? "Delete" : undefined}
        data-tab-id={tab.id}
        onClick={() => onActivate(tab.id)}
        onKeyDown={(event) => {
          if (active && event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            onClose(tab.id);
            return;
          }
          listeners?.onKeyDown?.(event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        className={[
          "text-latte-subtext0 hover:text-latte-text hover:border-latte-blue/45 relative inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl border border-[var(--control-stroke)] bg-[var(--control-track)] pl-2 text-[11px] font-semibold transition-[scale,background-color,color,border-color,box-shadow] duration-200 ease-out after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] active:scale-[0.96] active:duration-100",
          "touch-pan-x select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]",
          "data-[active=true]:border-latte-blue/70 data-[active=true]:bg-latte-blue/16 data-[active=true]:text-latte-text data-[active=true]:shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.14),0_1px_3px_rgb(var(--ctp-shadow)/0.14)]",
          showCloseButton ? "pr-5" : "pr-2",
          isDragging ? "opacity-90" : "",
        ].join(" ")}
        data-active={active ? "true" : "false"}
      >
        <span
          className={`border-latte-overlay2/60 h-2.5 w-2.5 shrink-0 rounded-full border ${statusClassName}`}
          aria-hidden="true"
        />
        <span className="max-w-[5.2rem] truncate" title={label}>
          {label}
        </span>
      </button>
      {showCloseButton &&
        controlsGroupElement != null &&
        createPortal(
          <button
            type="button"
            tabIndex={-1}
            style={{ gridColumn: controlsColumn, gridRow: 1 }}
            className="text-latte-overlay1 hover:text-latte-text hover:bg-latte-surface1/55 pointer-events-auto relative z-20 mr-[3px] inline-flex h-4 w-4 items-center justify-center self-center justify-self-end rounded-xs transition-[scale,background-color,color] duration-200 ease-out after:absolute after:-inset-2 after:content-[''] active:scale-[0.96] active:duration-100"
            aria-label={`Close ${label}`}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X className="h-3 w-3 translate-y-[0.5px]" />
          </button>,
          controlsGroupElement,
        )}
    </div>
  );
};
