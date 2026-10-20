import { getDb } from "./client";

// Backup of the losing version when pull sync finds a row changed on both sides
// since the last sync, so last-write-wins doesn't silently discard it.

const TABLE = "sync_conflicts";

/** Stored as an opaque JSON blob: it's a backup, not queried by column. */
export async function recordSyncConflict(
  tableName: "folders" | "notes" | "notebooks" | "pages" | "stickyNotes",
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

/** Not used by sync itself; for inspection and verification pages. */
export async function getSyncConflicts(
  tableName: "folders" | "notes" | "notebooks" | "pages" | "stickyNotes",
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
