import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getDirtyFolders, markFolderSynced } from "@/lib/db/folders";
import { getDirtyNotes, markNoteSynced } from "@/lib/db/notes";
import type { Folder, Note } from "@/types";

// Local -> Firestore push (spec.md subtask 11, M3 "sync engine": push side
// only - pull/onSnapshot is subtask 12, tombstone cleanup is subtask 13,
// offline/retry/syncStatus is subtask 14).
//
// Document shape matches the reference app's Firestore documents
// (../note_taking_app/lib/firestore/notes.ts / folders.ts) field-for-field,
// so both apps stay data-compatible against the same collections - with one
// deliberate change per SPEC_iter1.md Part 2 "Sync engine": `updatedAt` is
// written as a plain client-generated millisecond number instead of
// `serverTimestamp()`, because LWW conflict resolution compares local and
// remote `updatedAt` values directly and needs them on the same clock.
// `deletedAt` (also a plain number, or null) is included so pull-side sync
// can later detect soft-deletes as tombstones without diffing whole
// collections.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";

function folderToFirestoreDoc(folder: Folder, updatedAt: number) {
  return {
    name: folder.name,
    parentId: folder.parentId,
    notebookId: folder.notebookId,
    userId: folder.userId,
    order: folder.order,
    createdAt: folder.createdAt,
    updatedAt,
    deletedAt: folder.deletedAt,
  };
}

function noteToFirestoreDoc(note: Note, updatedAt: number) {
  return {
    title: note.title,
    type: note.type,
    folderId: note.folderId,
    userId: note.userId,
    content: note.content ?? null,
    canvasData: note.canvasData ?? null,
    createdAt: note.createdAt,
    updatedAt,
    deletedAt: note.deletedAt,
  };
}

/**
 * Pushes every dirty local folder for `userId` to Firestore, writing each
 * row's own `updatedAt` (its actual last-edit time, set locally by
 * createFolder/updateFolder) as the Firestore document's `updatedAt` -
 * NOT a fresh push-time timestamp, since a future pull-sync's
 * last-write-wins comparison needs `updatedAt` to reflect when the edit
 * actually happened, not when it happened to get pushed. `syncedAt` is
 * separate, purely local bookkeeping about when this push occurred, and
 * uses its own `Date.now()` per row.
 */
export async function pushDirtyFolders(userId: string): Promise<void> {
  const dirtyFolders = await getDirtyFolders(userId);

  for (const folder of dirtyFolders) {
    await setDoc(
      doc(db, FOLDERS_COLLECTION, folder.id),
      folderToFirestoreDoc(folder, folder.updatedAt),
      { merge: true },
    );
    await markFolderSynced(folder.id, Date.now());
  }
}

/**
 * Pushes every dirty local note for `userId` to Firestore, writing each
 * row's own `updatedAt` (its actual last-edit time, set locally by
 * createNote/updateNote) as the Firestore document's `updatedAt` - NOT a
 * fresh push-time timestamp, since a future pull-sync's last-write-wins
 * comparison needs `updatedAt` to reflect when the edit actually happened,
 * not when it happened to get pushed. `syncedAt` is separate, purely local
 * bookkeeping about when this push occurred, and uses its own `Date.now()`
 * per row.
 */
export async function pushDirtyNotes(userId: string): Promise<void> {
  const dirtyNotes = await getDirtyNotes(userId);

  for (const note of dirtyNotes) {
    await setDoc(
      doc(db, NOTES_COLLECTION, note.id),
      noteToFirestoreDoc(note, note.updatedAt),
      { merge: true },
    );
    await markNoteSynced(note.id, Date.now());
  }
}

/**
 * Runs one push pass for a user: all dirty folders, then all dirty notes.
 * No polling/scheduling/debouncing here - that's spec.md subtask 14.
 */
export async function pushDirtyRows(userId: string): Promise<void> {
  await pushDirtyFolders(userId);
  await pushDirtyNotes(userId);
}
