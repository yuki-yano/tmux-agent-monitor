import { ListX } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";

type CloseAllWorkspaceTabsButtonProps = {
  tabCount: number;
  onConfirm: () => void;
};

export const CloseAllWorkspaceTabsButton = ({
  tabCount,
  onConfirm,
}: CloseAllWorkspaceTabsButtonProps) => {
  const [open, setOpen] = useState(false);
  const hasClosableTabs = tabCount > 0;
  const tabDescription = tabCount === 1 ? "1 tab" : `${tabCount} tabs`;

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };

  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        type="button"
        variant="dangerOutline"
        size="sm"
        className="after:-inset-1.5"
        aria-label="Close all tabs"
        aria-haspopup="dialog"
        title="Close all tabs"
        disabled={!hasClosableTabs}
        onClick={() => setOpen(true)}
      >
        <ListX className="h-4 w-4" aria-hidden="true" />
      </IconButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(420px,calc(100vw-1rem))] sm:w-[min(420px,calc(100vw-1.5rem))]">
          <DialogHeader>
            <DialogTitle>Close all tabs?</DialogTitle>
            <DialogDescription>
              This will close {tabDescription}. The Sessions tab will stay open.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="min-h-11"
              onClick={handleConfirm}
            >
              Close all
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
