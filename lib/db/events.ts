// Local data-change notification (spec.md subtask 15, M4 "auth + data hooks
// rewire"). Firestore's `onSnapshot` gave the old app a push mechanism for
// "the data changed, re-render" - plain SQLite reads (lib/db/folders.ts,
// lib/db/notes.ts) have no equivalent, so this module is a tiny,
// dependency-free pub/sub the UI layer (hooks/useFolders.ts,
// hooks/useNotes.ts) can subscribe to instead, mirroring the shape of
// lib/sync/engine.ts's `subscribeSyncStatus`/`setStatus` pattern (a
// module-level `Set` of listeners + a notify function).
//
// Every write path in lib/db/folders.ts/notes.ts calls `notifyDataChange`
// after a successful write, tagged with where the change came from:
//
//   - `"local"`  - a genuine local user edit (createFolder/updateFolder/
//     deleteFolder, and the equivalent note functions). This is dirty data
//     that still needs to be pushed to Firestore.
//   - `"remote"` - data that ALREADY matches Firestore and needs no further
//     push: either it just arrived FROM Firestore via pull sync
//     (upsertFolderFromRemote/upsertNoteFromRemote), or it's a tombstone
//     hard-delete (hardDeleteFolder/hardDeleteNote) run by the periodic
//     cleanup pass once both sides already agree the row is gone.
//
// This module deliberately has ZERO imports of its own (not even
// lib/sync/engine.ts) so that lib/db/folders.ts and lib/db/notes.ts can
// import it without creating a circular import: lib/sync/engine.ts already
// imports lib/sync/push.ts/pull.ts, which import lib/db/folders.ts/notes.ts.
// If lib/db/*.ts imported lib/sync/engine.ts directly (e.g. to call
// `scheduleDirtyPush` itself), that cycle would be real. Instead, the
// `origin` tag carried by this event is what lets a higher layer -
// hooks/useSyncEngine.ts, which already imports both this module and
// lib/sync/engine.ts with no cycle - decide whether a given change should
// also schedule a push, without lib/db/*.ts ever needing to know
// lib/sync/engine.ts exists.

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
