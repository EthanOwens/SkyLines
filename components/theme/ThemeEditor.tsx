"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/appStore";
import type { ThemeVariableKey } from "@/lib/themes/types";

interface ThemeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Structural shell for the Theme Editor (spec.md M7 subtask 13). Establishes
// the four-region layout (left sidebar theme list, right sidebar color
// editor, center live preview, footer Save/Discard) that subtasks 14-19 fill
// in with real behavior - each region below is a clearly-labeled placeholder,
// not functional yet. Opened from AccountMenu.tsx's "Edit themes..." item.
export function ThemeEditor({ open, onOpenChange }: ThemeEditorProps) {
  const availableThemes = useAppStore((s) => s.availableThemes);
  const selectedThemeId = useAppStore((s) => s.selectedThemeId);

  // Which theme is currently loaded for editing. Subtask 14's theme list
  // will let the user change this by clicking a row; for now it's just
  // seeded once per dialog-open below.
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  // Working copy of the loaded theme's variables. Subtask 15's color editor
  // reads/writes this, and subtask 17's Save persists it (discarding it on
  // Discard/close instead). Kept as a plain draft object - not written back
  // into `availableThemes` - so edits don't leak into the live app theme
  // until an explicit Save.
  const [draftVariables, setDraftVariables] = useState<
    Partial<Record<ThemeVariableKey, string>>
  >({});

  // Seed editingThemeId/draftVariables whenever the dialog opens: default to
  // whichever theme is currently active in the app (selectedThemeId), or
  // fall back to the first available theme if nothing's active (e.g.
  // "System" is selected, or availableThemes hasn't loaded any yet). This
  // deliberately re-seeds on every open (rather than persisting edits across
  // opens) since there's no "unsaved draft" concept until subtask 17 adds
  // real save/discard semantics.
  useEffect(() => {
    if (!open) return;

    const fallback = availableThemes[0]?.id ?? null;
    const initialId =
      (selectedThemeId && availableThemes.some((t) => t.id === selectedThemeId)
        ? selectedThemeId
        : fallback) ?? null;

    setEditingThemeId(initialId);
    const initialTheme = availableThemes.find((t) => t.id === initialId);
    setDraftVariables(initialTheme ? { ...initialTheme.variables } : {});
    // Only re-seed when the dialog transitions open, not on every store
    // update while it's already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Placeholder for subtask 17's real save-to-file logic - for now this just
  // closes the dialog without persisting `draftVariables` anywhere.
  function handleSave() {
    onOpenChange(false);
  }

  // Placeholder for subtask 17's real discard/unsaved-changes-prompt logic -
  // for now this just closes the dialog.
  function handleDiscard() {
    onOpenChange(false);
  }

  const editingTheme = availableThemes.find((t) => t.id === editingThemeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-5xl flex-col p-0 gap-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>
            Theme editor
            {editingTheme ? ` — ${editingTheme.name}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Left sidebar - theme list (subtask 14: built-in + user-created
              themes, "create new theme" button). */}
          <div className="flex w-48 shrink-0 flex-col border-r border-border bg-sidebar p-3 text-xs text-muted-foreground">
            Theme list (subtask 14)
          </div>

          {/* Center - live preview (subtask 16: bounded mock canvas with a
              movable/editable text box). */}
          <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/30 p-3 text-xs text-muted-foreground">
            Live preview (subtask 16)
          </div>

          {/* Right sidebar - color editor (subtask 15: color-wheel editor
              for all 31 ThemeVariableKey values). */}
          <div className="flex w-64 shrink-0 flex-col border-l border-border bg-sidebar p-3 text-xs text-muted-foreground">
            Color editor (subtask 15)
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row justify-end gap-2 rounded-b-xl border-t border-border bg-muted/50 px-4 py-3">
          <Button variant="outline" onClick={handleDiscard}>
            Discard
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
