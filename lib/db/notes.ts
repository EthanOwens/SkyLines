import type { Note } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

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
  notebook_id: string | null;
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

/**
 * Fetches every note for a user with `dirty = 1`, including soft-deleted
 * ones (deletedAt tombstones must be pushed too - see spec.md subtask 11).
 * Used by lib/sync/push.ts to find rows that need to go to Firestore.
 */
export async function getDirtyNotes(userId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToNote);
}

/**
 * Marks a note as successfully synced: clears `dirty` and stamps `syncedAt`
 * with the same client timestamp used for the Firestore write, so local and
 * remote agree on when the push happened.
 */
export async function markNoteSynced(noteId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, noteId],
  );
}

/**
 * Fetches every soft-deleted note for a user whose `deletedAt` is older
 * than `cutoffMs` (a Unix-ms timestamp, i.e. `Date.now() - maxAgeMs` in
 * lib/sync/cleanup.ts). These are tombstones old enough to be hard-deleted
 * by the periodic cleanup pass (spec.md subtask 13) - see
 * `getOldTombstoneFolders` in lib/db/folders.ts for why non-dirty AND dirty
 * rows are both included.
 */
export async function getOldTombstoneNotes(userId: string, cutoffMs: number): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToNote);
}

/**
 * Genuinely `DELETE FROM`s a note row - unlike every other write in this
 * file, this does not soft-delete. Only meant to be called by the periodic
 * tombstone cleanup pass (lib/sync/cleanup.ts, spec.md subtask 13) on rows
 * that are already tombstones old enough to purge.
 */
export async function hardDeleteNote(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [noteId]);
  notifyDataChange("remote");
}

export async function getNoteById(noteId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [noteId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

/**
 * Same as `getNoteById`, but does NOT filter out soft-deleted rows. Pull
 * sync (lib/sync/pull.ts, spec.md subtask 12) needs to find the local row
 * for LWW comparison even when it's a tombstone - `getNoteById` would
 * silently report "no local row" and cause an incorrect re-insert.
 */
export async function getNoteRowById(noteId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [noteId]);
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

/**
 * Shape of a `notes` Firestore document as written by lib/sync/push.ts's
 * `noteToFirestoreDoc`, plus the Firestore doc id (same as local `id`).
 * `content`/`canvasData` are plain objects here (as stored in Firestore),
 * not JSON strings - `upsertNoteFromRemote` below stringifies them the same
 * way `updateNote` does before writing to the local `TEXT` columns.
 */
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
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/**
 * Inserts a new local note row from remote (Firestore) data, or overwrites
 * an existing one, via `INSERT ... ON CONFLICT(id) DO UPDATE`. This is the
 * write primitive pull sync (lib/sync/pull.ts) uses once it has already
 * decided - via LWW/conflict comparison - that the remote data should land
 * locally; this function does not itself make that decision. See
 * `upsertFolderFromRemote` in lib/db/folders.ts for the full reasoning on
 * why `dirty`/`syncedAt` are caller-supplied rather than hardcoded.
 */
export async function upsertNoteFromRemote(
  remote: RemoteNoteData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, title, type, folder_id, notebook_id, user_id, content, canvas_data, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       folder_id = excluded.folder_id,
       notebook_id = excluded.notebook_id,
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
      remote.title,
      remote.type,
      remote.folderId,
      remote.notebookId,
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
 * `notebookId` is a required parameter - every new note must belong to a
 * notebook now (spec.md subtask 7), mirroring `createFolder`'s
 * `notebookId` requirement in lib/db/folders.ts. The `notes.notebook_id`
 * column itself stays nullable at the SQLite schema level (see the
 * migration 4 comment in src-tauri/src/lib.rs for why), so this requirement
 * is enforced here at the application layer instead, by simply not offering
 * a way to omit it.
 */
export async function createNote(
  userId: string,
  type: "note" | "canvas",
  notebookId: string,
  folderId: string | null = null,
  title = "Untitled",
  order = 0,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, title, type, folder_id, notebook_id, user_id, content, canvas_data, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, NULL, 1, NULL)`,
    [id, title, type, folderId, notebookId, userId, order, now, now],
  );

  notifyDataChange("local");
  return id;
}

export async function updateNote(
  noteId: string,
  updates: Partial<Pick<Note, "title" | "content" | "canvasData" | "folderId" | "order">>,
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
  notifyDataChange("local");
}
