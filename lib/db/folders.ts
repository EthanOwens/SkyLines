import type { Folder } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

const TABLE = "folders";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  notebook_id: string | null;
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
    notebookId: row.notebook_id,
    userId: row.user_id,
    order: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/** Plain one-shot reads: callers refetch after writes. */
export async function getFolders(userId: string): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC`,
    [userId],
  );
  return rows.map(rowToFolder);
}

/** Includes soft-deleted rows, since tombstones must be pushed too. */
export async function getDirtyFolders(userId: string): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToFolder);
}

/** Uses the same timestamp as the Firestore write, so both sides agree. */
export async function markFolderSynced(folderId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, folderId],
  );
}

/**
 * Old tombstones, dirty or not. Being returned here doesn't make a row safe to
 * hard-delete; lib/sync/cleanup.ts decides per row.
 */
export async function getOldTombstoneFolders(userId: string, cutoffMs: number): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToFolder);
}

/**
 * A real DELETE, for tombstone cleanup only. Callers must delete children
 * first: parent_id and notes.folder_id are enforced foreign keys.
 */
export async function hardDeleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [folderId]);
  notifyDataChange("remote");
}

export async function getFolderById(folderId: string): Promise<Folder | null> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [folderId],
  );
  return rows.length > 0 ? rowToFolder(rows[0]) : null;
}

/**
 * Includes soft-deleted rows: pull sync must find tombstones, or it would
 * re-insert them.
 */
export async function getFolderRowById(folderId: string): Promise<Folder | null> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [folderId]);
  return rows.length > 0 ? rowToFolder(rows[0]) : null;
}

/** The Firestore doc id is the local id. */
export type RemoteFolderData = {
  id: string;
  name: string;
  parentId: string | null;
  notebookId: string | null;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/**
 * Writes remote data that pull sync has already chosen to keep. dirty and
 * syncedAt come from the caller (pull never calls this when local wins).
 */
export async function upsertFolderFromRemote(
  remote: RemoteFolderData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, name, parent_id, notebook_id, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       parent_id = excluded.parent_id,
       notebook_id = excluded.notebook_id,
       user_id = excluded.user_id,
       order_index = excluded.order_index,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       dirty = excluded.dirty,
       synced_at = excluded.synced_at`,
    [
      remote.id,
      remote.name,
      remote.parentId,
      remote.notebookId,
      remote.userId,
      remote.order,
      remote.createdAt,
      remote.updatedAt,
      remote.deletedAt,
      dirty ? 1 : 0,
      syncedAt,
    ],
  );
  notifyDataChange("remote");
}

/** notebookId is required here because the column is nullable in the schema. */
export async function createFolder(
  userId: string,
  name: string,
  notebookId: string,
  parentId: string | null = null,
  order = 0,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, name, parent_id, user_id, notebook_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 1, NULL)`,
    [id, name, parentId, userId, notebookId, order, now, now],
  );

  notifyDataChange("local");
  return id;
}

export async function updateFolder(
  folderId: string,
  updates: Partial<Pick<Folder, "name" | "parentId" | "order" | "notebookId">>,
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
  if (updates.notebookId !== undefined) {
    setClauses.push(`notebook_id = $${i++}`);
    params.push(updates.notebookId);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(folderId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
  notifyDataChange("local");
}

/** One recursive CTE instead of a query per tree level. */
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
 * Soft-deletes the folder, every descendant folder, their notes, and those
 * notes' pages, all with the same timestamp. Pages are included because
 * pages.note_id is an enforced FK without ON DELETE CASCADE, so cleanup would
 * otherwise fail to hard-delete the notes.
 *
 * The whole transaction is one execute() call. plugin-sql pools connections, so
 * separate BEGIN/UPDATE/COMMIT calls can land on different connections ("cannot
 * commit - no transaction is active"); sqlx runs all ;-separated statements of
 * one call on one connection. $N placeholders resolve against the single bind
 * array across statements.
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const folderIds = await getDescendantFolderIds(folderId);
  const placeholders = folderIds.map((_, i) => `$${i + 3}`).join(", ");

  await db.execute(
    `BEGIN;
     UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id IN (${placeholders});
     UPDATE notes SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE folder_id IN (${placeholders});
     UPDATE pages SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE note_id IN (SELECT id FROM notes WHERE folder_id IN (${placeholders}));
     COMMIT;`,
    [now, now, ...folderIds],
  );

  notifyDataChange("local");
}
