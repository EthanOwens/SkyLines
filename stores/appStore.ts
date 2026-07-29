import { create } from "zustand";
import type { Folder, Note, SyncStatus } from "@/types";

// Ported unchanged from ../note_taking_app/stores/appStore.ts (spec.md
// subtask 15, M4 "auth + data hooks rewire") - this is generic client state
// (selection/sidebar/sync-status) with no Firestore/SQLite coupling of its
// own, so nothing here needed to change for the SQLite rewire. What DOES
// change is who calls `setFolders`/`setNotes`/`setSyncStatus` - see
// hooks/useFolders.ts, hooks/useNotes.ts, hooks/useSyncEngine.ts.

interface AppState {
  folders: Folder[];
  notes: Note[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  sidebarOpen: boolean;
  syncStatus: SyncStatus;

  setFolders: (folders: Folder[]) => void;
  setNotes: (notes: Note[]) => void;
  setSelectedNote: (id: string | null) => void;
  setSelectedFolder: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  folders: [],
  notes: [],
  selectedNoteId: null,
  selectedFolderId: null,
  sidebarOpen: true,
  syncStatus: "saved",

  setFolders: (folders) => set({ folders }),
  setNotes: (notes) => set({ notes }),
  setSelectedNote: (id) => set({ selectedNoteId: id }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}));
