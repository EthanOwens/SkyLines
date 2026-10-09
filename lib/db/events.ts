// Change notifications for SQLite writes, which have no realtime feed of their
// own. Every write is tagged: "local" for user edits that still need pushing,
// "remote" for rows that already match Firestore (pulled rows, tombstone
// cleanup).
//
// No imports on purpose: lib/sync imports lib/db, so lib/db can't call the sync
// engine without a cycle. useSyncEngine reads the tag and schedules the push
// instead.

export type DataChangeOrigin = "local" | "remote";

type DataChangeListener = (origin: DataChangeOrigin) => void;

const listeners = new Set<DataChangeListener>();

/** Subscribes to folders/notes table writes. Returns an unsubscribe function. */
export function subscribeDataChange(listener: DataChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notifies every subscriber that the `folders` or `notes` table was written to. */
export function notifyDataChange(origin: DataChangeOrigin): void {
  for (const listener of listeners) listener(origin);
}
