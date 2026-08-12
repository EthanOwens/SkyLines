export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  // Which notebook this folder (section) belongs to. Nullable at the SQLite
  // schema level for backward-compat reasons (see the migration 3 comment
  // in src-tauri/src/lib.rs), but every folder created going forward via
  // `createFolder` is required to supply one, and pre-existing rows are
  // backfilled - so in practice this is only ever null for a row that
  // somehow slipped past the application-layer requirement.
  notebookId: string | null;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping (mirrors sqlite `folders` columns dirty/synced_at/deleted_at,
  // added per spec.md subtask 7).
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

// Notebook (spec.md M1 subtask 2): same shape/sync-bookkeeping fields as
// Folder, minus `parentId` - notebooks are top-level and don't nest.
export interface Notebook {
  id: string;
  name: string;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

export interface Note {
  id: string;
  title: string;
  type: "note" | "canvas";
  folderId: string | null;
  // Which notebook this note belongs to. Nullable at the SQLite schema
  // level for backward-compat reasons (see the migration 4 comment in
  // src-tauri/src/lib.rs), but every note created going forward via
  // `createNote` is required to supply one, and pre-existing rows are
  // backfilled - so in practice this is only ever null for a row that
  // somehow slipped past the application-layer requirement. Mirrors
  // `Folder.notebookId` exactly.
  notebookId: string | null;
  userId: string;
  content?: object | null;    // TipTap JSON doc
  canvasData?: object | null; // Tldraw snapshot
  // Sibling display order within a folder (or within the notebook root for
  // folder-less notes), mirroring `Folder.order` (spec.md M4 subtask 7,
  // "Sidebar drag-and-drop reordering") - drives the sidebar's sort order,
  // independent of `updatedAt`.
  order: number;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping (mirrors sqlite `notes` columns dirty/synced_at/deleted_at,
  // added per spec.md subtask 7).
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

export type SyncStatus = "saved" | "syncing" | "offline" | "error";
