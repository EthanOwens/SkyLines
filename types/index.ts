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

// Page (spec.md M6 subtask 13): a Note becomes a lightweight container that
// groups one or more Pages, each an independent canvas (its own
// `RichTextShape`s, ink, etc.) - the actual editable content moves down one
// level, from Note to Page. Mirrors `Note`'s shape exactly, minus the
// notebook/folder/type fields (a page belongs to exactly one note, not a
// folder/notebook), plus the required `noteId` FK. `userId` is kept (not
// dropped in favor of a join through `notes`) so page queries/sync can use
// the same flat `WHERE user_id = $1` pattern as every other synced entity.
export interface Page {
  id: string;
  noteId: string;
  title: string;
  userId: string;
  content?: object | null;    // TipTap JSON doc
  canvasData?: object | null; // Tldraw snapshot
  // Sibling display order within a note, mirroring `Note.order`.
  order: number;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping (mirrors sqlite `pages` columns dirty/synced_at/deleted_at,
  // added per spec.md subtask 13).
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

// StickyNote (spec.md subtask 7): a top-level entity of its own, not scoped
// to a Note/Page the way Page is scoped via `noteId` - a sticky note lives
// independently, its own pop-out window. Mirrors `Note`'s sync-bookkeeping
// shape minus the folder/notebook/type/order fields (sticky notes don't
// live in the folder tree), plus `topBarColor` (nullable - null means "use
// the active theme's --primary", per spec.md subtask 9's fallback, not
// implemented here) and `pinned`. `favorite` (spec.md subtask 2) is a
// separate, independent boolean - not a rename or reuse of `pinned`.
export interface StickyNote {
  id: string;
  userId: string;
  title: string;
  content?: object | null; // TipTap JSON doc
  topBarColor: string | null;
  pinned: boolean;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping (mirrors sqlite `sticky_notes` columns
  // dirty/synced_at/deleted_at, added per spec.md subtask 7).
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

export type SyncStatus = "saved" | "syncing" | "offline" | "error";
