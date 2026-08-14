import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import type { Editor as TldrawEditor, TLShapeId } from "@tldraw/tldraw";
import type { Folder, Note, Notebook, Page, SyncStatus } from "@/types";
import type { Theme } from "@/lib/themes/types";
import { BUILTIN_THEMES } from "@/lib/themes/builtin";
import type { ClipboardEntry } from "@/lib/clipboard/sidebarClipboard";

// Note-visit history stack (spec.md subtask 14, "Back/forward navigation").
// Deliberately session-only, in-memory state (NOT persisted to localStorage
// like lib/lastOpen.ts's single "most recent note" record) - this is a
// custom stack of genuine note/canvas page visits, distinct from raw browser
// history so that non-navigation UI interactions (sidebar collapse/expand,
// ribbon tab switching, etc.) never count as a "page" to go back through.
export interface NoteHistoryEntry {
  noteId: string;
}

// Ported unchanged from ../note_taking_app/stores/appStore.ts (spec.md
// subtask 15, M4 "auth + data hooks rewire") - this is generic client state
// (selection/sidebar/sync-status) with no Firestore/SQLite coupling of its
// own, so nothing here needed to change for the SQLite rewire. What DOES
// change is who calls `setFolders`/`setNotes`/`setSyncStatus` - see
// hooks/useFolders.ts, hooks/useNotes.ts, hooks/useSyncEngine.ts.

interface AppState {
  folders: Folder[];
  notes: Note[];
  notebooks: Notebook[];
  // Tracks whether useNotebooks.ts's first fetch has resolved at least once
  // (spec.md subtask 6, "Notebook picker" bugfix) - lets app/page.tsx tell
  // "notebooks haven't loaded yet" apart from "user genuinely has zero
  // notebooks", so it doesn't flash a false "no notebooks yet" / "notebook
  // not found" state during the initial async SQLite fetch. Stays `true`
  // once set - later refetches (e.g. after creating a notebook) don't flip
  // it back to `false`.
  notebooksLoaded: boolean;
  selectedNoteId: string | null;
  // Which folder row is currently "selected" in the sidebar (spec.md M2
  // subtask 4, "folder selection for scoped creation") - distinct from a
  // folder's own expand/collapse `open` state (FolderItem.tsx's local
  // `useState`) and from `selectedNotebookId` below. Clicking a folder row
  // both toggles its expand/collapse AND sets this; clicking empty space in
  // the sidebar (FolderTree.tsx's own container) clears it back to `null`.
  // Consumed by Sidebar.tsx's toolbar "New Note"/"New Folder" buttons to
  // scope root-toolbar creation under this folder when set, or at the
  // notebook root when `null` - existing per-row inline creation actions
  // (FolderItem.tsx's own "+"/context-menu items) are unaffected, since they
  // already create under that row's own folder id directly.
  selectedFolderId: string | null;
  // Which notebook is currently "open" (spec.md subtask 6, "Notebook
  // picker") - distinct from selectedFolderId/selectedNoteId, which scope a
  // section/note *within* a notebook. Consumed by the picker (app/page.tsx),
  // and will be consumed by the notebook-scoped sidebar rework (subtask 7)
  // and the File tab's "swap notebook" (subtask 9).
  selectedNotebookId: string | null;
  sidebarOpen: boolean;
  syncStatus: SyncStatus;
  // The Tiptap `Editor` instance for whichever note is currently mounted
  // (spec.md subtask 10, "Format tab") - `Ribbon` is rendered by
  // AppLayout.tsx as a sibling of the note/canvas page, not a descendant of
  // RichTextEditor.tsx, so it has no direct access to the `editor` instance
  // RichTextEditor.tsx's `useEditor()` creates. `RichTextEditor.tsx` sets
  // this on mount/editor-instance-change and clears it (back to `null`) on
  // unmount, so the Format tab can tell "a note editor is genuinely mounted"
  // apart from "no note open" / "canvas note with no Tiptap instance at
  // all" and render accordingly.
  activeEditor: Editor | null;
  // The tldraw `Editor` instance for whichever canvas note is currently
  // mounted (spec.md subtask 15, "Undo/redo wiring") - the tldraw analogue
  // of `activeEditor` above, kept as a separate field (rather than reused)
  // since tldraw's `Editor` type is unrelated to Tiptap's. Set/cleared by
  // CanvasEditor.tsx's `handleMount` on mount/unmount, same lifecycle as
  // `activeEditor`. Unlike `activeEditor` (which is only non-null while a
  // specific RichTextShape has genuine Tiptap editing focus - see
  // RichTextShape.tsx), `activeCanvasEditor` is non-null whenever ANY canvas
  // note is open at all, regardless of shape focus - so the two CAN be
  // simultaneously non-null (a canvas note open with no shape focused still
  // has both set). Consumed by TopBar.tsx's top-bar-level Undo/Redo, which
  // prioritizes `activeEditor` (the focused shape's Tiptap history) over
  // `activeCanvasEditor` (tldraw's canvas-level history) when both are set.
  activeCanvasEditor: TldrawEditor | null;

  // spec.md subtask 2 ("Click-to-cursor, no double-click required"). A
  // transient, one-shot signal from RichTextTool.tsx's `Idle.onPointerDown`
  // (the moment it decides an existing rich-text shape was clicked and calls
  // `editor.setEditingShape(hitShape.id)`) to RichTextShape.tsx's edit-mode-
  // entry effect (which runs on a LATER render, once `isEditing` flips true
  // for that shape) - carries the click's raw client (viewport) coordinates
  // so that effect can resolve a precise ProseMirror cursor position via
  // Tiptap's `view.posAtCoords()` instead of unconditionally focusing at the
  // end of the document. Deliberately NOT persisted document data - it's
  // read once and cleared by the consuming effect (or ignored/overwritten by
  // the next click), not part of the tldraw shape/store snapshot. `null`
  // when there's no pending click to apply (e.g. a freshly-created empty
  // shape, which intentionally never sets this - see RichTextTool.tsx).
  pendingEditClickPoint: { shapeId: TLShapeId; clientX: number; clientY: number } | null;

  // The note-visit history stack itself, plus a pointer into it (spec.md
  // subtask 14). `historyIndex` is `-1` when the stack is empty, and
  // otherwise points at the entry currently being viewed.
  noteHistory: NoteHistoryEntry[];
  historyIndex: number;
  // Set immediately before router.push()-ing as a result of clicking
  // Back/Forward in TopBar.tsx, and consumed (read + cleared) by
  // app/note/page.tsx's and app/canvas/page.tsx's note-load effect - lets
  // those pages tell "this navigation came from Back/Forward" (skip
  // re-pushing a visit, since goBack()/goForward() already moved
  // `historyIndex`) apart from "a genuine new visit" (push one via
  // `visitNote`).
  isHistoryNavigation: boolean;

  // Theme picker (spec.md subtask 19). Initialized to `BUILTIN_THEMES` (all
  // synchronously available, no disk I/O) so the picker is immediately
  // usable before the async user-theme `loadThemes()` call (kicked off by
  // AppShell.tsx on mount) resolves; that call then merges user themes in on
  // top. `userThemesLoaded` mirrors the `notebooksLoaded` precedent above -
  // lets callers tell "user themes haven't loaded yet" apart from "user
  // genuinely has none".
  availableThemes: Theme[];
  userThemesLoaded: boolean;
  // The currently-applied theme's id, or `null` for "Default" (no theme
  // overrides applied, i.e. whatever globals.css renders by default). Kept
  // in the store (rather than derived) so the picker's radio group can
  // reflect the live selection immediately after a click, without waiting
  // on a localStorage round-trip.
  selectedThemeId: string | null;

  // Sidebar cut/copy/paste clipboard (spec.md M4 subtask 8, "Right-click
  // context menu"). Same transient, one-shot-signal pattern as
  // `pendingEditClickPoint` above - the actual paste logic lives in
  // lib/clipboard/sidebarClipboard.ts (kept generic/reusable there, not
  // baked into this store), this field just holds "what's on the
  // clipboard right now" so any row's context menu can read/set it. `null`
  // when nothing has been cut/copied. Deliberately built generic enough
  // (`type: "note" | "folder"`) that M6's Page sidebar can reuse this same
  // field/mechanism directly.
  clipboard: ClipboardEntry | null;

  // spec.md M6 subtask 17 ("Page sidebar"). Lifted out of
  // CanvasEditor.tsx's own local `useState` (where subtask 16 first
  // introduced it) so the new, separate `PageSidebar` component can read AND
  // write the same "which page of the currently-open note is selected"
  // state - selecting a row there needs to actually change what
  // CanvasEditor renders. Deliberately kept OUT of `noteHistory` (per
  // spec.md's Key Decision: "Back/forward history stays note-scoped, not
  // page-scoped") - this is plain transient UI state, reset by
  // CanvasEditor.tsx's own note-load effect exactly the way its local
  // `useState` was reset before (on `note.id` change), NOT a new kind of
  // history-stack entry. `pages`/`pagesLoading` mirror `notebooksLoaded`'s
  // "loaded at least once" pattern so PageSidebar can distinguish "still
  // loading" from "note genuinely has an empty list" (should be
  // unreachable in practice - see CanvasEditor.tsx's self-healing default
  // page creation - but the flag still exists so the sidebar doesn't flash
  // a false "no pages" state during the initial async fetch).
  pages: Page[];
  selectedPageId: string | null;
  pagesLoading: boolean;

  setFolders: (folders: Folder[]) => void;
  setNotes: (notes: Note[]) => void;
  setNotebooks: (notebooks: Notebook[]) => void;
  setNotebooksLoaded: (loaded: boolean) => void;
  setSelectedNote: (id: string | null) => void;
  setSelectedFolder: (id: string | null) => void;
  setSelectedNotebook: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setActiveEditor: (editor: Editor | null) => void;
  setActiveCanvasEditor: (editor: TldrawEditor | null) => void;
  setPendingEditClickPoint: (point: AppState["pendingEditClickPoint"]) => void;
  setIsHistoryNavigation: (value: boolean) => void;
  setAvailableThemes: (themes: Theme[]) => void;
  setUserThemesLoaded: (loaded: boolean) => void;
  setSelectedThemeId: (id: string | null) => void;
  setClipboard: (entry: ClipboardEntry | null) => void;
  setPages: (pages: Page[]) => void;
  setSelectedPageId: (id: string | null) => void;
  setPagesLoading: (loading: boolean) => void;
  // Records a genuine new note/canvas visit. No-ops if `entry` is identical
  // to the entry currently pointed at by `historyIndex` (avoids duplicate
  // consecutive entries from e.g. a content-only re-render re-triggering the
  // load effect). Otherwise truncates any abandoned "forward" history past
  // the current position before pushing, standard browser-history-stack
  // semantics: visiting a new note while not at the end of the stack
  // discards the forward entries the user had navigated back out of.
  visitNote: (entry: NoteHistoryEntry) => void;
  // Moves `historyIndex` one step back/forward and returns the entry to
  // navigate to, or `undefined` if already at that boundary (nothing to go
  // back/forward to) - the caller (TopBar.tsx) is responsible for actually
  // navigating there.
  goBack: () => NoteHistoryEntry | undefined;
  goForward: () => NoteHistoryEntry | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  folders: [],
  notes: [],
  notebooks: [],
  notebooksLoaded: false,
  selectedNoteId: null,
  selectedFolderId: null,
  selectedNotebookId: null,
  sidebarOpen: true,
  syncStatus: "saved",
  activeEditor: null,
  activeCanvasEditor: null,
  pendingEditClickPoint: null,
  noteHistory: [],
  historyIndex: -1,
  isHistoryNavigation: false,
  availableThemes: BUILTIN_THEMES,
  userThemesLoaded: false,
  selectedThemeId: null,
  clipboard: null,
  pages: [],
  selectedPageId: null,
  pagesLoading: true,

  setFolders: (folders) => set({ folders }),
  setNotes: (notes) => set({ notes }),
  setNotebooks: (notebooks) => set({ notebooks }),
  setNotebooksLoaded: (loaded) => set({ notebooksLoaded: loaded }),
  setSelectedNote: (id) => set({ selectedNoteId: id }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setSelectedNotebook: (id) => set({ selectedNotebookId: id, selectedFolderId: null }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setActiveEditor: (activeEditor) => set({ activeEditor }),
  setActiveCanvasEditor: (activeCanvasEditor) => set({ activeCanvasEditor }),
  setPendingEditClickPoint: (pendingEditClickPoint) => set({ pendingEditClickPoint }),
  setIsHistoryNavigation: (value) => set({ isHistoryNavigation: value }),
  setAvailableThemes: (availableThemes) => set({ availableThemes }),
  setUserThemesLoaded: (loaded) => set({ userThemesLoaded: loaded }),
  setSelectedThemeId: (selectedThemeId) => set({ selectedThemeId }),
  setClipboard: (clipboard) => set({ clipboard }),
  setPages: (pages) => set({ pages }),
  setSelectedPageId: (selectedPageId) => set({ selectedPageId }),
  setPagesLoading: (pagesLoading) => set({ pagesLoading }),

  visitNote: (entry) => {
    const { noteHistory, historyIndex } = get();
    const current = historyIndex >= 0 ? noteHistory[historyIndex] : undefined;
    if (current && current.noteId === entry.noteId) {
      return;
    }
    const truncated = noteHistory.slice(0, historyIndex + 1);
    const next = [...truncated, entry];
    set({ noteHistory: next, historyIndex: next.length - 1 });
  },

  goBack: () => {
    const { noteHistory, historyIndex } = get();
    if (historyIndex <= 0) return undefined;
    const nextIndex = historyIndex - 1;
    set({ historyIndex: nextIndex });
    return noteHistory[nextIndex];
  },

  goForward: () => {
    const { noteHistory, historyIndex } = get();
    if (historyIndex >= noteHistory.length - 1) return undefined;
    const nextIndex = historyIndex + 1;
    set({ historyIndex: nextIndex });
    return noteHistory[nextIndex];
  },
}));
