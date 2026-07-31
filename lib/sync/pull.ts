import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentChange,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getFolderRowById,
  upsertFolderFromRemote,
  type RemoteFolderData,
} from "@/lib/db/folders";
import { getNoteRowById, upsertNoteFromRemote, type RemoteNoteData } from "@/lib/db/notes";
import {
  getNotebookRowById,
  upsertNotebookFromRemote,
  type RemoteNotebookData,
} from "@/lib/db/notebooks";
import { recordSyncConflict } from "@/lib/db/syncConflicts";
import type { Folder, Note, Notebook } from "@/types";

// Firestore -> local pull (spec.md subtask 12, M3 "sync engine": pull side.
// Push is subtask 11/lib/sync/push.ts, tombstone hard-delete cleanup is
// subtask 13, offline/retry/syncStatus is subtask 14 - none of that is here).
//
// Uses onSnapshot + docChanges() (per SPEC_iter1.md Part 2 "Sync engine")
// so each callback only processes the incremental added/modified/removed
// diff instead of re-diffing the whole collection, then upserts into
// SQLite guarded by an `updatedAt` LWW comparison against the local row.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";

/**
 * Minimal shape pull needs from a local row to decide what to do with an
 * incoming remote change - deliberately just the sync bookkeeping fields,
 * not the full Folder/Note, so `decidePull` (below) is one function shared
 * by both tables instead of two near-duplicates.
 */
type LocalSyncState = {
  updatedAt: number;
  dirty: boolean;
  syncedAt: number | null;
};

type PullDecision =
  /** No local row at all yet - just insert the remote data. */
  | "insert"
  /** Local row exists, isn't dirty, and remote is strictly newer - the
   *  ordinary "remote changed, pull it down" case. */
  | "overwrite"
  /** Local row exists but nothing here needs to change: either it's not
   *  dirty and remote isn't newer (already in sync), or it IS dirty but
   *  remote hasn't moved since our last sync (only the local side changed -
   *  local's pending push should win once push runs). */
  | "skip"
  /** Genuine conflict (both sides touched since last sync) and remote's
   *  `updatedAt` is the later one - remote wins. */
  | "conflict-remote-wins"
  /** Genuine conflict and local's `updatedAt` is the later-or-equal one -
   *  local wins (stays as-is, still dirty, to be pushed later). */
  | "conflict-local-wins";

/**
 * Decides what a pull should do with one remote row given the local row's
 * sync state (or `null` if no local row exists yet).
 *
 * The interesting case is when the local row is dirty: dirty means "edited
 * locally since the last successful push," so the question is whether the
 * remote side ALSO changed since that same last sync - if it didn't, this
 * isn't a conflict at all, just an ordinary pending local edit. We detect
 * that by comparing the remote doc's `updatedAt` against the local row's
 * `syncedAt` (the wall-clock moment lib/sync/push.ts last wrote this row to
 * Firestore). Per SPEC_iter1.md, `updatedAt` is a plain client-generated
 * millisecond timestamp specifically so it's comparable across
 * local/remote on "the same clock" (single-user app, no clock-sync
 * infrastructure) - so `remoteUpdatedAt > local.syncedAt` reliably means
 * "something wrote to this Firestore doc after we last synced it," i.e. a
 * genuine both-sides-touched conflict. `syncedAt === null` (row has never
 * been pushed) is treated the same as "conflict candidate," since we have
 * no baseline to prove the remote row is old news.
 *
 * Once a conflict is confirmed, LWW by `updatedAt` picks the winner, same
 * as every other comparison in this sync engine.
 */
function decidePull(local: LocalSyncState | null, remoteUpdatedAt: number): PullDecision {
  if (!local) return "insert";

  if (!local.dirty) {
    return remoteUpdatedAt > local.updatedAt ? "overwrite" : "skip";
  }

  // A remote `updatedAt` that exactly equals the local dirty row's own
  // `updatedAt` can only be this same local edit echoing back through our
  // own pull listener - lib/sync/push.ts writes the row's own `updatedAt`
  // verbatim to Firestore, and Firestore's onSnapshot delivers that write
  // back to every listener watching the collection, including this one, on
  // the same client. That echo can arrive (as either an optimistic
  // "hasPendingWrites" event or the later server-ack event) BEFORE
  // push.ts's own `markFolderSynced`/`markNoteSynced` call has cleared
  // `dirty`/set `syncedAt` - a real race, not a hypothetical - so without
  // this check, every ordinary push would spuriously look like "local dirty
  // + remote moved" and generate a bogus conflict-backup row. Since
  // `updatedAt` is set once per local edit and never altered in transit,
  // an exact match here is never a genuine third-party conflict - it's
  // always this row's own pending push. Nothing to reconcile: push.ts's own
  // bookkeeping will clear `dirty` once its `setDoc` resolves.
  if (remoteUpdatedAt === local.updatedAt) return "skip";

  const remoteMovedSinceLastSync = local.syncedAt === null || remoteUpdatedAt > local.syncedAt;
  if (!remoteMovedSinceLastSync) return "skip";

  return remoteUpdatedAt > local.updatedAt ? "conflict-remote-wins" : "conflict-local-wins";
}

function toRemoteFolderData(id: string, data: DocumentData): RemoteFolderData {
  return {
    id,
    name: data.name as string,
    parentId: (data.parentId as string | null) ?? null,
    notebookId: (data.notebookId as string | null) ?? null,
    userId: data.userId as string,
    order: (data.order as number) ?? 0,
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    deletedAt: (data.deletedAt as number | null) ?? null,
  };
}

function toRemoteNoteData(id: string, data: DocumentData): RemoteNoteData {
  return {
    id,
    title: (data.title as string) ?? "Untitled",
    type: (data.type as "note" | "canvas") ?? "note",
    folderId: (data.folderId as string | null) ?? null,
    userId: data.userId as string,
    content: (data.content as object | null) ?? null,
    canvasData: (data.canvasData as object | null) ?? null,
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    deletedAt: (data.deletedAt as number | null) ?? null,
  };
}

function toRemoteNotebookData(id: string, data: DocumentData): RemoteNotebookData {
  return {
    id,
    name: data.name as string,
    userId: data.userId as string,
    order: (data.order as number) ?? 0,
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    deletedAt: (data.deletedAt as number | null) ?? null,
  };
}

/**
 * Applies one Firestore `docChanges()` entry for the `folders` collection.
 *
 * "removed" changes only fire here if a `folders` doc was actually deleted
 * from Firestore outright (this app only ever soft-deletes via
 * `deletedAt`, so an outright delete now only comes from
 * lib/sync/cleanup.ts's `cleanupOldTombstones` - spec.md subtask 13 - or
 * manual intervention). `change.doc.data()` is still populated with the
 * doc's last known data for "removed" changes even though the doc is gone,
 * so those are skipped outright rather than treated as a write (see the
 * early return below) - otherwise a hard-deleted Firestore doc would get
 * resurrected locally.
 *
 * Confirmed still correct now that subtask 13 exists and actually triggers
 * real Firestore deletes: `cleanupOldTombstones` only ever hard-deletes a
 * row whose local `deletedAt` is already old, and `deletedAt` is a synced
 * field - so any OTHER device that has pulled this row already has the
 * same old tombstone locally, and that device's own future
 * `cleanupOldTombstones` pass will independently hard-delete its local
 * copy too (its remote `deleteDoc()` call simply becomes a harmless no-op
 * the second time). Hard-delete convergence across devices happens via
 * each device's own periodic cleanup eventually running, not by reacting
 * to "removed" here - reacting here would mean treating "the doc is gone"
 * as a trustworthy signal to hard-delete local data with no LWW
 * protection, and there's no way to distinguish "removed by legitimate
 * tombstone cleanup" from "removed by something else" from a bare
 * `docChanges()` event. So this stays a no-op skip.
 */
async function applyFolderChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    // See the function-level comment above for why this remains a no-op
    // skip even after subtask 13 (lib/sync/cleanup.ts) started performing
    // real Firestore hard-deletes.
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemoteFolderData(change.doc.id, data);
  const local = await getFolderRowById(remote.id);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<Folder, RemoteFolderData>(decision, "folders", local, remote, (r, dirty, syncedAt) =>
    upsertFolderFromRemote(r, dirty, syncedAt),
  );
}

/**
 * Same as `applyFolderChange`, for the `notes` collection - including
 * skipping "removed" changes outright instead of resurrecting them (see the
 * comment above `applyFolderChange`, including the subtask 13 confirmation
 * that this remains correct).
 */
async function applyNoteChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemoteNoteData(change.doc.id, data);
  const local = await getNoteRowById(remote.id);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<Note, RemoteNoteData>(decision, "notes", local, remote, (r, dirty, syncedAt) =>
    upsertNoteFromRemote(r, dirty, syncedAt),
  );
}

/**
 * Same as `applyFolderChange`, for the `notebooks` collection - including
 * skipping "removed" changes outright instead of resurrecting them (see the
 * comment above `applyFolderChange`, including the subtask 13 confirmation
 * that this remains correct).
 */
async function applyNotebookChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemoteNotebookData(change.doc.id, data);
  const local = await getNotebookRowById(remote.id);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<Notebook, RemoteNotebookData>(
    decision,
    "notebooks",
    local,
    remote,
    (r, dirty, syncedAt) => upsertNotebookFromRemote(r, dirty, syncedAt),
  );
}

/**
 * Shared "given a decision, do the actual writes" step for both tables.
 *
 * Why `conflict-local-wins` never calls `upsert`: the local row already
 * holds the winning (newer-or-equal) content, and it's still `dirty` -
 * this pull just leaves it alone so the next push overwrites Firestore
 * with it. The only thing that needs to happen is backing up the losing
 * remote copy so it isn't silently lost. Every other branch results in the
 * local row matching Firestore exactly, so `dirty=false`/`syncedAt=now`.
 */
async function applyDecision<TLocal, TRemote>(
  decision: PullDecision,
  tableName: "folders" | "notes" | "notebooks",
  local: TLocal | null,
  remote: TRemote,
  upsert: (remote: TRemote, dirty: boolean, syncedAt: number | null) => Promise<void>,
): Promise<void> {
  const remoteId = (remote as { id: string }).id;

  switch (decision) {
    case "insert":
    case "overwrite":
      await upsert(remote, false, Date.now());
      return;
    case "skip":
      return;
    case "conflict-remote-wins":
      // Local's unpushed edit loses - snapshot it before it's overwritten.
      await recordSyncConflict(tableName, remoteId, local);
      await upsert(remote, false, Date.now());
      return;
    case "conflict-local-wins":
      // Remote's copy loses - snapshot it. Local row is left untouched
      // (still dirty) so a future push overwrites Firestore with it.
      await recordSyncConflict(tableName, remoteId, remote);
      return;
  }
}

/**
 * Optional observability hooks (spec.md subtask 14, lib/sync/engine.ts)
 * letting a caller derive a real `syncStatus` from pull activity without
 * this file needing to know anything about that state machine itself.
 * Entirely optional/additive - every existing caller that omits `hooks`
 * (e.g. app/spike-pull/page.tsx) behaves exactly as before.
 *
 * `onApplyError` and `onListenError` are deliberately separate: applying one
 * changed doc can fail (`onApplyError`) while the listener itself is still
 * alive and will keep delivering future snapshots just fine (see the
 * per-change `.catch` below, and pull.ts's existing resilience to
 * individual bad changes) - that's not a reason for a caller to resubscribe.
 * The listener itself dying (`onListenError`, onSnapshot's second callback)
 * is different: Firestore does not auto-retry a fatal listen error (e.g.
 * permission-denied), so no more snapshots will ever arrive on this
 * particular listener and a caller that wants to keep receiving updates
 * must call `subscribeFolderPull`/`subscribeNotePull`/`startPullSync` again.
 */
export type PullHooks = {
  /** A snapshot arrived carrying at least one doc change to apply. */
  onActivity?: () => void;
  /** The snapshot's doc changes all finished applying (whether or not one of them individually failed - see `onApplyError`). Only fired for snapshots that had at least one change (mirrors `onActivity`). */
  onIdle?: () => void;
  /** One doc change failed to apply; the listener is still alive. */
  onApplyError?: (err: unknown) => void;
  /** The onSnapshot listener itself died; no more snapshots will arrive on it. */
  onListenError?: (err: unknown) => void;
};

/**
 * Subscribes to every `folders` doc owned by `userId` and pulls
 * added/modified/removed changes into SQLite via the LWW/conflict logic
 * above. Returns the Firestore `Unsubscribe` so callers can tear the
 * listener down (e.g. on sign-out or app teardown).
 */
export function subscribeFolderPull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, FOLDERS_COLLECTION), where("userId", "==", userId));
  // A write from this same client to a doc this listener watches delivers
  // TWO onSnapshot callbacks for it: an optimistic one from the local
  // Firestore cache (hasPendingWrites: true) and a second once the server
  // acknowledges the write - both carrying "modified" docChanges. Without
  // serializing across callbacks (not just within one callback's
  // docChanges() batch), those two deliveries can run concurrently and both
  // read the same not-yet-updated local row, double-applying whatever
  // decision (e.g. writing two conflict-backup rows for one real conflict).
  // `queue` chains every callback's processing onto the previous one so
  // only one snapshot's worth of changes is ever being applied at a time.
  let queue: Promise<void> = Promise.resolve();
  return onSnapshot(
    q,
    (snapshot) => {
      const changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      queue = queue
        .then(async () => {
          for (const change of changes) {
            await applyFolderChange(change);
          }
        })
        .catch((err) => {
          console.error("[sync/pull] failed to apply folder changes", err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error("[sync/pull] folders onSnapshot error", err);
      hooks?.onListenError?.(err);
    },
  );
}

/** Same as `subscribeFolderPull`, for the `notes` collection. */
export function subscribeNotePull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, NOTES_COLLECTION), where("userId", "==", userId));
  let queue: Promise<void> = Promise.resolve();
  return onSnapshot(
    q,
    (snapshot) => {
      const changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      queue = queue
        .then(async () => {
          for (const change of changes) {
            await applyNoteChange(change);
          }
        })
        .catch((err) => {
          console.error("[sync/pull] failed to apply note changes", err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error("[sync/pull] notes onSnapshot error", err);
      hooks?.onListenError?.(err);
    },
  );
}

/** Same as `subscribeFolderPull`, for the `notebooks` collection. */
export function subscribeNotebookPull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, NOTEBOOKS_COLLECTION), where("userId", "==", userId));
  let queue: Promise<void> = Promise.resolve();
  return onSnapshot(
    q,
    (snapshot) => {
      const changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      queue = queue
        .then(async () => {
          for (const change of changes) {
            await applyNotebookChange(change);
          }
        })
        .catch((err) => {
          console.error("[sync/pull] failed to apply notebook changes", err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error("[sync/pull] notebooks onSnapshot error", err);
      hooks?.onListenError?.(err);
    },
  );
}

/**
 * Starts all pull listeners for a user and returns a single combined
 * unsubscribe function. `hooks` (optional) are passed through unchanged to
 * every listener - see `PullHooks` above.
 */
export function startPullSync(userId: string, hooks?: PullHooks): Unsubscribe {
  const unsubscribeFolders = subscribeFolderPull(userId, hooks);
  const unsubscribeNotes = subscribeNotePull(userId, hooks);
  const unsubscribeNotebooks = subscribeNotebookPull(userId, hooks);
  return () => {
    unsubscribeFolders();
    unsubscribeNotes();
    unsubscribeNotebooks();
  };
}
