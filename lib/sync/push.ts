import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getDirtyFolders, markFolderSynced } from "@/lib/db/folders";
import { getDirtyNotes, markNoteSynced } from "@/lib/db/notes";
import { getDirtyNotebooks, markNotebookSynced } from "@/lib/db/notebooks";
import { getDirtyPages, markPageSynced } from "@/lib/db/pages";
import type { Folder, Note, Notebook, Page } from "@/types";

// Local -> Firestore push. Documents keep the reference app's field shape.
// updatedAt is the client's edit time in milliseconds (not serverTimestamp()),
// so last-write-wins compares local and remote on the same clock. deletedAt is
// included so pull can detect tombstones.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";

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

function notebookToFirestoreDoc(notebook: Notebook, updatedAt: number) {
  return {
    name: notebook.name,
    userId: notebook.userId,
    order: notebook.order,
    createdAt: notebook.createdAt,
    updatedAt,
    deletedAt: notebook.deletedAt,
  };
}

function noteToFirestoreDoc(note: Note, updatedAt: number) {
  return {
    title: note.title,
    type: note.type,
    folderId: note.folderId,
    notebookId: note.notebookId,
    userId: note.userId,
    content: note.content ?? null,
    canvasData: note.canvasData ?? null,
    order: note.order,
    createdAt: note.createdAt,
    updatedAt,
    deletedAt: note.deletedAt,
  };
}

function pageToFirestoreDoc(page: Page, updatedAt: number) {
  return {
    noteId: page.noteId,
    title: page.title,
    userId: page.userId,
    content: page.content ?? null,
    canvasData: page.canvasData ?? null,
    order: page.order,
    createdAt: page.createdAt,
    updatedAt,
    deletedAt: page.deletedAt,
  };
}

/**
 * Writes each row's own updatedAt (when the edit happened, which
 * last-write-wins needs), not the push time. syncedAt is local bookkeeping of
 * the push.
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

/** Same updatedAt rule as pushDirtyFolders. */
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

/** Same updatedAt rule as pushDirtyFolders. */
export async function pushDirtyNotebooks(userId: string): Promise<void> {
  const dirtyNotebooks = await getDirtyNotebooks(userId);

  for (const notebook of dirtyNotebooks) {
    await setDoc(
      doc(db, NOTEBOOKS_COLLECTION, notebook.id),
      notebookToFirestoreDoc(notebook, notebook.updatedAt),
      { merge: true },
    );
    await markNotebookSynced(notebook.id, Date.now());
  }
}

/** Same updatedAt rule as pushDirtyFolders. */
export async function pushDirtyPages(userId: string): Promise<void> {
  const dirtyPages = await getDirtyPages(userId);

  for (const page of dirtyPages) {
    await setDoc(
      doc(db, PAGES_COLLECTION, page.id),
      pageToFirestoreDoc(page, page.updatedAt),
      { merge: true },
    );
    await markPageSynced(page.id, Date.now());
  }
}

/** One push pass; scheduling and debouncing live in lib/sync/engine.ts. */
export async function pushDirtyRows(userId: string): Promise<void> {
  await pushDirtyFolders(userId);
  await pushDirtyNotes(userId);
  await pushDirtyNotebooks(userId);
  await pushDirtyPages(userId);
}
