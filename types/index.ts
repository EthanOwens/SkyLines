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

export interface Note {
  id: string;
  title: string;
  type: "note" | "canvas";
  folderId: string | null;
  userId: string;
  content?: object | null;    // TipTap JSON doc
  canvasData?: object | null; // Tldraw snapshot
  createdAt: number;
  updatedAt: number;
  // Sync bookkeeping (mirrors sqlite `notes` columns dirty/synced_at/deleted_at,
  // added per spec.md subtask 7).
  dirty: boolean;
  syncedAt: number | null;
  deletedAt: number | null;
}

export type SyncStatus = "saved" | "syncing" | "offline" | "error";
