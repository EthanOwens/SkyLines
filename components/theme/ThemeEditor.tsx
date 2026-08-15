"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/appStore";
import { LIGHT_THEME } from "@/lib/themes/builtin";
import type { Theme, ThemeVariableKey } from "@/lib/themes/types";

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

  // Which theme is currently loaded for editing. The theme list below lets
  // the user change this by clicking a row; it's also seeded once per
  // dialog-open below.
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  // Working copy of the loaded theme's variables. Subtask 15's color editor
  // reads/writes this, and subtask 17's Save persists it (discarding it on
  // Discard/close instead). Kept as a plain draft object - not written back
  // into `availableThemes` - so edits don't leak into the live app theme
  // until an explicit Save.
  const [draftVariables, setDraftVariables] = useState<
    Partial<Record<ThemeVariableKey, string>>
  >({});

  // Subtask 14: a "create new theme" button clones a default palette into a
  // brand-new, not-yet-persisted Theme. It's deliberately NOT written into
  // `availableThemes` (stores/appStore.ts) - that store reflects only
  // themes actually persisted to disk via lib/themes/loader.ts, and other
  // consumers (e.g. AccountMenu.tsx's theme picker) read straight from it,
  // so leaking an unsaved draft in there would make it selectable app-wide
  // before it's ever saved. Kept as separate local state instead; the
  // rendered list is availableThemes UNION this optional entry. This also
  // sets up cleanly for subtask 17's "discard the unsaved new theme if the
  // editor closes without saving" behavior - just drop this state.
  const [unsavedNewTheme, setUnsavedNewTheme] = useState<Theme | null>(null);

  // All themes selectable in the left sidebar's list: real (persisted)
  // themes plus the in-progress unsaved one, if any.
  const themeList = unsavedNewTheme
    ? [...availableThemes, unsavedNewTheme]
    : availableThemes;

  // Loads `theme` into the editor for viewing/editing - shared by the
  // dialog-open seeding effect below and by the theme list's row clicks
  // (subtask 14) so there's a single source of truth for "what does
  // selecting a theme do".
  function loadThemeForEditing(theme: Theme | undefined) {
    setEditingThemeId(theme?.id ?? null);
    setDraftVariables(theme ? { ...theme.variables } : {});
  }

  // Seed editingThemeId/draftVariables whenever the dialog opens: default to
  // whichever theme is currently active in the app (selectedThemeId), or
  // fall back to the first available theme if nothing's active (e.g.
  // "System" is selected, or availableThemes hasn't loaded any yet). This
  // deliberately re-seeds on every open (rather than persisting edits across
  // opens) since there's no "unsaved draft" concept until subtask 17 adds
  // real save/discard semantics. Also clears any unsaved new theme from a
  // previous session, for the same reason.
  useEffect(() => {
    if (!open) return;

    setUnsavedNewTheme(null);

    const fallback = availableThemes[0]?.id ?? null;
    const initialId =
      (selectedThemeId && availableThemes.some((t) => t.id === selectedThemeId)
        ? selectedThemeId
        : fallback) ?? null;

    loadThemeForEditing(availableThemes.find((t) => t.id === initialId));
    // Only re-seed when the dialog transitions open, not on every store
    // update while it's already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Creates a new, unsaved theme (cloning LIGHT_THEME's palette as a
  // sensible default starting point) and immediately selects it for
  // editing. Clicking "create new theme" again while one already exists
  // replaces it - this app doesn't support multiple concurrent unsaved
  // drafts (not asked for by spec.md's Non-Goals here).
  function handleCreateNewTheme() {
    const newTheme: Theme = {
      id: crypto.randomUUID(),
      name: "New Theme",
      variables: { ...LIGHT_THEME.variables },
    };
    setUnsavedNewTheme(newTheme);
    loadThemeForEditing(newTheme);
  }

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

  const editingTheme = themeList.find((t) => t.id === editingThemeId);

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
          {/* Left sidebar - theme list: built-in + user-created themes, plus
              a "create new theme" button (spec.md M7 subtask 14). */}
          <div className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar p-2">
            <div className="flex flex-1 flex-col gap-0.5">
              {themeList.map((theme) => {
                const isActive = theme.id === editingThemeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => loadThemeForEditing(theme)}
                    className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent"
                    }`}
                  >
                    {theme.name}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleCreateNewTheme}
              className="mt-2 flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New theme
            </button>
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
