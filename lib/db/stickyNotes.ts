import type { StickyNote } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// Sticky notes aren't scoped to a note, so they're listed by user.

const TABLE = "sticky_notes";

export const STICKY_NOTE_CHANGED_EVENT = "sticky-note:changed";

// notifyDataChange stays inside one window; this tells the others (the main
// window's sticky notes home) that a sticky note changed.
async function emitStickyNoteChanged(id: string): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(STICKY_NOTE_CHANGED_EVENT, { id });
  } catch {
    // Best-effort: the write already succeeded.
  }
}

type StickyNoteRow = {
  id: string;
  user_id: string;
  title: string;
  content: string | null;
  top_bar_color: string | null;
  pinned: number;
  favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  dirty: number;
  synced_at: number | null;
};

function rowToStickyNote(row: StickyNoteRow): StickyNote {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content !== null ? (JSON.parse(row.content) as object | null) : null,
    topBarColor: row.top_bar_color,
    pinned: row.pinned === 1,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Fetches the current (non-deleted) sticky notes for a user, ordered the
 * same way `getNotes` orders notes (`updatedAt` descending) - see that
 * function in lib/db/notes.ts for the reasoning.
 */
export async function getStickyNotes(userId: string): Promise<StickyNote[]> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(rowToStickyNote);
}

/** Includes soft-deleted rows, since tombstones must be pushed too. */
export async function getDirtyStickyNotes(userId: string): Promise<StickyNote[]> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToStickyNote);
}

/** Uses the same timestamp as the Firestore write. */
export async function markStickyNoteSynced(id: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, id],
  );
}

/** Old tombstones, dirty or not; see getOldTombstoneFolders. */
export async function getOldTombstoneStickyNotes(
  userId: string,
  cutoffMs: number,
): Promise<StickyNote[]> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2`,
    [userId, cutoffMs],
  );
  return rows.map(rowToStickyNote);
}

/** A real DELETE, for tombstone cleanup only. */
export async function hardDeleteStickyNote(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  notifyDataChange("remote");
}

export async function getStickyNoteById(id: string): Promise<StickyNote | null> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.length > 0 ? rowToStickyNote(rows[0]) : null;
}

/** Includes soft-deleted rows; see getNoteRowById. */
export async function getStickyNoteRowById(id: string): Promise<StickyNote | null> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows.length > 0 ? rowToStickyNote(rows[0]) : null;
}

/** content is an object here and stringified on write. */
export type RemoteStickyNoteData = {
  id: string;
  userId: string;
  title: string;
  content: object | null;
  topBarColor: string | null;
  pinned: boolean;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** See upsertFolderFromRemote. */
export async function upsertStickyNoteFromRemote(
  remote: RemoteStickyNoteData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, user_id, title, content, top_bar_color, pinned, favorite, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       title = excluded.title,
       content = excluded.content,
       top_bar_color = excluded.top_bar_color,
       pinned = excluded.pinned,
       favorite = excluded.favorite,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       dirty = excluded.dirty,
       synced_at = excluded.synced_at`,
    [
      remote.id,
      remote.userId,
      remote.title,
      remote.content === null ? null : JSON.stringify(remote.content),
      remote.topBarColor,
      remote.pinned ? 1 : 0,
      remote.favorite ? 1 : 0,
      remote.createdAt,
      remote.updatedAt,
      remote.deletedAt,
      dirty ? 1 : 0,
      syncedAt,
    ],
  );
  notifyDataChange("remote");
}

export async function createStickyNote(
  userId: string,
  title = "Untitled",
  content: object | null = null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (id, user_id, title, content, top_bar_color, pinned, favorite, created_at, updated_at, deleted_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, NULL, 0, 0, $5, $5, NULL, 1, NULL)`,
    [id, userId, title, content === null ? null : JSON.stringify(content), now],
  );

  notifyDataChange("local");
  void emitStickyNoteChanged(id);
  return id;
}

export async function updateStickyNote(
  id: string,
  updates: Partial<Pick<StickyNote, "title" | "content" | "topBarColor" | "pinned" | "favorite">>,
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
  if (updates.topBarColor !== undefined) {
    setClauses.push(`top_bar_color = $${i++}`);
    params.push(updates.topBarColor);
  }
  if (updates.pinned !== undefined) {
    setClauses.push(`pinned = $${i++}`);
    params.push(updates.pinned ? 1 : 0);
  }
  if (updates.favorite !== undefined) {
    setClauses.push(`favorite = $${i++}`);
    params.push(updates.favorite ? 1 : 0);
  }

  setClauses.push(`updated_at = $${i++}`);
  params.push(now);
  setClauses.push(`dirty = 1`);

  params.push(id);

  // A sticky window's debounced save can land after the note was deleted
  // elsewhere; it must not write to the tombstone.
  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i} AND deleted_at IS NULL`,
    params,
  );
  notifyDataChange("local");
  void emitStickyNoteChanged(id);
}

/**
 * Soft-deletes a single sticky note: sets `deletedAt`/`dirty`, does not
 * `DELETE FROM` the row - matches `deletePage`'s exact soft-delete pattern
 * in lib/db/pages.ts.
 */
export async function deleteStickyNote(id: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await db.execute(
    `UPDATE ${TABLE} SET deleted_at = $1, updated_at = $2, dirty = 1 WHERE id = $3`,
    [now, now, id],
  );
  notifyDataChange("local");
  void emitStickyNoteChanged(id);
}
