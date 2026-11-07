import type { UserSettings } from "@/types";
import { getDb } from "./client";
import { notifyDataChange } from "./events";

// One row per user. No row means defaults, so nothing is written until the
// user changes a setting or a remote row is pulled.

const TABLE = "user_settings";

type UserSettingsRow = {
  user_id: string;
  auto_color: number;
  color_bookend: number;
  color_highlight: number;
  updated_at: number | null;
  dirty: number;
  synced_at: number | null;
};

export type UserSettingsValues = Pick<UserSettings, "autoColor" | "colorBookend" | "colorHighlight">;

export const DEFAULT_USER_SETTINGS: UserSettingsValues = {
  autoColor: true,
  colorBookend: true,
  colorHighlight: false,
};

export function defaultUserSettings(userId: string): UserSettings {
  return { userId, ...DEFAULT_USER_SETTINGS, updatedAt: 0, dirty: false, syncedAt: null };
}

function rowToUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    autoColor: row.auto_color === 1,
    colorBookend: row.color_bookend === 1,
    colorHighlight: row.color_highlight === 1,
    updatedAt: row.updated_at ?? 0,
    dirty: row.dirty === 1,
    syncedAt: row.synced_at,
  };
}

/** Null when the user has no row yet; the pull path needs to tell that apart from defaults. */
export async function getUserSettingsRow(userId: string): Promise<UserSettings | null> {
  const db = await getDb();
  const rows = await db.select<UserSettingsRow[]>(`SELECT * FROM ${TABLE} WHERE user_id = $1`, [userId]);
  return rows.length > 0 ? rowToUserSettings(rows[0]) : null;
}

/** Defaults when the user has no row. */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  return (await getUserSettingsRow(userId)) ?? defaultUserSettings(userId);
}

export async function updateUserSettings(
  userId: string,
  partial: Partial<UserSettingsValues>,
): Promise<void> {
  const db = await getDb();
  const current = await getUserSettings(userId);
  const next = { ...current, ...partial };
  const now = Date.now();

  await db.execute(
    `INSERT INTO ${TABLE}
       (user_id, auto_color, color_bookend, color_highlight, updated_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, 1, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       auto_color = excluded.auto_color,
       color_bookend = excluded.color_bookend,
       color_highlight = excluded.color_highlight,
       updated_at = excluded.updated_at,
       dirty = 1`,
    [userId, next.autoColor ? 1 : 0, next.colorBookend ? 1 : 0, next.colorHighlight ? 1 : 0, now],
  );
  notifyDataChange("local");
}

export async function getDirtyUserSettings(userId: string): Promise<UserSettings[]> {
  const db = await getDb();
  const rows = await db.select<UserSettingsRow[]>(
    `SELECT * FROM ${TABLE} WHERE user_id = $1 AND dirty = 1`,
    [userId],
  );
  return rows.map(rowToUserSettings);
}

/** Uses the same timestamp as the Firestore write. */
export async function markUserSettingsSynced(userId: string, syncedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE ${TABLE} SET dirty = 0, synced_at = $1 WHERE user_id = $2`, [
    syncedAt,
    userId,
  ]);
}

export type RemoteUserSettingsData = UserSettingsValues & {
  userId: string;
  updatedAt: number;
};

/** See upsertFolderFromRemote. */
export async function upsertUserSettingsFromRemote(
  remote: RemoteUserSettingsData,
  dirty: boolean,
  syncedAt: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ${TABLE}
       (user_id, auto_color, color_bookend, color_highlight, updated_at, dirty, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(user_id) DO UPDATE SET
       auto_color = excluded.auto_color,
       color_bookend = excluded.color_bookend,
       color_highlight = excluded.color_highlight,
       updated_at = excluded.updated_at,
       dirty = excluded.dirty,
       synced_at = excluded.synced_at`,
    [
      remote.userId,
      remote.autoColor ? 1 : 0,
      remote.colorBookend ? 1 : 0,
      remote.colorHighlight ? 1 : 0,
      remote.updatedAt,
      dirty ? 1 : 0,
      syncedAt,
    ],
  );
  notifyDataChange("remote");
}
