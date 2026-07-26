import type { Folder } from "@/types";
import { getDb } from "./client";

// Local SQLite data-access layer for `folders` (spec.md subtask 9), mirroring
// the function names/shapes of the current Firestore-backed
// `../note_taking_app/lib/firestore/folders.ts` so subtask 15 can rewire
// stores/appStore.ts and hooks/useFolders.ts against this with minimal
// changes. Unlike Firestore's onSnapshot, SQLite reads here are plain
// one-shot async queries - there's no realtime listener model to fake
// locally (subtask 15's job is wiring re-fetches, not this subtask's).
//
// Folder-delete recursion into child subfolders is explicitly deferred to
// subtask 10 - `deleteFolder` here only soft-deletes the single row.

const TABLE = "folders";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  user_id: string;
  order_index: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  dirty: number;
  synced_at: number | null;
};

function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    userId: row.user_id,
    order: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Fetches the current (non-deleted) folders for a user, ordered the same
 * way the Firestore `subscribeFolders` query was (`order` ascending). This
 * replaces that subscription with a plain one-shot read - callers re-invoke
 * it after mutations rather than receiving push updates.
 */
export async function getFolders(userId: string): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC`,
    [userId],
  );
  return rows.map(rowToFolder);
}

export async function getFolderById(folderId: string): Promise<Folder | null> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [folderId],
  );
  return rows.length > 0 ? rowToFolder(rows[0]) : null;
}

export async function createFolder(
  userId: string,
  name: string,
  parentId: string | null = null,
  order = 0,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, name, parent_id, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 1, NULL)`,
    [id, name, parentId, userId, order, now, now],
  );

  return id;
}

export async function updateFolder(
  folderId: string,
  updates: Partial<Pick<Folder, "name" | "parentId" | "order">>,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${i++}`);
    params.push(updates.name);
  }
  if (updates.parentId !== undefined) {
    setClauses.push(`parent_id = $${i++}`);
    params.push(updates.parentId);
  }
  if (updates.order !== undefined) {
    setClauses.push(`order_index = $${i++}`);
    params.push(updates.order);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(folderId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
}

/**
 * Soft-deletes a single folder: sets `deletedAt`/`dirty`, does not `DELETE
 * FROM` the row and does not recurse into child folders/notes (that
 * recursive cascade is subtask 10's job, layered on top of this).
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3`,
    [now, now, folderId],
  );
}
