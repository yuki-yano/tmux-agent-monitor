import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
} from "@/components/ui";

import type { LogFileCandidateItem } from "../hooks/useSessionFiles";

type LogFileCandidateModalState = {
  open: boolean;
  reference: string | null;
  items: LogFileCandidateItem[];
};

type LogFileCandidateModalActions = {
  onClose: () => void;
  onSelect: (path: string) => void;
};

type LogFileCandidateModalProps = {
  state: LogFileCandidateModalState;
  actions: LogFileCandidateModalActions;
};

export const LogFileCandidateModal = ({ state, actions }: LogFileCandidateModalProps) => {
  const { open, reference, items } = state;
  const { onClose, onSelect } = actions;
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const displayedReference = reference ?? "";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="p-0">
        <div className="relative p-3 pb-1.5 sm:p-4 sm:pb-2 md:p-5 md:pb-2">
          <IconButton
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 sm:right-3 sm:top-3"
            variant="lavender"
            size="sm"
            aria-label="Close file candidate modal"
          >
            <X className="h-4 w-4" />
          </IconButton>
          <DialogHeader className="pr-10">
            <DialogTitle>{`Multiple files matched "${displayedReference}"`}</DialogTitle>
            <DialogDescription>Select a file to open it in the modal.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-2.5 pb-2.5 sm:px-3 sm:pb-3 md:px-4 md:pb-4">
          <Command>
            <CommandInput ref={searchInputRef} placeholder="Search files..." />
            <CommandList>
              <CommandEmpty>No file candidates found.</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.name} ${item.path}`}
                    onSelect={() => {
                      onSelect(item.path);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="min-w-0 truncate font-mono text-xs leading-5"
                        title={item.path}
                      >
                        {item.path}
                      </span>
                      {item.isIgnored ? (
                        <span className="border-latte-peach/40 bg-latte-peach/15 text-latte-peach-text shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                          ignored
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
};
