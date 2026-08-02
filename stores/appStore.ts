import { create } from "zustand";
import type { Folder, Note, Notebook, SyncStatus } from "@/types";

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
  selectedFolderId: string | null;
  // Which notebook is currently "open" (spec.md subtask 6, "Notebook
  // picker") - distinct from selectedFolderId/selectedNoteId, which scope a
  // section/note *within* a notebook. Consumed by the picker (app/page.tsx),
  // and will be consumed by the notebook-scoped sidebar rework (subtask 7)
  // and the File tab's "swap notebook" (subtask 9).
  selectedNotebookId: string | null;
  sidebarOpen: boolean;
  syncStatus: SyncStatus;

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
}

export const useAppStore = create<AppState>((set) => ({
  folders: [],
  notes: [],
  notebooks: [],
  notebooksLoaded: false,
  selectedNoteId: null,
  selectedFolderId: null,
  selectedNotebookId: null,
  sidebarOpen: true,
  syncStatus: "saved",

  setFolders: (folders) => set({ folders }),
  setNotes: (notes) => set({ notes }),
  setNotebooks: (notebooks) => set({ notebooks }),
  setNotebooksLoaded: (loaded) => set({ notebooksLoaded: loaded }),
  setSelectedNote: (id) => set({ selectedNoteId: id }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setSelectedNotebook: (id) => set({ selectedNotebookId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}));
