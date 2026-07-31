import type { Notebook } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// Local SQLite data-access layer for `notebooks` (spec.md M1 subtask 2),
// mirroring lib/db/folders.ts's CRUD/soft-delete/dirty-tracking pattern
// field-for-field so that the sync-engine wiring (spec.md M1 subtask 3,
// lib/sync/push.ts/pull.ts/cleanup.ts) can call into this file exactly the
// way it already calls into lib/db/folders.ts today. Notebooks don't nest
// (no `parent_id` equivalent), so unlike folders there's no recursive
// tree-walk needed for delete - a notebook's folders are already directly
// identified by `folders.notebook_id`.

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

/**
 * Same as `getNotebookById`, but does NOT filter out soft-deleted rows.
 * Pull sync needs to find the local row for LWW comparison even when it's a
 * tombstone - mirrors `getFolderRowById`.
 */
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
 * Soft-deletes a notebook and cascades that soft-delete to every folder
 * whose `notebook_id` is this notebook's id, and every note inside any of
 * those folders. Unlike `deleteFolder`, no recursive CTE is needed to find
 * the affected folders - they're already directly identified by
 * `notebook_id` - but the cascade is otherwise the same shape: all affected
 * rows (the notebook, its folders, and all notes under any of them) get the
 * same `deletedAt` timestamp, `dirty = 1`, and `updatedAt`. Nothing is ever
 * `DELETE FROM`-ed.
 *
 * All three `UPDATE`s below are sent as a SINGLE multi-statement
 * `db.execute()` call (one semicolon-joined `BEGIN; UPDATE ...; UPDATE ...;
 * UPDATE ...; COMMIT;` string) rather than as separate `db.execute()` calls
 * wrapping a `BEGIN`/`COMMIT` transaction, for the exact same reason
 * documented in detail on `deleteFolder` in lib/db/folders.ts:
 * `@tauri-apps/plugin-sql`'s SQLite backend pools connections, so a
 * `db.execute("BEGIN")` followed by further `db.execute(...)` calls isn't
 * guaranteed to reuse the same pooled connection, which surfaced there as a
 * real, reproducible `cannot commit - no transaction is active` runtime
 * error. Folding all three `UPDATE`s (plus `BEGIN`/`COMMIT`) into one call
 * keeps them on a single pooled connection, restoring real atomicity.
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

/**
 * Fetches every notebook for a user with `dirty = 1`, including
 * soft-deleted ones (deletedAt tombstones must be pushed too) - mirrors
 * `getDirtyFolders`. Used by lib/sync/push.ts to find rows that need to go
 * to Firestore.
 */
export async function getDirtyNotebooks(userId: string): Promise<Notebook[]> {
  const db = await getDb();
  const rows = await db.select<NotebookRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToNotebook);
}

/**
 * Marks a notebook as successfully synced: clears `dirty` and stamps
 * `syncedAt` with the same client timestamp used for the Firestore write -
 * mirrors `markFolderSynced`.
 */
export async function markNotebookSynced(notebookId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, notebookId],
  );
}

/**
 * Shape of a `notebooks` Firestore document, plus the Firestore doc id
 * (same as the local `id`) - mirrors `RemoteFolderData`. The actual
 * `notebookToFirestoreDoc` writer lives in lib/sync/push.ts, which is wired
 * up in a later subtask (spec.md M1 subtask 3); this type just documents
 * the shape that function is expected to produce.
 */
export type RemoteNotebookData = {
  id: string;
  name: string;
  userId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/**
 * Inserts a new local notebook row from remote (Firestore) data, or
 * overwrites an existing one, via `INSERT ... ON CONFLICT(id) DO UPDATE` -
 * mirrors `upsertFolderFromRemote`. This is the write primitive pull sync
 * uses once it has already decided - via LWW/conflict comparison - that the
 * remote data should land locally; this function does not itself make that
 * decision.
 */
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
 * Genuinely `DELETE FROM`s a notebook row - unlike every other write in
 * this file, this does not soft-delete. Only meant to be called by the
 * periodic tombstone cleanup pass on rows that are already tombstones old
 * enough to purge; callers are responsible for FK-safe ordering (folders
 * referencing this notebook must be hard-deleted first, since
 * `folders.notebook_id REFERENCES notebooks(id)` is an enforced foreign
 * key) - mirrors `hardDeleteFolder`.
 */
export async function hardDeleteNotebook(notebookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [notebookId]);
  notifyDataChange("remote");
}

/**
 * Returns the id of a user's first notebook, creating a default
 * "My Notebook" if they have none yet. Used as a placeholder notebook
 * context by call sites that don't yet have a real "currently open
 * notebook" concept wired in (the notebook picker/sidebar rework are
 * separate, later subtasks) - this keeps createFolder's now-required
 * notebookId satisfiable everywhere without inventing real UI here.
 */
export async function getOrCreateDefaultNotebookId(userId: string): Promise<string> {
  const notebooks = await getNotebooks(userId);
  if (notebooks.length > 0) return notebooks[0].id;
  return createNotebook(userId, "My Notebook");
}
