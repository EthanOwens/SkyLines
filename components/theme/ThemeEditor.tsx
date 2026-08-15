"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ThemeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Minimal shell for the Theme Editor (spec.md M7 subtask 12). Opened from
// AccountMenu.tsx's "Edit themes..." item. This is intentionally a bare
// placeholder - subtask 13 replaces the body below with the real layout
// (left sidebar theme list, right sidebar color editor, center live
// preview, Save/Discard footer). For now it only needs to open and close
// correctly.
export function ThemeEditor({ open, onOpenChange }: ThemeEditorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Theme editor</DialogTitle>
          <DialogDescription>
            Theme editing is coming soon.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
