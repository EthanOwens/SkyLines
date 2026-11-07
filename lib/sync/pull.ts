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
import {
  getUserSettingsRow,
  upsertUserSettingsFromRemote,
  type RemoteUserSettingsData,
} from "@/lib/db/userSettings";
import type { Folder, Note, Notebook, Page, StickyNote, UserSettings } from "@/types";

// Firestore -> local pull. onSnapshot + docChanges() so each callback only
// handles the incremental diff, upserted into SQLite with an updatedAt
// last-write-wins check.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";
const STICKY_NOTES_COLLECTION = "stickyNotes";
const USER_SETTINGS_COLLECTION = "userSettings";

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
    color: (data.color as string | null) ?? null,
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
    color: (data.color as string | null) ?? null,
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

function toRemoteUserSettingsData(userId: string, data: DocumentData): RemoteUserSettingsData {
  return {
    userId,
    autoColor: (data.autoColor as boolean) ?? true,
    colorBookend: (data.colorBookend as boolean) ?? true,
    colorHighlight: (data.colorHighlight as boolean) ?? false,
    updatedAt: data.updatedAt as number,
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
  const local = await getFolderRowById(remote.id, remote.userId);
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
  const local = await getNoteRowById(remote.id, remote.userId);
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
  const local = await getNotebookRowById(remote.id, remote.userId);
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
  const local = await getPageRowById(remote.id, remote.userId);
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
  const local = await getStickyNoteRowById(remote.id, remote.userId);
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

/** Same as applyFolderChange, for the user's settings (doc id = user id). */
async function applyUserSettingsChange(change: DocumentChange<DocumentData>): Promise<void> {
  if (change.type === "removed") {
    return;
  }

  const data = change.doc.data();
  if (!data) return;

  const remote = toRemoteUserSettingsData(change.doc.id, data);
  const local = await getUserSettingsRow(remote.userId);
  const decision = decidePull(
    local && { updatedAt: local.updatedAt, dirty: local.dirty, syncedAt: local.syncedAt },
    remote.updatedAt,
  );

  await applyDecision<UserSettings, RemoteUserSettingsData>(
    decision,
    "userSettings",
    local,
    remote,
    (r, dirty, syncedAt) => upsertUserSettingsFromRemote(r, dirty, syncedAt),
  );
}

/**
 * conflict-local-wins never upserts: the local row already holds the winning
 * content and stays dirty for the next push; only the losing remote copy is
 * backed up. Every other branch leaves the local row matching Firestore.
 */
async function applyDecision<TLocal, TRemote>(
  decision: PullDecision,
  tableName: "folders" | "notes" | "notebooks" | "pages" | "stickyNotes" | "userSettings",
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

type Gate = { promise: Promise<void>; release: () => void };

function createGate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type PendingChange = {
  retry: () => Promise<void>;
  onError: (err: unknown) => void;
  attempts: number;
};

/** Retries per orphaned change; after that it waits for a listener restart. */
const MAX_FK_RETRIES = 5;

/**
 * Per-startPullSync state. Each restart builds a fresh one, which is what
 * resets the gates and the pending list.
 */
type PullContext = {
  notebooksReady: Gate;
  foldersReady: Gate;
  notesReady: Gate;
  pending: PendingChange[];
  retrying: boolean;
  cancelled: boolean;
};

function createPullContext(): PullContext {
  return {
    notebooksReady: createGate(),
    foldersReady: createGate(),
    notesReady: createGate(),
    pending: [],
    retrying: false,
    cancelled: false,
  };
}

function isForeignKeyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("FOREIGN KEY constraint failed");
}

/** Retries deferred changes until a pass makes no progress. */
async function retryPending(ctx: PullContext): Promise<void> {
  if (ctx.retrying || ctx.cancelled) return;
  ctx.retrying = true;
  try {
    let progress = true;
    while (progress && !ctx.cancelled) {
      progress = false;
      for (const entry of [...ctx.pending]) {
        if (entry.attempts >= MAX_FK_RETRIES) continue;
        try {
          await entry.retry();
          ctx.pending.splice(ctx.pending.indexOf(entry), 1);
          progress = true;
        } catch (err) {
          if (isForeignKeyError(err)) {
            entry.attempts += 1;
          } else {
            ctx.pending.splice(ctx.pending.indexOf(entry), 1);
            console.error("[sync/pull] failed to apply deferred change", err);
            entry.onError(err);
          }
        }
      }
    }
  } finally {
    ctx.retrying = false;
  }
}

/** Folders whose parent is in the same snapshot come after that parent. */
function sortFolderChanges(
  changes: DocumentChange<DocumentData>[],
): DocumentChange<DocumentData>[] {
  const parentById = new Map<string, string | null>();
  for (const change of changes) {
    parentById.set(change.doc.id, (change.doc.data()?.parentId as string | null) ?? null);
  }
  const depth = (id: string): number => {
    let d = 0;
    let current = parentById.get(id) ?? null;
    while (current && parentById.has(current) && d <= parentById.size) {
      d += 1;
      current = parentById.get(current) ?? null;
    }
    return d;
  };
  return [...changes].sort((a, b) => depth(a.doc.id) - depth(b.doc.id));
}

type CollectionSubscription = {
  name: string;
  collectionName: string;
  userId: string;
  ctx: PullContext;
  hooks?: PullHooks;
  apply: (change: DocumentChange<DocumentData>) => Promise<void>;
  /** Parent gates that must open before this collection applies anything. */
  waitFor?: Gate[];
  /** Opened once the first snapshot has been applied (or the listener dies). */
  ready?: Gate;
  /** Parent collections: a successful apply may unblock deferred children. */
  unblocksChildren?: boolean;
  orderChanges?: (
    changes: DocumentChange<DocumentData>[],
  ) => DocumentChange<DocumentData>[];
};

function subscribeCollection(opts: CollectionSubscription): Unsubscribe {
  const { name, ctx, hooks, apply, waitFor, ready } = opts;
  const q = query(collection(db, opts.collectionName), where("userId", "==", opts.userId));
  // A write from this client arrives twice (the optimistic cache event, then
  // the server ack). Processing snapshots one at a time stops both reading the
  // same stale row and applying the change twice.
  let queue: Promise<void> = Promise.resolve();
  let first = true;

  return onSnapshot(
    q,
    (snapshot) => {
      const isFirst = first;
      first = false;
      let changes = snapshot.docChanges();
      if (changes.length > 0) hooks?.onActivity?.();
      if (opts.orderChanges) changes = opts.orderChanges(changes);
      queue = queue
        .then(async () => {
          if (waitFor) await Promise.all(waitFor.map((gate) => gate.promise));
          for (const change of changes) {
            if (ctx.cancelled) return;
            try {
              await apply(change);
              if (opts.unblocksChildren && ctx.pending.length > 0) await retryPending(ctx);
            } catch (err) {
              if (isForeignKeyError(err)) {
                ctx.pending.push({
                  retry: () => apply(change),
                  onError: (e) => hooks?.onApplyError?.(e),
                  attempts: 0,
                });
              } else {
                console.error(`[sync/pull] failed to apply ${name} change`, err);
                hooks?.onApplyError?.(err);
              }
            }
          }
          if (ctx.pending.length > 0) await retryPending(ctx);
        })
        .catch((err) => {
          console.error(`[sync/pull] failed to apply ${name} changes`, err);
          hooks?.onApplyError?.(err);
        })
        .finally(() => {
          if (isFirst) ready?.release();
          if (changes.length > 0) hooks?.onIdle?.();
        });
    },
    (err) => {
      console.error(`[sync/pull] ${name} onSnapshot error`, err);
      ready?.release();
      hooks?.onListenError?.(err);
    },
  );
}

/** Returns the unsubscribe function. */
export function subscribeFolderPull(
  userId: string,
  ctx: PullContext,
  hooks?: PullHooks,
): Unsubscribe {
  return subscribeCollection({
    name: "folders",
    collectionName: FOLDERS_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyFolderChange,
    waitFor: [ctx.notebooksReady],
    ready: ctx.foldersReady,
    unblocksChildren: true,
    orderChanges: sortFolderChanges,
  });
}

/** Same as `subscribeFolderPull`, for the `notes` collection. */
export function subscribeNotePull(userId: string, ctx: PullContext, hooks?: PullHooks): Unsubscribe {
  return subscribeCollection({
    name: "notes",
    collectionName: NOTES_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyNoteChange,
    waitFor: [ctx.notebooksReady, ctx.foldersReady],
    ready: ctx.notesReady,
    unblocksChildren: true,
  });
}

/** Same as `subscribeFolderPull`, for the `notebooks` collection. */
export function subscribeNotebookPull(
  userId: string,
  ctx: PullContext,
  hooks?: PullHooks,
): Unsubscribe {
  return subscribeCollection({
    name: "notebooks",
    collectionName: NOTEBOOKS_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyNotebookChange,
    ready: ctx.notebooksReady,
    unblocksChildren: true,
  });
}

/** Same as `subscribeFolderPull`, for the `pages` collection. */
export function subscribePagePull(userId: string, ctx: PullContext, hooks?: PullHooks): Unsubscribe {
  return subscribeCollection({
    name: "pages",
    collectionName: PAGES_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyPageChange,
    waitFor: [ctx.notesReady],
  });
}

/** Same as `subscribeFolderPull`, for the `stickyNotes` collection. */
export function subscribeStickyNotePull(
  userId: string,
  ctx: PullContext,
  hooks?: PullHooks,
): Unsubscribe {
  return subscribeCollection({
    name: "stickyNotes",
    collectionName: STICKY_NOTES_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyStickyNoteChange,
  });
}

/** Same as `subscribeFolderPull`, for the `userSettings` collection. */
export function subscribeUserSettingsPull(
  userId: string,
  ctx: PullContext,
  hooks?: PullHooks,
): Unsubscribe {
  return subscribeCollection({
    name: "userSettings",
    collectionName: USER_SETTINGS_COLLECTION,
    userId,
    ctx,
    hooks,
    apply: applyUserSettingsChange,
  });
}

/** Starts every pull listener and returns one combined unsubscribe. */
export function startPullSync(userId: string, hooks?: PullHooks): Unsubscribe {
  const ctx = createPullContext();
  const unsubscribeFolders = subscribeFolderPull(userId, ctx, hooks);
  const unsubscribeNotes = subscribeNotePull(userId, ctx, hooks);
  const unsubscribeNotebooks = subscribeNotebookPull(userId, ctx, hooks);
  const unsubscribePages = subscribePagePull(userId, ctx, hooks);
  const unsubscribeStickyNotes = subscribeStickyNotePull(userId, ctx, hooks);
  const unsubscribeUserSettings = subscribeUserSettingsPull(userId, ctx, hooks);
  return () => {
    ctx.cancelled = true;
    ctx.pending.length = 0;
    ctx.notebooksReady.release();
    ctx.foldersReady.release();
    ctx.notesReady.release();
    unsubscribeFolders();
    unsubscribeNotes();
    unsubscribeNotebooks();
    unsubscribePages();
    unsubscribeStickyNotes();
    unsubscribeUserSettings();
  };
}
