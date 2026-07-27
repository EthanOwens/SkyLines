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
// Folder-delete recursion into child subfolders (spec.md subtask 10, fixing
// the reference app's known bug where delete only cascaded one level) is
// implemented below via `getDescendantFolderIds` + `deleteFolder`.

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

/**
 * Fetches every folder for a user with `dirty = 1`, including soft-deleted
 * ones (deletedAt tombstones must be pushed too - see spec.md subtask 11).
 * Used by lib/sync/push.ts to find rows that need to go to Firestore.
 */
export async function getDirtyFolders(userId: string): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToFolder);
}

/**
 * Marks a folder as successfully synced: clears `dirty` and stamps
 * `syncedAt` with the same client timestamp used for the Firestore write, so
 * local and remote agree on when the push happened.
 */
export async function markFolderSynced(folderId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, folderId],
  );
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
 * Walks the folder tree starting at `folderId` and returns that folder's id
 * plus the ids of every descendant subfolder, at any depth. Implemented as a
 * read-only `WITH RECURSIVE` CTE over `folders.parent_id` rather than
 * fetching one level at a time in a loop - SQLite supports recursive CTEs
 * natively, so this is a single round-trip instead of one query per tree
 * level, and it keeps the tree-walk logic isolated from the write side of
 * `deleteFolder` (easier to reason about / test on its own).
 */
async function getDescendantFolderIds(folderId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `WITH RECURSIVE descendants(id) AS (
       SELECT $1
       UNION
       SELECT f.id FROM ${TABLE} f JOIN descendants d ON f.parent_id = d.id
     )
     SELECT id FROM descendants`,
    [folderId],
  );
  return rows.map((row) => row.id);
}

/**
 * Soft-deletes a folder and recursively cascades that soft-delete to every
 * descendant subfolder (any depth) and every note inside the folder or any
 * of those descendants. This fixes the reference app's known bug (per
 * spec.md subtask 10 / SPEC_iter1.md) where folder-delete cascaded to direct
 * child notes but never recursed into child subfolders at all.
 *
 * All affected rows (the folder, its descendant folders, and all notes
 * under any of them) get the same `deletedAt` timestamp, `dirty = 1`, and
 * `updatedAt`, matching the soft-delete pattern used elsewhere in this file
 * and in lib/db/notes.ts. Nothing is ever `DELETE FROM`-ed.
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const folderIds = await getDescendantFolderIds(folderId);
  const placeholders = folderIds.map((_, i) => `$${i + 3}`).join(", ");

  await db.execute("BEGIN");
  try {
    await db.execute(
      `UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id IN (${placeholders})`,
      [now, now, ...folderIds],
    );

    await db.execute(
      `UPDATE notes SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE folder_id IN (${placeholders})`,
      [now, now, ...folderIds],
    );

    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}
