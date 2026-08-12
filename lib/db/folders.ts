import type { Folder } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

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

/**
 * Fetches every soft-deleted folder for a user whose `deletedAt` is older
 * than `cutoffMs` (a Unix-ms timestamp, i.e. `Date.now() - maxAgeMs` in
 * lib/sync/cleanup.ts). These are tombstones old enough to be hard-deleted
 * by the periodic cleanup pass (spec.md subtask 13) - includes both dirty
 * and non-dirty rows. Fetching a dirty row here does NOT by itself mean
 * it's safe to hard-delete: `hardDeleteTombstone` in lib/sync/cleanup.ts
 * decides per-row whether a fetched candidate is actually safe to purge
 * this pass, since "dirty" is ambiguous between "never synced at all" (safe
 * to clean up locally) and "was synced once but the soft-delete itself
 * hasn't been confirmed pushed yet" (must be skipped entirely - see that
 * file for the full reasoning).
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
 * Genuinely `DELETE FROM`s a folder row - unlike every other write in this
 * file, this does not soft-delete. Only meant to be called by the periodic
 * tombstone cleanup pass (lib/sync/cleanup.ts, spec.md subtask 13) on rows
 * that are already tombstones old enough to purge; callers are responsible
 * for FK-safe ordering (child folders/notes before parents - see
 * lib/sync/cleanup.ts) since `folders.parent_id` and `notes.folder_id` are
 * enforced foreign keys.
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
 * Same as `getFolderById`, but does NOT filter out soft-deleted rows. Pull
 * sync (lib/sync/pull.ts, spec.md subtask 12) needs to find the local row
 * for LWW comparison even when it's a tombstone (e.g. a remote update to a
 * previously-deleted row, or vice versa) - `getFolderById` would silently
 * report "no local row" and cause an incorrect re-insert.
 */
export async function getFolderRowById(folderId: string): Promise<Folder | null> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [folderId]);
  return rows.length > 0 ? rowToFolder(rows[0]) : null;
}

/**
 * Shape of a `folders` Firestore document as written by
 * lib/sync/push.ts's `folderToFirestoreDoc`, plus the Firestore doc id
 * (which is the same as the local `id` - both sides use the same
 * client-generated uuid as primary key).
 */
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
 * Inserts a new local folder row from remote (Firestore) data, or
 * overwrites an existing one, via `INSERT ... ON CONFLICT(id) DO UPDATE`.
 * This is the write primitive pull sync (lib/sync/pull.ts) uses once it has
 * already decided - via LWW/conflict comparison - that the remote data
 * should land locally; this function does not itself make that decision.
 *
 * `dirty`/`syncedAt` are supplied by the caller rather than hardcoded,
 * because the right values differ by outcome:
 *  - plain "no local row yet" or "remote is newer, not dirty" pulls: the
 *    row now matches Firestore exactly, so dirty=false, syncedAt=now.
 *  - the local-row-was-dirty-but-lost-the-conflict case: same thing, the
 *    row now holds the winning remote data and matches Firestore, so
 *    dirty=false, syncedAt=now.
 * (The local-wins-the-conflict case never calls this function at all -
 * see lib/sync/pull.ts - because the local row's content is already
 * correct and still needs a future push, so it must be left untouched.)
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

/**
 * `notebookId` is a required parameter - every new folder must belong to a
 * notebook now (spec.md M1 subtask 2). The `folders.notebook_id` column
 * itself stays nullable at the SQLite schema level (see the migration 3
 * comment in src-tauri/src/lib.rs for why - no single sensible constant
 * `DEFAULT` exists for a per-user backfill), so this requirement is enforced
 * here at the application layer instead, by simply not offering a way to
 * omit it.
 */
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
 *
 * Both `UPDATE`s below are sent as a SINGLE multi-statement `db.execute()`
 * call (one semicolon-joined `BEGIN; UPDATE ...; UPDATE ...; COMMIT;` string)
 * rather than as separate `db.execute()` calls wrapping a `BEGIN`/`COMMIT`
 * transaction. Separate calls don't work here: `@tauri-apps/plugin-sql`'s
 * SQLite backend pools connections, so a `db.execute("BEGIN")` followed by
 * further `db.execute(...)` calls isn't guaranteed to reuse the same pooled
 * connection, which surfaced as a real, reproducible `cannot commit - no
 * transaction is active` runtime error. Each `db.execute()` call is exactly
 * one `invoke()` IPC round-trip that acquires exactly one pooled connection
 * and streams the whole query string through it, and sqlx-sqlite's
 * `VirtualStatement` natively steps through multiple `;`-separated
 * statements sequentially on that one connection - so folding both `UPDATE`s
 * (plus `BEGIN`/`COMMIT`) into one call restores real atomicity without ever
 * needing two calls to coordinate a transaction across connections. The
 * named `$N` placeholders resolve directly from the literal number in the
 * SQL text against the single flat bind-values array regardless of which
 * sub-statement they're in, so both `UPDATE`s can keep reusing `$1`/`$2` for
 * the timestamps and `$3...` for the folder ids against the same
 * `[now, now, ...folderIds]` array.
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
     COMMIT;`,
    [now, now, ...folderIds],
  );

  notifyDataChange("local");
}
