import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import type { Editor as TldrawEditor, TLShapeId } from "@tldraw/tldraw";
import type { Folder, Note, Notebook, Page, SyncStatus } from "@/types";
import type { Theme } from "@/lib/themes/types";
import { BUILTIN_THEMES } from "@/lib/themes/builtin";
import type { ClipboardEntry } from "@/lib/clipboard/sidebarClipboard";

// Session-only history of note visits, kept separate from browser history so UI
// interactions like switching ribbon tabs don't count as pages.
export interface NoteHistoryEntry {
  noteId: string;
}

interface AppState {
  folders: Folder[];
  notes: Note[];
  notebooks: Notebook[];
  // Lets the picker tell "not loaded yet" from "no notebooks". Never resets to
  // false.
  notebooksLoaded: boolean;
  selectedNoteId: string | null;
  // The sidebar's selected folder, separate from its expanded state. The
  // toolbar's New Note/New Folder create inside it, or at the notebook root
  // when null.
  selectedFolderId: string | null;
  // The open notebook.
  selectedNotebookId: string | null;
  sidebarOpen: boolean;
  syncStatus: SyncStatus;
  // The Ribbon is a sibling of the editor, so it reaches the Tiptap editor
  // through here. Null when no text editor is active.
  activeEditor: Editor | null;
  // The tldraw editor, set while any canvas note is open. Can be set together
  // with activeEditor; undo/redo prefer activeEditor.
  activeCanvasEditor: TldrawEditor | null;

  // Where the click that started editing a shape landed, so RichTextShape can
  // put the cursor there. Read once and cleared; never set for new shapes.
  pendingEditClickPoint: { shapeId: TLShapeId; clientX: number; clientY: number } | null;

  // historyIndex is -1 when the stack is empty.
  noteHistory: NoteHistoryEntry[];
  historyIndex: number;
  // Set just before Back/Forward navigation and cleared by the page's load
  // effect, so that navigation doesn't push a new visit.
  isHistoryNavigation: boolean;

  // Starts with the built-in themes so the picker works before user themes load
  // from disk.
  availableThemes: Theme[];
  userThemesLoaded: boolean;
  // Kept in the store so the picker updates immediately on click.
  selectedThemeId: string | null;

  // What's currently cut or copied in the sidebar; the paste logic lives in
  // lib/clipboard/sidebarClipboard.ts.
  clipboard: ClipboardEntry | null;

  // The open note's pages and selection, shared by CanvasEditor and
  // PageSidebar. Not part of the history stack (history is per note).
  // pagesLoading lets the sidebar avoid flashing "no pages" during the first
  // load.
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
  // Ignores a visit identical to the current entry, and drops the forward
  // history when visiting from the middle of the stack.
  visitNote: (entry: NoteHistoryEntry) => void;
  // Returns undefined at either end; the caller does the navigation.
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
