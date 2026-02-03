import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Pin,
  Send,
} from "lucide-react";
import type { FormEvent, ReactNode, RefObject } from "react";

import { Button, Callout, IconButton, ModifierToggle, PillToggle, Toolbar } from "@/components/ui";

type ControlsPanelProps = {
  readOnly: boolean;
  connected: boolean;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  onSendText: () => void;
  autoEnter: boolean;
  onToggleAutoEnter: () => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
  shiftHeld: boolean;
  onToggleShift: () => void;
  ctrlHeld: boolean;
  onToggleCtrl: () => void;
  onSendKey: (key: string) => void;
  onTouchSession: () => void;
};

const KeyButton = ({
  label,
  onClick,
  danger,
  disabled,
  ariaLabel,
}: {
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <Button
    variant={danger ? "danger" : "ghost"}
    size="sm"
    onClick={onClick}
    className="min-w-[70px]"
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {label}
  </Button>
);

export const ControlsPanel = ({
  readOnly,
  connected,
  textInputRef,
  onSendText,
  autoEnter,
  onToggleAutoEnter,
  controlsOpen,
  onToggleControls,
  shiftHeld,
  onToggleShift,
  ctrlHeld,
  onToggleCtrl,
  onSendKey,
  onTouchSession,
}: ControlsPanelProps) => {
  const tabLabel = "Tab";

  const handleTextareaInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  if (readOnly) {
    return (
      <Callout tone="warning" size="sm">
        Read-only mode is active. Interactive controls are hidden.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <textarea
          placeholder="Type a prompt…"
          ref={textInputRef}
          rows={2}
          disabled={!connected}
          onInput={handleTextareaInput}
          className="border-latte-surface2 text-latte-text focus:border-latte-lavender focus:ring-latte-lavender/30 bg-latte-base/70 min-h-[64px] min-w-0 flex-1 resize-none rounded-2xl border px-4 py-2 text-base shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
        />
        <div className="flex shrink-0 items-center self-center">
          <Button onClick={onSendText} aria-label="Send" className="h-11 w-11 p-0">
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
      <Toolbar>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleControls}
          aria-expanded={controlsOpen}
          aria-controls="session-controls"
          className="text-latte-subtext0 flex items-center gap-2 text-[11px] uppercase tracking-[0.32em]"
        >
          {controlsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Keys
        </Button>
        <div className="flex items-center gap-2">
          <IconButton
            type="button"
            size="sm"
            onClick={onTouchSession}
            disabled={!connected}
            aria-label="Pin session to top"
            title="Pin session to top"
          >
            <Pin className="h-4 w-4" />
          </IconButton>
          <PillToggle
            type="button"
            onClick={onToggleAutoEnter}
            active={autoEnter}
            title="Auto-enter after send"
            className="group"
          >
            <span className="text-[9px] font-semibold tracking-[0.3em]">Auto</span>
            <CornerDownLeft className="h-3.5 w-3.5" />
            <span className="sr-only">Auto-enter</span>
          </PillToggle>
        </div>
      </Toolbar>
      {controlsOpen && (
        <div id="session-controls" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ModifierToggle type="button" onClick={onToggleShift} active={shiftHeld}>
              <span
                className={`h-2 w-2 rounded-full transition-colors ${shiftHeld ? "bg-latte-lavender" : "bg-latte-surface2"}`}
              />
              Shift
            </ModifierToggle>
            <ModifierToggle type="button" onClick={onToggleCtrl} active={ctrlHeld}>
              <span
                className={`h-2 w-2 rounded-full transition-colors ${ctrlHeld ? "bg-latte-lavender" : "bg-latte-surface2"}`}
              />
              Ctrl
            </ModifierToggle>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Esc", key: "Escape" },
                { label: tabLabel, key: "Tab" },
                { label: "Backspace", key: "BSpace" },
                { label: "Enter", key: "Enter" },
              ].map((item) => (
                <KeyButton key={item.key} label={item.label} onClick={() => onSendKey(item.key)} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {[
                {
                  label: (
                    <>
                      <ArrowLeft className="h-4 w-4" />
                      <span className="sr-only">Left</span>
                    </>
                  ),
                  key: "Left",
                  ariaLabel: "Left",
                },
                {
                  label: (
                    <>
                      <ArrowUp className="h-4 w-4" />
                      <span className="sr-only">Up</span>
                    </>
                  ),
                  key: "Up",
                  ariaLabel: "Up",
                },
                {
                  label: (
                    <>
                      <ArrowDown className="h-4 w-4" />
                      <span className="sr-only">Down</span>
                    </>
                  ),
                  key: "Down",
                  ariaLabel: "Down",
                },
                {
                  label: (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      <span className="sr-only">Right</span>
                    </>
                  ),
                  key: "Right",
                  ariaLabel: "Right",
                },
              ].map((item) => (
                <KeyButton
                  key={item.key}
                  label={item.label}
                  ariaLabel={item.ariaLabel}
                  onClick={() => onSendKey(item.key)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
