import type { Page } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// Read by note, but every row still keeps user_id so sync can query with the
// same WHERE user_id pattern as other tables.

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

/** Includes soft-deleted rows, since tombstones must be pushed too. */
export async function getDirtyPages(userId: string): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToPage);
}

/** Uses the same timestamp as the Firestore write. */
export async function markPageSynced(pageId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, pageId],
  );
}

/** Old tombstones, dirty or not; see getOldTombstoneFolders. */
export async function getOldTombstonePages(userId: string, cutoffMs: number): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToPage);
}

/** A real DELETE, for tombstone cleanup only. */
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

/** Includes soft-deleted rows; see getNoteRowById. */
export async function getPageRowById(pageId: string): Promise<Page | null> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [pageId]);
  return rows.length > 0 ? rowToPage(rows[0]) : null;
}

/** content and canvasData are objects here and stringified on write. */
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

/** See upsertFolderFromRemote. */
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
 * createNote doesn't call this: it inserts its first page in its own
 * single-call transaction.
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
