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
  // Nullable in the schema, but createFolder requires it and old rows were
  // backfilled.
  notebookId: string | null;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping.
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

// Same shape as Folder without parentId: notebooks don't nest.
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
  // Nullable in the schema, but createNote requires it and old rows were
  // backfilled.
  notebookId: string | null;
  userId: string;
  content?: object | null;    // TipTap JSON doc
  canvasData?: object | null; // Tldraw snapshot
  // Order among siblings in the sidebar.
  order: number;
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping.
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

// A note groups one or more pages; each page is its own canvas. userId is kept
// so sync can query pages by user like every other table.
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
  // Sync bookkeeping.
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

// A top-level entity with its own window, outside the folder tree. A null
// topBarColor means "use the theme's --primary". favorite is independent of
// pinned (pinned means always on top).
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
  // Sync bookkeeping.
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

export type SyncStatus = "saved" | "syncing" | "offline" | "error";
