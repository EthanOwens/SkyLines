import type { Note } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

const TABLE = "notes";

type NoteRow = {
  id: string;
  title: string;
  type: "note" | "canvas";
  folder_id: string | null;
  notebook_id: string | null;
  user_id: string;
  content: string | null;
  canvas_data: string | null;
  order_index: number;
  color: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  dirty: number;
  synced_at: number | null;
};

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    folderId: row.folder_id,
    notebookId: row.notebook_id,
    userId: row.user_id,
    content: row.content !== null ? (JSON.parse(row.content) as object | null) : null,
    canvasData:
      row.canvas_data !== null ? (JSON.parse(row.canvas_data) as object | null) : null,
    order: row.order_index,
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/** Plain one-shot reads: callers refetch after writes. */
export async function getNotes(userId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(rowToNote);
}

/** Includes soft-deleted rows, since tombstones must be pushed too. */
export async function getDirtyNotes(userId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToNote);
}

/** Uses the same timestamp as the Firestore write, so both sides agree. */
export async function markNoteSynced(noteId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, noteId],
  );
}

/** Old tombstones, dirty or not; see getOldTombstoneFolders. */
export async function getOldTombstoneNotes(userId: string, cutoffMs: number): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToNote);
}

/** A real DELETE, for tombstone cleanup only. */
export async function hardDeleteNote(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [noteId]);
  notifyDataChange("remote");
}

export async function getNoteById(noteId: string, userId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [noteId, userId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

/**
 * Includes soft-deleted rows: pull sync must find tombstones, or it would
 * re-insert them.
 */
export async function getNoteRowById(noteId: string, userId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1 AND user_id = $2`, [noteId, userId]);
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

/** content and canvasData are objects here and stringified on write. */
export type RemoteNoteData = {
  id: string;
  title: string;
  type: "note" | "canvas";
  folderId: string | null;
  notebookId: string | null;
  userId: string;
  content: object | null;
  canvasData: object | null;
  order: number;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** See upsertFolderFromRemote. */
export async function upsertNoteFromRemote(
  remote: RemoteNoteData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, title, type, folder_id, notebook_id, user_id, content, canvas_data, order_index, color, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       folder_id = excluded.folder_id,
       notebook_id = excluded.notebook_id,
       user_id = excluded.user_id,
       content = excluded.content,
       canvas_data = excluded.canvas_data,
       order_index = excluded.order_index,
       color = excluded.color,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       dirty = excluded.dirty,
       synced_at = excluded.synced_at`,
    [
      remote.id,
      remote.title,
      remote.type,
      remote.folderId,
      remote.notebookId,
      remote.userId,
      remote.content === null ? null : JSON.stringify(remote.content),
      remote.canvasData === null ? null : JSON.stringify(remote.canvasData),
      remote.order,
      remote.color,
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
 * notebookId is required here because the column is nullable in the schema.
 * Every note gets its first page in the same transaction, so a note without
 * pages can't exist. One execute() call for atomicity; see deleteFolder.
 */
export async function createNote(
  userId: string,
  type: "note" | "canvas",
  notebookId: string,
  folderId: string | null = null,
  title = "Untitled",
  order = 0,
  color: string | null = null,
  firstPageColor: string | null = null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `BEGIN;
     INSERT INTO ${TABLE}
       (id, title, type, folder_id, notebook_id, user_id, content, canvas_data, order_index, color, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $10, $8, $8, NULL, 1, NULL);
     INSERT INTO pages
       (id, note_id, title, user_id, content, canvas_data, order_index, color, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($9, $1, 'Untitled', $6, NULL, NULL, 0, $11, $8, $8, NULL, 1, NULL);
     COMMIT;`,
    [id, title, type, folderId, notebookId, userId, order, now, pageId, color, firstPageColor],
  );

  notifyDataChange("local");
  return id;
}

export async function updateNote(
  noteId: string,
  updates: Partial<
    Pick<Note, "title" | "content" | "canvasData" | "folderId" | "order" | "notebookId" | "color">
  >,
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
  if (updates.folderId !== undefined) {
    setClauses.push(`folder_id = $${i++}`);
    params.push(updates.folderId);
  }
  if (updates.order !== undefined) {
    setClauses.push(`order_index = $${i++}`);
    params.push(updates.order);
  }
  if (updates.notebookId !== undefined) {
    setClauses.push(`notebook_id = $${i++}`);
    params.push(updates.notebookId);
  }
  if (updates.color !== undefined) {
    setClauses.push(`color = $${i++}`);
    params.push(updates.color);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(noteId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
  notifyDataChange("local");
}

/**
 * Also soft-deletes the note's pages (enforced FK without ON DELETE CASCADE;
 * see deleteFolder). One execute() call for atomicity.
 */
export async function deleteNote(noteId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `BEGIN;
     UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3;
     UPDATE pages SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE note_id = $3;
     COMMIT;`,
    [now, now, noteId],
  );
  notifyDataChange("local");
}

/**
 * Soft-deleted notes for the History tab, newest deletion first. Notes whose
 * notebook was deleted are left out: restoring them would put them in a
 * notebook nobody can see.
 */
export async function getDeletedNotes(userId: string, sinceMs: number): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE}
     WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at >= $2
       AND (notebook_id IS NULL OR notebook_id IN (SELECT id FROM notebooks WHERE deleted_at IS NULL))
     ORDER BY deleted_at DESC`,
    [userId, sinceMs],
  );
  return rows.map(rowToNote);
}

/**
 * Undoes deleteNote. Pages come back only if they were deleted together with
 * the note (same deleted_at); an earlier-deleted page stays deleted. A note
 * whose folder was deleted too returns to the notebook root.
 */
export async function restoreNote(noteId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `BEGIN;
     UPDATE pages SET deleted_at = NULL, updated_at = $1, dirty = 1
       WHERE note_id = $2 AND deleted_at = (SELECT deleted_at FROM ${TABLE} WHERE id = $2);
     UPDATE ${TABLE} SET deleted_at = NULL, updated_at = $1, dirty = 1,
       folder_id = CASE WHEN folder_id IN (SELECT id FROM folders WHERE deleted_at IS NOT NULL) THEN NULL ELSE folder_id END
       WHERE id = $2;
     COMMIT;`,
    [now, noteId],
  );
  notifyDataChange("local");
}
