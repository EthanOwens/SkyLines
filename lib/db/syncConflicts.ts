import { getDb } from "./client";

// Local data-access for the `sync_conflicts` table (spec.md subtask 12,
// migration version 2 in src-tauri/src/lib.rs). Pull sync
// (lib/sync/pull.ts) writes here whenever it detects that a row was
// touched on both the local (dirty) and remote (Firestore) sides since the
// last sync - the "real conflict" case from SPEC_iter1.md Part 2 "Sync
// engine" - so the losing version isn't silently discarded by the LWW
// overwrite.

const TABLE = "sync_conflicts";

/**
 * Snapshots a losing row version into `sync_conflicts` before pull sync
 * overwrites (or, in the local-wins case, before Firestore's stale copy
 * gets overwritten by a future push). `losingRow` is stored as an opaque
 * JSON blob - this table is a forensic backup, not something queried
 * relationally, so there's no need to normalize it into columns.
 */
export async function recordSyncConflict(
  tableName: "folders" | "notes",
  rowId: string,
  losingRow: unknown,
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE} (id, table_name, row_id, losing_data, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, tableName, rowId, JSON.stringify(losingRow), now],
  );
}

type SyncConflictRow = {
  id: string;
  table_name: string;
  row_id: string;
  losing_data: string;
  created_at: number;
};

export type SyncConflict = {
  id: string;
  tableName: string;
  rowId: string;
  losingData: unknown;
  createdAt: number;
};

/**
 * Reads back the conflict-backup rows for a given table/row id, most recent
 * first. Not required by the pull sync write path itself - added so
 * verification harnesses (and any future conflict-review UI) can inspect
 * what got backed up without reaching for raw SQL.
 */
export async function getSyncConflicts(
  tableName: "folders" | "notes",
  rowId: string,
): Promise<SyncConflict[]> {
  const db = await getDb();
  const rows = await db.select<SyncConflictRow[]>(
    `SELECT * FROM ${TABLE} WHERE table_name = $1 AND row_id = $2 ORDER BY created_at DESC`,
    [tableName, rowId],
  );
  return rows.map((row) => ({
    id: row.id,
    tableName: row.table_name,
    rowId: row.row_id,
    losingData: JSON.parse(row.losing_data) as unknown,
    createdAt: row.created_at,
  }));
}
