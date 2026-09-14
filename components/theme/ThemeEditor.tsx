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
import { useAppStore } from "@/stores/appStore";
import { BUILTIN_THEMES, LIGHT_THEME } from "@/lib/themes/builtin";
import { applyTheme } from "@/lib/themes/apply";
import { deleteThemeFile, ensureThemesDir, loadThemes, saveTheme } from "@/lib/themes/loader";
import { THEME_VARIABLE_KEYS, type Theme, type ThemeVariableKey } from "@/lib/themes/types";
import { ThemeColorField } from "./ThemeColorField";
import { ThemePreview } from "./ThemePreview";

// Mirrors AccountMenu.tsx's own `SYSTEM_THEME_VALUE` export (same sentinel
// value, used the same way AppShell.tsx's refresh logic excludes it from
// user-theme lists). Duplicated here as a literal, rather than imported,
// because AccountMenu.tsx imports THIS component - importing back from it
// would create a circular module dependency.
const SYSTEM_THEME_VALUE = "__system__";

// A pending close/switch action that's blocked on the unsaved-changes
// confirmation prompt below (spec.md M7 subtask 17) - captures just enough
// to resume once the user picks Save/Discard/Cancel. "close" covers every
// way the dialog itself can be dismissed (X button, Escape, outside click,
// and the footer's own Discard button); "switch" covers clicking a
// different theme in the left sidebar's list while the current draft is
// dirty.
type PendingAction =
  | { type: "close" }
  | { type: "switch"; theme: Theme }
  | { type: "paste"; theme: Theme };

// A single undo step for subtask 18's in-session Ctrl+Z history: a snapshot
// of every piece of state a value edit, a delete, or a theme-values paste
// can touch, captured right BEFORE that action runs. Undo just restores all
// of it verbatim - simpler and more robust than inverse-operations given how
// small this data is (a handful of themes, ~31 string values each).
// `restoreFile`, set only by the delete action, additionally re-persists the
// deleted theme's file to disk on undo (its file is really gone after
// delete, unlike everything else here which is purely in-memory).
interface UndoSnapshot {
  editingThemeId: string | null;
  draftVariables: Partial<Record<ThemeVariableKey, string>>;
  unsavedNewTheme: Theme | null;
  availableThemes: Theme[];
  restoreFile?: Theme;
}

const MAX_UNDO_HISTORY = 50;

// Human-readable label for a ThemeVariableKey, e.g. "sidebar-primary-foreground"
// -> "Sidebar Primary Foreground". Used by the right sidebar's field list
// (subtask 15) so the raw kebab-case CSS variable names aren't shown as-is.
function labelForKey(key: ThemeVariableKey): string {
  return key
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Groups the right sidebar's 27 ThemeVariableKey rows into labeled sections
// (spec.md subtask 3) matching how the keys are actually used, instead of one
// flat list. Purely a presentation grouping - every key still renders via the
// exact same ThemeColorField/radius-input logic below, just organized under
// these headings. Order here is the render order.
const THEME_VARIABLE_GROUPS: { label: string; keys: ThemeVariableKey[] }[] = [
  { label: "Base & Text", keys: ["background", "foreground", "muted", "muted-foreground"] },
  { label: "Card", keys: ["card", "card-foreground"] },
  { label: "Popover", keys: ["popover", "popover-foreground"] },
  {
    label: "Primary / Secondary / Accent",
    keys: [
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "accent",
      "accent-foreground",
    ],
  },
  { label: "Destructive", keys: ["destructive"] },
  { label: "Border / Input / Focus Ring", keys: ["border", "input", "ring"] },
  { label: "Radius", keys: ["radius"] },
  {
    label: "Sidebar",
    keys: [
      "sidebar",
      "sidebar-foreground",
      "sidebar-primary",
      "sidebar-primary-foreground",
      "sidebar-accent",
      "sidebar-accent-foreground",
      "sidebar-border",
      "sidebar-ring",
    ],
  },
];

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
  const setAvailableThemes = useAppStore((s) => s.setAvailableThemes);
  const setUserThemesLoaded = useAppStore((s) => s.setUserThemesLoaded);

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

  // A close/theme-switch attempt that's been blocked pending the user's
  // answer to the unsaved-changes confirmation prompt below. `null` when no
  // prompt is showing.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Subtask 18's left-sidebar "copy theme values" clipboard: an in-memory,
  // this-ThemeEditor-instance-only copy of one theme's full `variables`
  // object (NOT the OS clipboard, not persisted). "Paste theme values"
  // below reads this; the paste item is disabled while it's null.
  const [copiedVariables, setCopiedVariables] = useState<Partial<
    Record<ThemeVariableKey, string>
  > | null>(null);

  // Subtask 18's in-session Ctrl+Z history: a plain stack of UndoSnapshots,
  // pushed to right before each undoable action (a value edit, a delete, or
  // a theme-values paste) runs. A ref (not state) since pushing/popping it
  // shouldn't itself trigger a re-render - only the state it restores does.
  // Built fresh each time the dialog opens and discarded on close, per
  // spec.md's "hand-rolled, in-session-only history stack" decision -
  // deliberately not persisted, and entirely unrelated to tldraw's/Tiptap's
  // own undo/redo.
  const undoHistoryRef = useRef<UndoSnapshot[]>([]);

  // Coalescing for `handleVariableChange` below: react-colorful's wheel
  // fires `onChange` continuously on every pointer-move during a single
  // drag, and its hex input fires on every keystroke - without coalescing,
  // each of those raw events would push its own UndoSnapshot, flooding
  // `undoHistoryRef` and (via MAX_UNDO_HISTORY's `shift()` eviction)
  // silently bumping older, unrelated undoable actions (a delete, a paste)
  // out of history. Tracks the key of the most recent edit; consecutive
  // edits to the SAME key reuse the snapshot already sitting on top of the
  // stack (it already captured the pre-edit state) instead of pushing a new
  // one. Reset to null - so the next edit of ANY key pushes fresh - by
  // `loadThemeForEditing` (a different theme is now being edited),
  // `pushUndoSnapshot` itself (a delete/paste just pushed its own snapshot),
  // and `handleUndo` (an undo just happened).
  const lastEditedKeyRef = useRef<ThemeVariableKey | null>(null);

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
    // A different theme's now being edited - don't let a same-key edit on
    // it coalesce with a same-key edit on whatever was loaded before.
    lastEditedKeyRef.current = null;
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

  // Subtask 18: Ctrl+Z (Cmd+Z on Mac) undo, scoped to only fire while the
  // Theme Editor dialog is open - listener is added/removed alongside
  // `open` itself, so nothing fires once it's closed. `handleUndo` only
  // reads `undoHistoryRef` (a ref) and calls the state setters (which are
  // referentially stable), so this doesn't need `handleUndo` in its
  // dependency array - it's never stale.
  //
  // Deliberately ignores keydowns whose target is an `<input>`/`<textarea>`
  // (e.g. the hex color input, the radius text field) so this doesn't
  // hijack those elements' own native undo - the safest way to tell "this
  // keydown was meant for a text field's own undo, not this dialog's"
  // without trying to guess at cursor/selection state.
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

  // Left sidebar's bottom "Open themes folder" button (subtask 19): opens
  // the on-disk themes directory (lib/themes/loader.ts's
  // `<app-config-dir>/themes`) in the OS's file explorer, via
  // @tauri-apps/plugin-opener's `openPath`. `ensureThemesDir()` (rather than
  // `getThemesDir()`) is used here so this doesn't fail on a fresh install
  // where no user theme has ever been saved and the directory doesn't exist
  // yet - it creates the directory first, same as `loadThemes()`/
  // `saveTheme()` already do.
  async function handleOpenThemesFolder() {
    try {
      const dir = await ensureThemesDir();
      await openPath(dir);
    } catch (err) {
      console.error("Theme editor: failed to open themes folder", err);
    }
  }

  // Updates a single variable in the working draft (subtask 15's color
  // editor and radius field both call this). Deliberately only ever touches
  // `draftVariables` - never lib/themes/apply.ts - so edits stay local to
  // this dialog's draft until subtask 17's Save applies them for real.
  function handleVariableChange(key: ThemeVariableKey, value: string) {
    // Only push a fresh snapshot when this edit starts a new run (a
    // different key than the immediately-prior edit, or no prior edit since
    // the last delete/paste/undo) - see `lastEditedKeyRef`'s comment above.
    // A run of same-key edits (one color-wheel drag's stream of onChange
    // events, or one hex-input's keystrokes) reuses the snapshot already on
    // top of the stack instead of pushing a new one per event.
    if (lastEditedKeyRef.current !== key) {
      pushUndoSnapshot();
      lastEditedKeyRef.current = key;
    }
    setDraftVariables((prev) => ({ ...prev, [key]: value }));
  }

  // Captures the current, pre-action state as an UndoSnapshot and pushes it
  // onto this session's history stack - call this right before making any
  // undoable change (a value edit, a delete, or a paste). `restoreFile` is
  // only ever passed by the delete action (see `handleDeleteTheme` below).
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

  // Ctrl+Z (Cmd+Z on Mac): pops the last snapshot and restores every field
  // it captured verbatim. If that snapshot was captured right before a
  // delete, also writes the deleted theme's file back to disk FIRST - unlike
  // everything else here (purely in-memory), the deleted theme's file is
  // really gone, so `setAvailableThemes` below would otherwise make it
  // reappear in the UI while its on-disk file is still missing (it'd then
  // silently vanish again the next time `loadThemes()` runs, e.g. next Save
  // or dialog reopen). Async so this write can be awaited - see the keydown
  // handler above, which now calls this with `void`.
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
        // The restore write failed - put the snapshot back so the user can
        // retry Ctrl+Z, and don't touch any state below: the theme's data
        // isn't lost (it's still sitting in this snapshot), only its
        // on-disk restore is, so the UI must NOT claim it's back until that
        // actually succeeds. This app has no toast/alert convention yet for
        // surfacing a save failure to the user (checked ThemeEditor.tsx and
        // its callers), so this is logged only; wiring up a visible error
        // indication here is a reasonable follow-up if one gets added.
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

  // Whether `draftVariables` currently differs from `editingTheme`'s
  // last-saved/loaded values - a never-saved `unsavedNewTheme` counts as
  // dirty too (it has zero on-disk representation yet, regardless of
  // whether its cloned starting palette has been touched). Backs the
  // close/switch confirmation prompt below.
  function isDraftDirty(): boolean {
    if (!editingTheme) return false;
    if (unsavedNewTheme && unsavedNewTheme.id === editingTheme.id) return true;
    return THEME_VARIABLE_KEYS.some(
      (key) => (draftVariables[key] ?? undefined) !== (editingTheme.variables[key] ?? undefined),
    );
  }

  // Persists `draftVariables` (merged onto the loaded theme's id/name) to
  // disk via lib/themes/loader.ts's `saveTheme`, then refreshes
  // stores/appStore.ts's `availableThemes` from disk so the saved theme -
  // new or updated - is reflected everywhere else that reads it (e.g.
  // AccountMenu.tsx's theme picker), mirroring how AppShell.tsx populates
  // that same field on boot. If the saved theme is the app's
  // currently-active theme, also applies it live so the open app UI updates
  // immediately to match the just-saved edit, instead of waiting for the
  // next reload.
  //
  // Built-in themes (BUILTIN_THEMES) are never written to directly: they're
  // hard-coded, so any `<id>.json` saved over a built-in id would just be
  // discarded again by the `usableUserThemes` filter right below (it exists
  // to drop a *user* theme file that happens to collide with a built-in id -
  // AppShell.tsx's boot-time restore does the same thing, and explicitly
  // ignores user files for built-in ids too), and permanently orphaned on
  // disk after that. So editing a built-in instead forks it into a brand-new
  // theme (fresh id, same id-generation approach as handleCreateNewTheme)
  // that *is* a real, persisted, reloadable entry - the edit is never lost,
  // it just lands as a new custom theme based on the built-in rather than
  // overwriting it.
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

    // It's no longer an unsaved draft - it's now a real, persisted entry
    // that'll show up via the refreshed `availableThemes` above. Note this
    // compares against `editingTheme.id` (the theme that was loaded into the
    // editor), not `themeToSave.id` - those differ for the built-in-fork case
    // above, but `unsavedNewTheme` (created only by handleCreateNewTheme)
    // never has a built-in's id anyway, so this only ever matches in the
    // non-fork case.
    if (unsavedNewTheme && unsavedNewTheme.id === editingTheme.id) {
      setUnsavedNewTheme(null);
    }

    if (isBuiltin) {
      // Follow the fork: the editor now shows/edits the new custom theme
      // instead of continuing to point at the built-in (which stays exactly
      // as it was - its in-editor entry, if re-selected, will show its
      // original, unmodified defaults again). Deliberately does NOT
      // live-apply here even if the built-in being forked is the currently
      // active theme - the fork is a distinct, not-yet-selected theme, and
      // applying it live would change the app's active appearance without
      // the user ever having picked it in AccountMenu.tsx's theme picker.
      setEditingThemeId(themeToSave.id);
      setDraftVariables({ ...themeToSave.variables });
    } else if (selectedThemeId === themeToSave.id) {
      applyTheme(themeToSave);
    }

    return themeToSave;
  }

  // Reverts `draftVariables` back to `editingTheme`'s last-saved/loaded
  // values by re-running the same seeding logic `loadThemeForEditing`
  // already uses for this theme (for a never-saved `unsavedNewTheme`, that
  // just re-clones its original starting palette - the new theme itself
  // isn't deleted here, only its in-editor edits are reverted; it's only
  // ever dropped entirely when the dialog actually closes without saving,
  // see `finishClose` below).
  function revertDraft() {
    loadThemeForEditing(editingTheme);
  }

  // Drops `unsavedNewTheme` if it was never saved - called whenever the
  // dialog is about to close without that theme having been persisted, so
  // it doesn't linger in local state (it was never written to disk, so
  // there's nothing to clean up there).
  function discardUnsavedNewThemeIfAny() {
    setUnsavedNewTheme(null);
  }

  // Footer "Save": persists the current draft and closes the dialog.
  async function handleSave() {
    await persistDraft();
    onOpenChange(false);
  }

  // Footer "Discard": reverts the current draft's edits, drops an unsaved
  // new theme entirely (nothing was ever written to disk for it), and
  // closes the dialog - same "discard and leave" semantics as answering
  // Discard on the confirmation prompt below when closing.
  function handleDiscard() {
    revertDraft();
    discardUnsavedNewThemeIfAny();
    onOpenChange(false);
  }

  // Resolves whichever close/switch/paste action the confirmation prompt is
  // blocking on.
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

  // Subtask 18's left-sidebar context menu: "Copy theme values" - copies
  // `theme`'s full `variables` object (the theme the menu was opened on,
  // not necessarily the currently-loaded draft) into this session's
  // in-memory clipboard. Not undoable itself (it doesn't touch any theme's
  // data), so it deliberately doesn't push an undo snapshot.
  function handleCopyTheme(theme: Theme) {
    setCopiedVariables({ ...theme.variables });
  }

  // Applies the copied clipboard onto `theme`: loads `theme` into the
  // editor with the copied variables as its new draft, so it's immediately
  // marked dirty by the existing `isDraftDirty` comparison against
  // `theme.variables` - Save/Discard/the confirmation prompt all then work
  // unchanged, with no extra plumbing.
  function applyPasteToTheme(theme: Theme) {
    if (!copiedVariables) return;
    pushUndoSnapshot();
    setEditingThemeId(theme.id);
    setDraftVariables({ ...copiedVariables });
  }

  // Subtask 18's left-sidebar context menu: "Paste theme values" - pastes
  // the last-copied variables onto `theme` (the row the menu was opened
  // on). Routed through the same dirty-check the theme list's row clicks
  // use (`requestLoadTheme`) so an unsaved edit on a DIFFERENT theme isn't
  // silently discarded by a paste - if the current draft is dirty, the
  // existing Save/Discard/Cancel prompt below blocks first.
  function requestPasteTheme(theme: Theme) {
    if (!copiedVariables) return;
    if (isDraftDirty()) {
      setPendingAction({ type: "paste", theme });
      return;
    }
    applyPasteToTheme(theme);
  }

  // Subtask 18's left-sidebar context menu: "Delete" - removes `theme`'s
  // on-disk file and drops it from `availableThemes`, mirroring
  // `persistDraft`'s own pattern for refreshing that store field from disk
  // afterwards. Built-in themes have no on-disk file and are never offered
  // this action (hidden in the menu below) - guarded here too as a
  // belt-and-suspenders check. If the deleted theme was the one currently
  // loaded in the editor, falls back to loading whatever theme is now
  // first in the refreshed list (or clears the editor if none remain).
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

  // Wired to the Dialog's own `onOpenChange` (X button, Escape, outside
  // click) below - intercepts an attempted close while the draft is dirty
  // and routes it through the confirmation prompt instead of closing
  // immediately.
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

  // Wired to the left sidebar's theme-row clicks below - intercepts
  // switching to a different theme while the current draft is dirty and
  // routes it through the same confirmation prompt.
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
            {/* Left sidebar - theme list: built-in + user-created themes, plus
                a "create new theme" button (spec.md M7 subtask 14). Each row
                also has a right-click context menu (subtask 18) offering
                copy/paste theme values and delete. */}
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

            {/* Center - live preview (subtask 16: bounded mock canvas with a
                movable/editable text box). Reads the same draftVariables/
                editingTheme state the right sidebar's color editor below
                writes to, so it re-renders live for free as colors change -
                no extra plumbing needed. */}
            <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/30 p-3">
              {editingTheme ? (
                <ThemePreview editingTheme={editingTheme} draftVariables={draftVariables} />
              ) : (
                <div className="text-xs text-muted-foreground">No theme selected</div>
              )}
            </div>

            {/* Right sidebar - color editor (subtask 15: color-wheel editor
                for all 27 ThemeVariableKey values, grouped into labeled
                sections per subtask 3 - see THEME_VARIABLE_GROUPS above).
                Reads each value from draftVariables, falling back to the
                loaded theme's own value when the draft hasn't overridden it
                yet (in practice loadThemeForEditing above always seeds the
                full theme into draftVariables, but this fallback keeps the
                field correct even if that ever changes). Edits only ever
                update draftVariables - not the live app theme
                (lib/themes/apply.ts isn't called here). */}
            <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border bg-sidebar p-3">
              {editingTheme ? (
                <div className="flex flex-col gap-3">
                  {THEME_VARIABLE_GROUPS.map((group) => (
                    <div key={group.label} className="flex flex-col">
                      <span className="px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </span>
                      <div className="flex flex-col divide-y divide-border">
                        {group.keys.map((key) => {
                          const value = draftVariables[key] ?? editingTheme.variables[key];
                          const label = labelForKey(key);

                          if (key === "radius") {
                            return (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-2 py-1"
                              >
                                <label
                                  htmlFor="theme-editor-radius"
                                  className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground"
                                >
                                  {label}
                                </label>
                                <input
                                  id="theme-editor-radius"
                                  type="text"
                                  value={value ?? ""}
                                  onChange={(e) => handleVariableChange(key, e.target.value)}
                                  placeholder="0.625rem"
                                  className="h-6 w-20 shrink-0 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                                />
                              </div>
                            );
                          }

                          return (
                            <ThemeColorField
                              key={key}
                              varKey={key}
                              label={label}
                              value={value}
                              onChange={handleVariableChange}
                            />
                          );
                        })}
                      </div>
                    </div>
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

      {/* Unsaved-changes confirmation prompt (spec.md M7 subtask 17):
          shown instead of immediately closing/switching when the current
          draft is dirty, so an edit in progress can't be silently lost by
          an accidental X/Escape/outside-click or theme-row click. */}
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
