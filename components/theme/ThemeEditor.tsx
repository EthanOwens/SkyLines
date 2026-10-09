"use client";

import { useEffect, useRef, useState } from "react";
import { Clipboard, Copy, FolderOpen, Plus, Trash2 } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { useAppStore } from "@/stores/appStore";
import { BUILTIN_THEMES, LIGHT_THEME } from "@/lib/themes/builtin";
import { applyTheme } from "@/lib/themes/apply";
import { deleteThemeFile, ensureThemesDir, loadThemes, saveTheme } from "@/lib/themes/loader";
import { THEME_VARIABLE_KEYS, type Theme, type ThemeVariableKey } from "@/lib/themes/types";
import { ThemeColorField } from "./ThemeColorField";
import { ThemePreview } from "./ThemePreview";

// Duplicated from AccountMenu rather than imported: AccountMenu imports this
// file, so importing back would be circular.
const SYSTEM_THEME_VALUE = "__system__";

// A close or theme switch waiting on the unsaved-changes prompt. "close" covers
// every way to dismiss the dialog; "switch" is picking another theme while the
// draft is dirty.
type PendingAction =
  | { type: "close" }
  | { type: "switch"; theme: Theme }
  | { type: "paste"; theme: Theme };

// Everything an edit, delete or paste can change, captured right before it
// runs; undo restores it as-is. restoreFile is set only by delete, whose file
// really is gone from disk.
interface UndoSnapshot {
  editingThemeId: string | null;
  draftVariables: Partial<Record<ThemeVariableKey, string>>;
  unsavedNewTheme: Theme | null;
  availableThemes: Theme[];
  restoreFile?: Theme;
}

const MAX_UNDO_HISTORY = 50;

// Built-in themes use 0.625rem; above about 2rem corners are fully rounded
// anyway.
const RADIUS_MIN_REM = 0;
const RADIUS_MAX_REM = 2;
const RADIUS_STEP_REM = 0.025;

const RADIUS_DEFAULT = { num: 0.625, unit: "rem" };

// Falls back to RADIUS_DEFAULT for blank, non-rem or out-of-range values, so a
// hand-edited theme file can't put the slider in a bad state.
function parseRadiusValue(value: string | undefined): { num: number; unit: string } {
  const match = value?.match(/^(-?[\d.]+)(\D*)$/);
  if (!match) return RADIUS_DEFAULT;
  const num = parseFloat(match[1]);
  const unit = match[2] || "rem";
  if (unit !== "rem" || !Number.isFinite(num)) return RADIUS_DEFAULT;
  return { num: Math.min(RADIUS_MAX_REM, Math.max(RADIUS_MIN_REM, num)), unit };
}

// Display text only: the keys are CSS variable names saved in theme files, so
// they never change.
const THEME_VARIABLE_INFO = {
  background: {
    name: "Background",
    description: "Main background behind notes and the canvas",
  },
  foreground: { name: "Text", description: "Default text color" },
  card: {
    name: "Card background",
    description: "Background of cards, such as sticky note previews",
  },
  "card-foreground": { name: "Card text", description: "Text on cards" },
  primary: {
    name: "Accent color",
    description: "Buttons, selected items and other highlights",
  },
  border: { name: "Border", description: "Borders and dividing lines" },
  radius: { name: "Corner rounding", description: "How rounded corners are" },
  sidebar: { name: "Sidebar background", description: "Background of the sidebars" },
  "sidebar-foreground": { name: "Sidebar text", description: "Text in the sidebars" },
  "sidebar-primary": {
    name: "Sidebar highlight",
    description: "Shown in the preview; not used by the app yet",
  },
  "sidebar-accent": {
    name: "Sidebar hover",
    description: "Hovered and selected items in the sidebars",
  },
  "sidebar-border": {
    name: "Sidebar border",
    description: "Edges and dividers in the sidebars",
  },
} satisfies Partial<Record<ThemeVariableKey, { name: string; description: string }>>;

type EditableThemeVariableKey = keyof typeof THEME_VARIABLE_INFO;

// Only keys the mini preview renders, in render order.
const THEME_VARIABLE_GROUPS: { label: string; keys: EditableThemeVariableKey[] }[] = [
  { label: "Page", keys: ["background", "foreground"] },
  { label: "Cards & text boxes", keys: ["card", "card-foreground"] },
  { label: "Accent", keys: ["primary"] },
  { label: "Borders", keys: ["border"] },
  { label: "Corners", keys: ["radius"] },
  {
    label: "Sidebar",
    keys: [
      "sidebar",
      "sidebar-foreground",
      "sidebar-primary",
      "sidebar-accent",
      "sidebar-border",
    ],
  },
];

interface ThemeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Theme list on the left, color editor on the right, live preview in the
// middle, and Save/Discard in the footer. Opened from the account menu.
export function ThemeEditor({ open, onOpenChange }: ThemeEditorProps) {
  const availableThemes = useAppStore((s) => s.availableThemes);
  const selectedThemeId = useAppStore((s) => s.selectedThemeId);
  const setAvailableThemes = useAppStore((s) => s.setAvailableThemes);
  const setUserThemesLoaded = useAppStore((s) => s.setUserThemesLoaded);

  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  // Edits stay in this draft, not availableThemes, so they don't reach the app
  // until Save.
  const [draftVariables, setDraftVariables] = useState<
    Partial<Record<ThemeVariableKey, string>>
  >({});

  // Kept out of availableThemes because other components read that store
  // directly, which would make an unsaved theme selectable app-wide.
  const [unsavedNewTheme, setUnsavedNewTheme] = useState<Theme | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // In-memory copy for "Copy/Paste theme values" (not the OS clipboard).
  const [copiedVariables, setCopiedVariables] = useState<Partial<
    Record<ThemeVariableKey, string>
  > | null>(null);

  // Undo stack for this dialog session; a ref so pushing doesn't re-render.
  // Cleared on close and unrelated to tldraw's and Tiptap's own undo.
  const undoHistoryRef = useRef<UndoSnapshot[]>([]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(THEME_VARIABLE_GROUPS.map((g) => [g.label, true])),
  );

  // Coalesces a run of edits to the same key (one color-wheel drag, or typing a
  // hex) into one undo step; otherwise each event would push a snapshot and
  // evict older actions from the capped history. Reset when another theme
  // loads, a delete or paste pushes its own snapshot, or an undo runs.
  const lastEditedKeyRef = useRef<ThemeVariableKey | null>(null);

  const themeList = unsavedNewTheme
    ? [...availableThemes, unsavedNewTheme]
    : availableThemes;

  // Shared by the open-time seeding and row clicks.
  function loadThemeForEditing(theme: Theme | undefined) {
    setEditingThemeId(theme?.id ?? null);
    setDraftVariables(theme ? { ...theme.variables } : {});
    // A different theme's now being edited - don't let a same-key edit on
    // it coalesce with a same-key edit on whatever was loaded before.
    lastEditedKeyRef.current = null;
  }

  // On open, load the active theme, or the first theme if none is active (for
  // example "System"). Re-seeds on every open and clears any unsaved new theme.
  useEffect(() => {
    if (!open) return;

    setUnsavedNewTheme(null);
    setPendingAction(null);
    setCopiedVariables(null);
    undoHistoryRef.current = [];

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

  // Ctrl+Z / Cmd+Z, only while the dialog is open. handleUndo only touches a
  // ref and stable setters, so it doesn't need to be a dependency. Skips inputs
  // so they keep their own native undo.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      const isUndoShortcut =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z";
      if (!isUndoShortcut) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;

      e.preventDefault();
      void handleUndo();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Starts from LIGHT_THEME's palette. Only one unsaved new theme at a time.
  function handleCreateNewTheme() {
    const newTheme: Theme = {
      id: crypto.randomUUID(),
      name: "New Theme",
      variables: { ...LIGHT_THEME.variables },
    };
    setUnsavedNewTheme(newTheme);
    loadThemeForEditing(newTheme);
  }

  // ensureThemesDir rather than getThemesDir, so this works on a fresh install
  // where the folder doesn't exist yet.
  async function handleOpenThemesFolder() {
    try {
      const dir = await ensureThemesDir();
      await openPath(dir);
    } catch (err) {
      console.error("Theme editor: failed to open themes folder", err);
    }
  }

  // Only touches the draft; nothing is applied until Save.
  function handleVariableChange(key: ThemeVariableKey, value: string) {
    // A new snapshot only when this edit starts a new run; see
    // lastEditedKeyRef.
    if (lastEditedKeyRef.current !== key) {
      pushUndoSnapshot();
      lastEditedKeyRef.current = key;
    }
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  }

  // Call right before any undoable change.
  function pushUndoSnapshot(restoreFile?: Theme) {
    // A delete/paste is pushing its own snapshot right now - any run of
    // same-key edit-coalescing tracked above no longer applies to whatever
    // edit happens next, even if it's to the same key as before this call.
    lastEditedKeyRef.current = null;
    undoHistoryRef.current.push({
      editingThemeId,
      draftVariables: { ...draftVariables },
      unsavedNewTheme,
      availableThemes: [...availableThemes],
      restoreFile,
    });
    if (undoHistoryRef.current.length > MAX_UNDO_HISTORY) {
      undoHistoryRef.current.shift();
    }
  }

  // Restores the last snapshot. After a delete it first writes the theme file
  // back to disk; otherwise the theme would reappear in the UI and then vanish
  // on the next reload.
  async function handleUndo() {
    const snapshot = undoHistoryRef.current.pop();
    if (!snapshot) return;
    // An undo just happened - the same-key edit-coalescing tracked above no
    // longer applies to whatever edit happens next.
    lastEditedKeyRef.current = null;

    if (snapshot.restoreFile) {
      try {
        await saveTheme(snapshot.restoreFile);
      } catch (err) {
        // Put the snapshot back so Ctrl+Z can be retried, and leave the UI
        // alone: the file isn't restored yet. There's no error UI to report
        // this to.
        console.error("Theme editor: failed to restore deleted theme file on undo", err);
        undoHistoryRef.current.push(snapshot);
        return;
      }
    }

    setEditingThemeId(snapshot.editingThemeId);
    setDraftVariables(snapshot.draftVariables);
    setUnsavedNewTheme(snapshot.unsavedNewTheme);
    setAvailableThemes(snapshot.availableThemes);
  }

  const editingTheme = themeList.find((t) => t.id === editingThemeId);

  // A never-saved new theme always counts as dirty.
  function isDraftDirty(): boolean {
    if (!editingTheme) return false;
    if (unsavedNewTheme && unsavedNewTheme.id === editingTheme.id) return true;
    return THEME_VARIABLE_KEYS.some(
      (key) => (draftVariables[key] ?? undefined) !== (editingTheme.variables[key] ?? undefined),
    );
  }

  // Saves the draft, refreshes availableThemes from disk, and applies it live
  // if it's the active theme.
  //
  // Built-in themes are never overwritten: a user file with a built-in's id is
  // ignored on load, so the edit would be lost. Editing a built-in instead
  // saves it as a new custom theme.
  async function persistDraft(): Promise<Theme | null> {
    if (!editingTheme) return null;

    const isBuiltin = BUILTIN_THEMES.some((b) => b.id === editingTheme.id);

    const themeToSave: Theme = isBuiltin
      ? {
          id: crypto.randomUUID(),
          name: `${editingTheme.name} (Copy)`,
          variables: { ...draftVariables },
        }
      : {
          id: editingTheme.id,
          name: editingTheme.name,
          variables: { ...draftVariables },
        };

    await saveTheme(themeToSave);

    const { themes: userThemes } = await loadThemes();
    const usableUserThemes = userThemes.filter(
      (t) => t.id !== SYSTEM_THEME_VALUE && !BUILTIN_THEMES.some((b) => b.id === t.id),
    );
    setAvailableThemes([...BUILTIN_THEMES, ...usableUserThemes]);
    setUserThemesLoaded(true);

    // Compares against editingTheme.id (not themeToSave.id, which differs for a
    // fork); an unsaved new theme never has a built-in's id.
    if (unsavedNewTheme && unsavedNewTheme.id === editingTheme.id) {
      setUnsavedNewTheme(null);
    }

    if (isBuiltin) {
      // Follow the fork in the editor, but don't apply it live: the user hasn't
      // chosen it in the theme picker.
      setEditingThemeId(themeToSave.id);
      setDraftVariables({ ...themeToSave.variables });
    } else if (selectedThemeId === themeToSave.id) {
      applyTheme(themeToSave);
    }

    return themeToSave;
  }

  // Reverts the edits; an unsaved new theme is only dropped when the dialog
  // closes.
  function revertDraft() {
    loadThemeForEditing(editingTheme);
  }

  function discardUnsavedNewThemeIfAny() {
    setUnsavedNewTheme(null);
  }

  async function handleSave() {
    await persistDraft();
    onOpenChange(false);
  }

  // Same as answering Discard on the prompt when closing.
  function handleDiscard() {
    revertDraft();
    discardUnsavedNewThemeIfAny();
    onOpenChange(false);
  }

  function resolvePendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.type === "close") {
      onOpenChange(false);
    } else if (action.type === "switch") {
      loadThemeForEditing(action.theme);
    } else {
      applyPasteToTheme(action.theme);
    }
  }

  // Not undoable, since it changes no theme data.
  function handleCopyTheme(theme: Theme) {
    setCopiedVariables({ ...theme.variables });
  }

  // Loads the theme with the pasted values as its draft, so the usual dirty
  // check, Save and Discard all apply.
  function applyPasteToTheme(theme: Theme) {
    if (!copiedVariables) return;
    pushUndoSnapshot();
    setEditingThemeId(theme.id);
    setDraftVariables({ ...copiedVariables });
  }

  // Goes through requestLoadTheme so pasting can't silently discard a dirty
  // draft of another theme.
  function requestPasteTheme(theme: Theme) {
    if (!copiedVariables) return;
    if (isDraftDirty()) {
      setPendingAction({ type: "paste", theme });
      return;
    }
    applyPasteToTheme(theme);
  }

  // Built-in themes have no file and never show this action; checked here too.
  // If the deleted theme was loaded, load the first remaining theme.
  async function handleDeleteTheme(theme: Theme) {
    if (BUILTIN_THEMES.some((b) => b.id === theme.id)) return;

    pushUndoSnapshot(theme);

    await deleteThemeFile(theme.id);

    const { themes: userThemes } = await loadThemes();
    const usableUserThemes = userThemes.filter(
      (t) => t.id !== SYSTEM_THEME_VALUE && !BUILTIN_THEMES.some((b) => b.id === t.id),
    );
    const refreshedThemes = [...BUILTIN_THEMES, ...usableUserThemes];
    setAvailableThemes(refreshedThemes);
    setUserThemesLoaded(true);

    if (editingThemeId === theme.id) {
      loadThemeForEditing(refreshedThemes.find((t) => t.id !== theme.id));
    }
  }

  async function handleConfirmSave() {
    await persistDraft();
    resolvePendingAction();
  }

  function handleConfirmDiscard() {
    discardUnsavedNewThemeIfAny();
    resolvePendingAction();
  }

  function handleConfirmCancel() {
    setPendingAction(null);
  }

  // Dialog close (X, Escape, outside click) while dirty goes through the
  // prompt.
  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isDraftDirty()) {
      setPendingAction({ type: "close" });
      return;
    }
    discardUnsavedNewThemeIfAny();
    onOpenChange(false);
  }

  // Switching themes while dirty goes through the same prompt.
  function requestLoadTheme(theme: Theme) {
    if (theme.id === editingThemeId) return;
    if (isDraftDirty()) {
      setPendingAction({ type: "switch", theme });
      return;
    }
    loadThemeForEditing(theme);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex h-[85vh] w-full max-w-5xl flex-col p-0 gap-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>
              Theme editor
              {editingTheme ? ` — ${editingTheme.name}` : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            <div className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar p-2">
              <div className="flex flex-1 flex-col gap-0.5">
                {themeList.map((theme) => {
                  const isActive = theme.id === editingThemeId;
                  const isBuiltin = BUILTIN_THEMES.some((b) => b.id === theme.id);
                  const isUnsaved = unsavedNewTheme?.id === theme.id;
                  return (
                    <ContextMenu key={theme.id}>
                      <ContextMenuTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => requestLoadTheme(theme)}
                            className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                              isActive
                                ? "bg-sidebar-accent text-sidebar-foreground"
                                : "text-sidebar-foreground hover:bg-sidebar-accent"
                            }`}
                          >
                            {theme.name}
                          </button>
                        }
                      />
                      <DropdownMenuContent align="start" className="w-44">
                        <DropdownMenuItem onClick={() => handleCopyTheme(theme)}>
                          <Copy className="mr-2 h-4 w-4" /> Copy theme values
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!copiedVariables}
                          onClick={() => requestPasteTheme(theme)}
                        >
                          <Clipboard className="mr-2 h-4 w-4" /> Paste theme values
                        </DropdownMenuItem>
                        {!isBuiltin && !isUnsaved && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void handleDeleteTheme(theme)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </ContextMenu>
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

              <button
                type="button"
                onClick={() => void handleOpenThemesFolder()}
                className="mt-1 flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open themes folder
              </button>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/30 p-3">
              {editingTheme ? (
                <ThemePreview editingTheme={editingTheme} draftVariables={draftVariables} />
              ) : (
                <div className="text-xs text-muted-foreground">No theme selected</div>
              )}
            </div>

            <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border bg-sidebar p-3">
              {editingTheme ? (
                <div className="flex flex-col gap-3">
                  {THEME_VARIABLE_GROUPS.map((group) => (
                    <Collapsible
                      key={group.label}
                      open={expandedGroups[group.label] ?? true}
                      onOpenChange={(next) =>
                        setExpandedGroups((prev) => ({ ...prev, [group.label]: next }))
                      }
                      className="flex flex-col"
                    >
                      <CollapsibleTrigger className="px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <div className="flex flex-col divide-y divide-border">
                          {group.keys.map((key) => {
                            const value = draftVariables[key] ?? editingTheme.variables[key];
                            const { name, description } = THEME_VARIABLE_INFO[key];

                            if (key === "radius") {
                              const { num, unit } = parseRadiusValue(value);
                              return (
                                <div key={key} className="flex flex-col gap-1 py-1.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-1 flex-col">
                                      <label
                                        htmlFor="theme-editor-radius"
                                        className="truncate text-xs text-sidebar-foreground"
                                      >
                                        {name}
                                      </label>
                                      <span
                                        id="theme-editor-radius-description"
                                        className="text-[11px] leading-snug text-muted-foreground"
                                      >
                                        {description}
                                      </span>
                                    </div>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                      {num}
                                      {unit}
                                    </span>
                                  </div>
                                  <input
                                    id="theme-editor-radius"
                                    aria-describedby="theme-editor-radius-description"
                                    type="range"
                                    min={RADIUS_MIN_REM}
                                    max={RADIUS_MAX_REM}
                                    step={RADIUS_STEP_REM}
                                    value={num}
                                    onChange={(e) =>
                                      handleVariableChange(
                                        key,
                                        `${Number(e.target.value).toFixed(3)}${unit}`,
                                      )
                                    }
                                    className="h-1.5 w-full cursor-pointer accent-primary"
                                  />
                                </div>
                              );
                            }

                            return (
                              <ThemeColorField
                                key={key}
                                varKey={key}
                                label={name}
                                description={description}
                                value={value}
                                onChange={handleVariableChange}
                              />
                            );
                          })}
                        </div>
                      </CollapsiblePanel>
                    </Collapsible>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No theme selected</div>
              )}
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

      {/* Shown instead of closing or switching while the draft is dirty. */}
      <AlertDialog open={pendingAction !== null} onOpenChange={(next) => { if (!next) handleConfirmCancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              {editingTheme
                ? `"${editingTheme.name}" has unsaved changes. Save them before ${
                    pendingAction?.type === "switch"
                      ? "switching themes"
                      : pendingAction?.type === "paste"
                        ? "pasting theme values"
                        : "closing"
                  }?`
                : "This theme has unsaved changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleConfirmCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={handleConfirmDiscard}>
              Discard
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void handleConfirmSave()}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
