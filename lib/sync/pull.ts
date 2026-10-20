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
import { getPageRowById, upsertPageFromRemote, type RemotePageData } from "@/lib/db/pages";
import {
  getStickyNoteRowById,
  upsertStickyNoteFromRemote,
  type RemoteStickyNoteData,
} from "@/lib/db/stickyNotes";
import { recordSyncConflict } from "@/lib/db/syncConflicts";
import type { Folder, Note, Notebook, Page, StickyNote } from "@/types";

// Firestore -> local pull. onSnapshot + docChanges() so each callback only
// handles the incremental diff, upserted into SQLite with an updatedAt
// last-write-wins check.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";
const STICKY_NOTES_COLLECTION = "stickyNotes";

/** Just the sync fields, so decidePull is shared by every table. */
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
 * When the local row is dirty, it's only a conflict if the remote doc also
 * changed since our last sync: remote updatedAt > local syncedAt. updatedAt is
 * client time in milliseconds, so both sides compare on the same clock. A row
 * that was never synced counts as a possible conflict. Conflicts are then
 * decided by updatedAt (last write wins).
 */
function decidePull(local: LocalSyncState | null, remoteUpdatedAt: number): PullDecision {
  if (!local) return "insert";

  if (!local.dirty) {
    return remoteUpdatedAt > local.updatedAt ? "overwrite" : "skip";
  }

  // An equal updatedAt is our own push echoing back through onSnapshot. It can
  // arrive before push marks the row synced, and would otherwise create a bogus
  // conflict backup on every push.
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

function parseJsonField(json: unknown, legacy: unknown): object | null {
  if (typeof json === "string") return JSON.parse(json) as object;
  return (legacy as object | null) ?? null;
}

function toRemoteNoteData(id: string, data: DocumentData): RemoteNoteData {
  return {
    id,
    title: (data.title as string) ?? "Untitled",
    type: (data.type as "note" | "canvas") ?? "note",
    folderId: (data.folderId as string | null) ?? null,
    notebookId: (data.notebookId as string | null) ?? null,
    userId: data.userId as string,
    content: parseJsonField(data.contentJson, data.content),
    canvasData: parseJsonField(data.canvasJson, data.canvasData),
    order: (data.order as number) ?? 0,
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

function toRemotePageData(id: string, data: DocumentData): RemotePageData {
  return {
    id,
    noteId: data.noteId as string,
    title: (data.title as string) ?? "Untitled",
    userId: data.userId as string,
    content: parseJsonField(data.contentJson, data.content),
    canvasData: parseJsonField(data.canvasJson, data.canvasData),
    order: (data.order as number) ?? 0,
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    deletedAt: (data.deletedAt as number | null) ?? null,
  };
}

function toRemoteStickyNoteData(id: string, data: DocumentData): RemoteStickyNoteData {
  return {
    id,
    userId: data.userId as string,
    title: (data.title as string) ?? "Untitled",
    content: parseJsonField(data.contentJson, null),
    topBarColor: (data.topBarColor as string | null) ?? null,
    favorite: (data.favorite as boolean) ?? false,
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    deletedAt: (data.deletedAt as number | null) ?? null,
  };
}

/**
 * "removed" changes are skipped. The doc's old data is still attached, and
 * applying it would resurrect a hard-deleted row. Firestore deletes only come
 * from tombstone cleanup, which every device runs on its own copy of the same
 * old tombstone, so the event isn't needed; and a bare "removed" can't be
 * trusted as a reason to delete local data.
 */
async function applyFolderChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    // See applyFolderChange.
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

/** Same as applyFolderChange, for notes. */
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

/** Same as applyFolderChange, for notebooks. */
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

/** Same as applyFolderChange, for pages. */
async function applyPageChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemotePageData(change.doc.id, data);
  const local = await getPageRowById(remote.id);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<Page, RemotePageData>(decision, "pages", local, remote, (r, dirty, syncedAt) =>
    upsertPageFromRemote(r, dirty, syncedAt),
  );
}

/** Same as applyFolderChange, for sticky notes. */
async function applyStickyNoteChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemoteStickyNoteData(change.doc.id, data);
  const local = await getStickyNoteRowById(remote.id);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<StickyNote, RemoteStickyNoteData>(
    decision,
    "stickyNotes",
    local,
    remote,
    (r, dirty, syncedAt) => upsertStickyNoteFromRemote(r, dirty, syncedAt),
  );
}

/**
 * conflict-local-wins never upserts: the local row already holds the winning
 * content and stays dirty for the next push; only the losing remote copy is
 * backed up. Every other branch leaves the local row matching Firestore.
 */
async function applyDecision<TLocal, TRemote>(
  decision: PullDecision,
  tableName: "folders" | "notes" | "notebooks" | "pages" | "stickyNotes",
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
 * Optional hooks so the engine can derive syncStatus from pull activity.
 * onApplyError (one doc failed; the listener is fine) is separate from
 * onListenError (the listener died; Firestore won't retry, so the caller must
 * resubscribe).
 */
export type PullHooks = {
  /** A snapshot arrived carrying at least one doc change to apply. */
  onActivity?: () => void;
  /**
   * All doc changes in the snapshot finished applying, even if one failed. Only
   * fires for snapshots with changes.
   */
  onIdle?: () => void;
  /** One doc change failed to apply; the listener is still alive. */
  onApplyError?: (err: unknown) => void;
  /** The onSnapshot listener itself died; no more snapshots will arrive on it. */
  onListenError?: (err: unknown) => void;
};

/** Returns the unsubscribe function. */
export function subscribeFolderPull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, FOLDERS_COLLECTION), where("userId", "==", userId));
  // A write from this client arrives twice (the optimistic cache event, then
  // the server ack). Processing snapshots one at a time stops both reading the
  // same stale row and applying the change twice.
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

/** Same as `subscribeFolderPull`, for the `pages` collection. */
export function subscribePagePull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, PAGES_COLLECTION), where("userId", "==", userId));
  let queue: Promise<void> = Promise.resolve();
  return onSnapshot(
    q,
    (snapshot) => {
      const changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      queue = queue
        .then(async () => {
          for (const change of changes) {
            await applyPageChange(change);
          }
        })
        .catch((err) => {
          console.error("[sync/pull] failed to apply page changes", err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error("[sync/pull] pages onSnapshot error", err);
      hooks?.onListenError?.(err);
    },
  );
}

/** Same as `subscribeFolderPull`, for the `stickyNotes` collection. */
export function subscribeStickyNotePull(userId: string, hooks?: PullHooks): Unsubscribe {
  const q = query(collection(db, STICKY_NOTES_COLLECTION), where("userId", "==", userId));
  let queue: Promise<void> = Promise.resolve();
  return onSnapshot(
    q,
    (snapshot) => {
      const changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      queue = queue
        .then(async () => {
          for (const change of changes) {
            await applyStickyNoteChange(change);
          }
        })
        .catch((err) => {
          console.error("[sync/pull] failed to apply sticky note changes", err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error("[sync/pull] stickyNotes onSnapshot error", err);
      hooks?.onListenError?.(err);
    },
  );
}

/** Starts every pull listener and returns one combined unsubscribe. */
export function startPullSync(userId: string, hooks?: PullHooks): Unsubscribe {
  const unsubscribeFolders = subscribeFolderPull(userId, hooks);
  const unsubscribeNotes = subscribeNotePull(userId, hooks);
  const unsubscribeNotebooks = subscribeNotebookPull(userId, hooks);
  const unsubscribePages = subscribePagePull(userId, hooks);
  const unsubscribeStickyNotes = subscribeStickyNotePull(userId, hooks);
  return () => {
    unsubscribeFolders();
    unsubscribeNotes();
    unsubscribeNotebooks();
    unsubscribePages();
    unsubscribeStickyNotes();
  };
}
