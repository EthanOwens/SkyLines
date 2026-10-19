import type { Notebook } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

const TABLE = "notebooks";

type NotebookRow = {
  id: string;
  name: string;
  user_id: string;
  order_index: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  dirty: number;
  synced_at: number | null;
};

function rowToNotebook(row: NotebookRow): Notebook {
  return {
    id: row.id,
    name: row.name,
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
 * Fetches the current (non-deleted) notebooks for a user, ordered by
 * `order` ascending - mirrors `getFolders`.
 */
export async function getNotebooks(userId: string): Promise<Notebook[]> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC`,
    [userId],
  );
  return rows.map(rowToNotebook);
}

export async function getNotebookById(notebookId: string): Promise<Notebook | null> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [notebookId],
  );
  return rows.length > 0 ? rowToNotebook(rows[0]) : null;
}

/** Includes soft-deleted rows; see getFolderRowById. */
export async function getNotebookRowById(notebookId: string): Promise<Notebook | null> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [notebookId]);
  return rows.length > 0 ? rowToNotebook(rows[0]) : null;
}

export async function createNotebook(userId: string, name: string, order = 0): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, name, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, 1, NULL)`,
    [id, name, userId, order, now, now],
  );

  notifyDataChange("local");
  return id;
}

export async function updateNotebook(
  notebookId: string,
  updates: Partial<Pick<Notebook, "name" | "order">>,
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
  if (updates.order !== undefined) {
    setClauses.push(`order_index = $${i++}`);
    params.push(updates.order);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(notebookId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
  notifyDataChange("local");
}

/**
 * Soft-deletes the notebook, its folders and their notes with one timestamp.
 * One execute() call for atomicity; see deleteFolder.
 */
export async function deleteNotebook(notebookId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `BEGIN;
     UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3;
     UPDATE folders SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE notebook_id = $3;
     UPDATE notes SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE folder_id IN (
       SELECT id FROM folders WHERE notebook_id = $3
     );
     COMMIT;`,
    [now, now, notebookId],
  );

  notifyDataChange("local");
}

/** Includes soft-deleted rows, since tombstones must be pushed too. */
export async function getDirtyNotebooks(userId: string): Promise<Notebook[]> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToNotebook);
}

/** Uses the same timestamp as the Firestore write. */
export async function markNotebookSynced(notebookId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, notebookId],
  );
}

export type RemoteNotebookData = {
  id: string;
  name: string;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** See upsertFolderFromRemote. */
export async function upsertNotebookFromRemote(
  remote: RemoteNotebookData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, name, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
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

/**
 * Fetches every soft-deleted notebook for a user whose `deletedAt` is older
 * than `cutoffMs` - mirrors `getOldTombstoneFolders`. These are tombstones
 * old enough to be hard-deleted by the periodic cleanup pass.
 */
export async function getOldTombstoneNotebooks(userId: string, cutoffMs: number): Promise<Notebook[]> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToNotebook);
}

/**
 * A real DELETE, for tombstone cleanup only. The notebook's folders must be
 * deleted first (enforced FK).
 */
export async function hardDeleteNotebook(notebookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [notebookId]);
  notifyDataChange("remote");
}

/**
 * Fallback for call sites that have no open notebook: the user's first
 * notebook, creating "My Notebook" if there are none.
 */
export async function getOrCreateDefaultNotebookId(userId: string): Promise<string> {
  const notebooks = await getNotebooks(userId);
  if (notebooks.length > 0) return notebooks[0].id;
  return createNotebook(userId, "My Notebook");
}
