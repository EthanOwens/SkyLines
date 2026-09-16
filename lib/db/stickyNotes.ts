import type { StickyNote } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// Local SQLite data-access layer for `sticky_notes` (spec.md subtask 7),
// mirroring lib/db/pages.ts's/lib/db/notes.ts's exact function-naming/shape
// conventions. Unlike `pages` (scoped by `noteId`, a page always belongs to
// exactly one note) sticky notes are their own top-level entity - they are
// NOT scoped to a note/page, so `getStickyNotes` lists by `userId` directly,
// the same way `getNotes` in lib/db/notes.ts does.

const TABLE = "sticky_notes";

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

/**
 * Fetches every sticky note for a user with `dirty = 1`, including
 * soft-deleted ones (deletedAt tombstones must be pushed too - see
 * `getDirtyNotes` in lib/db/notes.ts). Used by lib/sync/push.ts to find
 * rows that need to go to Firestore.
 */
export async function getDirtyStickyNotes(userId: string): Promise<StickyNote[]> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToStickyNote);
}

/**
 * Marks a sticky note as successfully synced: clears `dirty` and stamps
 * `syncedAt` with the same client timestamp used for the Firestore write, so
 * local and remote agree on when the push happened.
 */
export async function markStickyNoteSynced(id: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE id = $2`,
    [syncedAt, id],
  );
}

/**
 * Fetches every soft-deleted sticky note for a user whose `deletedAt` is
 * older than `cutoffMs` (a Unix-ms timestamp, i.e. `Date.now() - maxAgeMs`
 * in lib/sync/cleanup.ts). These are tombstones old enough to be
 * hard-deleted by the periodic cleanup pass - see `getOldTombstoneNotes` in
 * lib/db/notes.ts for why non-dirty AND dirty rows are both included.
 */
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

/**
 * Genuinely `DELETE FROM`s a sticky note row - unlike every other write in
 * this file, this does not soft-delete. Only meant to be called by the
 * periodic tombstone cleanup pass (lib/sync/cleanup.ts) on rows that are
 * already tombstones old enough to purge.
 */
export async function hardDeleteStickyNote(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  notifyDataChange("remote");
}

/**
 * Single-row getter by id, mirroring `getNoteById` in lib/db/notes.ts - a
 * later subtask needs this to open a specific sticky note by id in its own
 * pop-out window.
 */
export async function getStickyNoteById(id: string): Promise<StickyNote | null> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(
    `SELECT * FROM ${TABLE} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.length > 0 ? rowToStickyNote(rows[0]) : null;
}

/**
 * Same as `getStickyNoteById`, but does NOT filter out soft-deleted rows.
 * Pull sync (lib/sync/pull.ts) needs to find the local row for LWW
 * comparison even when it's a tombstone - `getStickyNoteById` would silently
 * report "no local row" and cause an incorrect re-insert. Mirrors
 * `getNoteRowById` in lib/db/notes.ts.
 */
export async function getStickyNoteRowById(id: string): Promise<StickyNote | null> {
  const db = await getDb();
  const rows = await db.select<StickyNoteRow[]>(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
  return rows.length > 0 ? rowToStickyNote(rows[0]) : null;
}

/**
 * Shape of a `sticky_notes` Firestore document as written by
 * lib/sync/push.ts's (future) `stickyNoteToFirestoreDoc`, plus the
 * Firestore doc id (same as local `id`). `content` is a plain object here
 * (as stored in Firestore), not a JSON string - `upsertStickyNoteFromRemote`
 * below stringifies it the same way `updateStickyNote` does before writing
 * to the local `TEXT` column.
 */
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

/**
 * Inserts a new local sticky note row from remote (Firestore) data, or
 * overwrites an existing one, via `INSERT ... ON CONFLICT(id) DO UPDATE`.
 * This is the write primitive pull sync (lib/sync/pull.ts) uses once it has
 * already decided - via LWW/conflict comparison - that the remote data
 * should land locally; this function does not itself make that decision.
 * See `upsertNoteFromRemote` in lib/db/notes.ts for the full reasoning on
 * why `dirty`/`syncedAt` are caller-supplied rather than hardcoded.
 */
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

/** Creates a new sticky note row for `userId`. Used by a future "new sticky note" UI action. */
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

  await db.execute(
    `UPDATE ${TABLE} SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params,
  );
  notifyDataChange("local");
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
}
