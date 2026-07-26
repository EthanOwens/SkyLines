import type { Note } from "@/types";
import { getDb } from "./client";

// Local SQLite data-access layer for `notes` (spec.md subtask 9), mirroring
// the function names/shapes of the current Firestore-backed
// `../note_taking_app/lib/firestore/notes.ts` so subtask 15 can rewire
// stores/appStore.ts and hooks/useNotes.ts against this with minimal
// changes. Unlike Firestore's onSnapshot, SQLite reads here are plain
// one-shot async queries - there's no realtime listener model to fake
// locally (subtask 15's job is wiring re-fetches, not this subtask's).

const TABLE = "notes";

type NoteRow = {
  id: string;
  title: string;
  type: "note" | "canvas";
  folder_id: string | null;
  user_id: string;
  content: string | null;
  canvas_data: string | null;
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
    userId: row.user_id,
    content: row.content !== null ? (JSON.parse(row.content) as object | null) : null,
    canvasData:
      row.canvas_data !== null ? (JSON.parse(row.canvas_data) as object | null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Fetches the current (non-deleted) notes for a user, ordered the same way
 * the Firestore `subscribeNotes` query was (`updatedAt` descending). This
 * replaces that subscription with a plain one-shot read - callers re-invoke
 * it after mutations rather than receiving push updates.
 */
export async function getNotes(userId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(rowToNote);
}

export async function getNoteById(noteId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [noteId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function createNote(
  userId: string,
  type: "note" | "canvas",
  folderId: string | null = null,
  title = "Untitled",
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, title, type, folder_id, user_id, content, canvas_data, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, NULL, 1, NULL)`,
    [id, title, type, folderId, userId, now, now],
  );

  return id;
}

export async function updateNote(
  noteId: string,
  updates: Partial<Pick<Note, "title" | "content" | "canvasData" | "folderId">>,
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

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(noteId);

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
}

/**
 * Soft-deletes a single note: sets `deletedAt`/`dirty`, does not `DELETE
 * FROM` the row.
 */
export async function deleteNote(noteId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3`,
    [now, now, noteId],
  );
}
