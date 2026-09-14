import type { Page } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// Local SQLite data-access layer for `pages` (spec.md M6 subtask 14),
// mirroring lib/db/notes.ts's exact function names/shapes/conventions - see
// that file's header comment for the reasoning behind the one-shot-query
// (no realtime listener) model. `getPages` is scoped by `noteId` (a page
// always belongs to exactly one note, per the Page type's required `noteId`
// FK) rather than by `userId` directly, since that's how callers will
// actually want to read pages (all pages for the note currently open) - the
// `user_id` column is still kept on every row/query below so sync
// (getDirtyPages/getOldTombstonePages) can use the same flat
// `WHERE user_id = $1` pattern as every other synced entity.

const TABLE = "pages";

type PageRow = {
  id: string;
  note_id: string;
  title: string;
  user_id: string;
  content: string | null;
  canvas_data: string | null;
  order_index: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  dirty: number;
  synced_at: number | null;
};

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    noteId: row.note_id,
    title: row.title,
    userId: row.user_id,
    content: row.content !== null ? (JSON.parse(row.content) as object | null) : null,
    canvasData:
      row.canvas_data !== null ? (JSON.parse(row.canvas_data) as object | null) : null,
    order: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Fetches the current (non-deleted) pages for a note, ordered by
 * `order_index` ascending (a note's pages have a stable display order, the
 * same way a folder's notes do via `Note.order`).
 */
export async function getPages(noteId: string): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE note_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC`,
    [noteId],
  );
  return rows.map(rowToPage);
}

/**
 * Fetches every page for a user with `dirty = 1`, including soft-deleted
 * ones (deletedAt tombstones must be pushed too - see `getDirtyNotes` in
 * lib/db/notes.ts). Used by lib/sync/push.ts (spec.md subtask 15) to find
 * rows that need to go to Firestore.
 */
export async function getDirtyPages(userId: string): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToPage);
}

/**
 * Marks a page as successfully synced: clears `dirty` and stamps
 * `syncedAt` with the same client timestamp used for the Firestore write, so
 * local and remote agree on when the push happened.
 */
export async function markPageSynced(pageId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, pageId],
  );
}

/**
 * Fetches every soft-deleted page for a user whose `deletedAt` is older
 * than `cutoffMs` (a Unix-ms timestamp, i.e. `Date.now() - maxAgeMs` in
 * lib/sync/cleanup.ts). These are tombstones old enough to be hard-deleted
 * by the periodic cleanup pass (spec.md subtask 15) - see
 * `getOldTombstoneNotes` in lib/db/notes.ts for why non-dirty AND dirty
 * rows are both included.
 */
export async function getOldTombstonePages(userId: string, cutoffMs: number): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToPage);
}

/**
 * Genuinely `DELETE FROM`s a page row - unlike every other write in this
 * file, this does not soft-delete. Only meant to be called by the periodic
 * tombstone cleanup pass (lib/sync/cleanup.ts, spec.md subtask 15) on rows
 * that are already tombstones old enough to purge.
 */
export async function hardDeletePage(pageId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [pageId]);
  notifyDataChange("remote");
}

export async function getPageById(pageId: string): Promise<Page | null> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [pageId],
  );
  return rows.length > 0 ? rowToPage(rows[0]) : null;
}

/**
 * Same as `getPageById`, but does NOT filter out soft-deleted rows. Pull
 * sync (lib/sync/pull.ts, spec.md subtask 15) needs to find the local row
 * for LWW comparison even when it's a tombstone - `getPageById` would
 * silently report "no local row" and cause an incorrect re-insert.
 */
export async function getPageRowById(pageId: string): Promise<Page | null> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [pageId]);
  return rows.length > 0 ? rowToPage(rows[0]) : null;
}

/**
 * Shape of a `pages` Firestore document as written by lib/sync/push.ts's
 * (future) `pageToFirestoreDoc`, plus the Firestore doc id (same as local
 * `id`). `content`/`canvasData` are plain objects here (as stored in
 * Firestore), not JSON strings - `upsertPageFromRemote` below stringifies
 * them the same way `updatePage` does before writing to the local `TEXT`
 * columns.
 */
export type RemotePageData = {
  id: string;
  noteId: string;
  title: string;
  userId: string;
  content: object | null;
  canvasData: object | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/**
 * Inserts a new local page row from remote (Firestore) data, or overwrites
 * an existing one, via `INSERT ... ON CONFLICT(id) DO UPDATE`. This is the
 * write primitive pull sync (lib/sync/pull.ts) uses once it has already
 * decided - via LWW/conflict comparison - that the remote data should land
 * locally; this function does not itself make that decision. See
 * `upsertNoteFromRemote` in lib/db/notes.ts for the full reasoning on why
 * `dirty`/`syncedAt` are caller-supplied rather than hardcoded.
 */
export async function upsertPageFromRemote(
  remote: RemotePageData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, note_id, title, user_id, content, canvas_data, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(id) DO UPDATE SET
       note_id = excluded.note_id,
       title = excluded.title,
       user_id = excluded.user_id,
       content = excluded.content,
       canvas_data = excluded.canvas_data,
       order_index = excluded.order_index,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       dirty = excluded.dirty,
       synced_at = excluded.synced_at`,
    [
      remote.id,
      remote.noteId,
      remote.title,
      remote.userId,
      remote.content === null ? null : JSON.stringify(remote.content),
      remote.canvasData === null ? null : JSON.stringify(remote.canvasData),
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
 * Creates a new page row for `noteId`. Used directly by a future "add page"
 * UI action (spec.md subtask 17). `lib/db/notes.ts`'s `createNote` does NOT
 * call this - it needs its own note-insert and page-insert to land in the
 * same pooled SQLite connection to be truly atomic (see the comment on
 * `createNote` in lib/db/notes.ts, and `deleteFolder` in lib/db/folders.ts
 * for the established precedent), so it inlines an equivalent
 * `BEGIN; INSERT notes; INSERT pages; COMMIT;` multi-statement `db.execute()`
 * call instead of calling this function.
 */
export async function createPage(
  noteId: string,
  userId: string,
  title = "Untitled",
  order = 0,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, note_id, title, user_id, content, canvas_data, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, NULL, 1, NULL)`,
    [id, noteId, title, userId, order, now, now],
  );

  notifyDataChange("local");
  return id;
}

export async function updatePage(
  pageId: string,
  updates: Partial<Pick<Page, "title" | "content" | "canvasData" | "order">>,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${i++}`);
    params.push(updates.title);
  }
  if (updates.content !== undefined) {
    setClauses.push(`content = $${i++}`);
    params.push(updates.content === null ? null : JSON.stringify(updates.content));
  }
  if (updates.canvasData !== undefined) {
    setClauses.push(`canvas_data = $${i++}`);
    params.push(updates.canvasData === null ? null : JSON.stringify(updates.canvasData));
  }
  if (updates.order !== undefined) {
    setClauses.push(`order_index = $${i++}`);
    params.push(updates.order);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(pageId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
  notifyDataChange("local");
}

/**
 * Soft-deletes a single page: sets `deletedAt`/`dirty`, does not `DELETE
 * FROM` the row - matches `deleteNote`'s exact soft-delete pattern in
 * lib/db/notes.ts.
 */
export async function deletePage(pageId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3`,
    [now, now, pageId],
  );
  notifyDataChange("local");
}
