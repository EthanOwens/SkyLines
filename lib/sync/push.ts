import { deleteField, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getDirtyFolders, markFolderSynced } from "@/lib/db/folders";
import { getDirtyNotes, markNoteSynced } from "@/lib/db/notes";
import { getDirtyNotebooks, markNotebookSynced } from "@/lib/db/notebooks";
import { getDirtyPages, markPageSynced } from "@/lib/db/pages";
import { getDirtyStickyNotes, markStickyNoteSynced } from "@/lib/db/stickyNotes";
import {
  getDirtyUserSettings,
  markUserSettingsSynced,
} from "@/lib/db/userSettings";
import type { Folder, Note, Notebook, Page, StickyNote, SyncFailure, UserSettings } from "@/types";

// Local -> Firestore push. Documents keep the reference app's field shape.
// updatedAt is the client's edit time in milliseconds (not serverTimestamp()),
// so last-write-wins compares local and remote on the same clock. deletedAt is
// included so pull can detect tombstones.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";
const STICKY_NOTES_COLLECTION = "stickyNotes";
const USER_SETTINGS_COLLECTION = "userSettings";

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
    contentJson: note.content ? JSON.stringify(note.content) : null,
    content: deleteField(),
    canvasJson: note.canvasData ? JSON.stringify(note.canvasData) : null,
    canvasData: deleteField(),
    order: note.order,
    color: note.color,
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
    contentJson: page.content ? JSON.stringify(page.content) : null,
    content: deleteField(),
    canvasJson: page.canvasData ? JSON.stringify(page.canvasData) : null,
    canvasData: deleteField(),
    order: page.order,
    color: page.color,
    createdAt: page.createdAt,
    updatedAt,
    deletedAt: page.deletedAt,
  };
}

// pinned is deliberately absent: it stays per computer.
function stickyNoteToFirestoreDoc(sticky: StickyNote, updatedAt: number) {
  return {
    userId: sticky.userId,
    title: sticky.title,
    contentJson: sticky.content ? JSON.stringify(sticky.content) : null,
    topBarColor: sticky.topBarColor,
    favorite: sticky.favorite,
    createdAt: sticky.createdAt,
    updatedAt,
    deletedAt: sticky.deletedAt,
  };
}

function userSettingsToFirestoreDoc(settings: UserSettings, updatedAt: number) {
  return {
    userId: settings.userId,
    autoColor: settings.autoColor,
    colorBookend: settings.colorBookend,
    colorHighlight: settings.colorHighlight,
    updatedAt,
  };
}

// Firestore rejects documents over 1 MiB; leave headroom for field names.
const MAX_DOC_JSON_LENGTH = 1_000_000;

/**
 * Pushes each row with its own updatedAt (when the edit happened, which
 * last-write-wins needs), not the push time. syncedAt is local bookkeeping.
 * Data errors skip the row (it stays dirty) and are returned; anything else
 * (network, auth) throws and aborts the pass.
 */
async function pushRows<T extends { id: string; updatedAt: number }>(
  table: SyncFailure["table"],
  collectionName: string,
  rows: T[],
  toDoc: (row: T, updatedAt: number) => object,
  nameOf: (row: T) => string,
  markSynced: (id: string, syncedAt: number) => Promise<unknown>,
): Promise<SyncFailure[]> {
  const failures: SyncFailure[] = [];
  for (const row of rows) {
    const payload = toDoc(row, row.updatedAt);
    const fail = (reason: SyncFailure["reason"], message: string) =>
      failures.push({ table, id: row.id, name: nameOf(row), reason, message });

    if (JSON.stringify(payload).length > MAX_DOC_JSON_LENGTH) {
      fail("too-big", "document over the size limit");
      continue;
    }
    try {
      await setDoc(doc(db, collectionName, row.id), payload, { merge: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "invalid-argument") {
        fail("rejected", (err as Error).message);
        continue;
      }
      throw err;
    }
    await markSynced(row.id, Date.now());
  }
  return failures;
}

export async function pushDirtyFolders(userId: string): Promise<SyncFailure[]> {
  return pushRows("folders", FOLDERS_COLLECTION, await getDirtyFolders(userId), folderToFirestoreDoc, (f) => f.name, markFolderSynced);
}

export async function pushDirtyNotes(userId: string): Promise<SyncFailure[]> {
  return pushRows("notes", NOTES_COLLECTION, await getDirtyNotes(userId), noteToFirestoreDoc, (n) => n.title, markNoteSynced);
}

export async function pushDirtyNotebooks(userId: string): Promise<SyncFailure[]> {
  return pushRows("notebooks", NOTEBOOKS_COLLECTION, await getDirtyNotebooks(userId), notebookToFirestoreDoc, (n) => n.name, markNotebookSynced);
}

export async function pushDirtyPages(userId: string): Promise<SyncFailure[]> {
  return pushRows("pages", PAGES_COLLECTION, await getDirtyPages(userId), pageToFirestoreDoc, (p) => p.title, markPageSynced);
}

export async function pushDirtyStickyNotes(userId: string): Promise<SyncFailure[]> {
  return pushRows("stickyNotes", STICKY_NOTES_COLLECTION, await getDirtyStickyNotes(userId), stickyNoteToFirestoreDoc, (s) => s.title, markStickyNoteSynced);
}

// The doc id is the user id.
export async function pushDirtyUserSettings(userId: string): Promise<SyncFailure[]> {
  const rows = (await getDirtyUserSettings(userId)).map((s) => ({ ...s, id: s.userId }));
  return pushRows("userSettings", USER_SETTINGS_COLLECTION, rows, userSettingsToFirestoreDoc, () => "Settings", markUserSettingsSynced);
}

/** One push pass; scheduling and debouncing live in lib/sync/engine.ts. */
export async function pushDirtyRows(userId: string): Promise<SyncFailure[]> {
  const failures: SyncFailure[] = [];
  const passes: [string, () => Promise<SyncFailure[]>][] = [
    ["folders", () => pushDirtyFolders(userId)],
    ["notes", () => pushDirtyNotes(userId)],
    ["notebooks", () => pushDirtyNotebooks(userId)],
    ["pages", () => pushDirtyPages(userId)],
    ["stickyNotes", () => pushDirtyStickyNotes(userId)],
    ["userSettings", () => pushDirtyUserSettings(userId)],
  ];
  let firstError: unknown;
  let hasError = false;
  // One collection throwing must not starve the others; rethrow afterwards so
  // the engine still schedules its backoff retry.
  for (const [name, run] of passes) {
    try {
      failures.push(...(await run()));
    } catch (err) {
      const code = (err as { code?: string }).code;
      console.error(`[sync/push] ${name} push threw (code: ${code ?? "none"}): ${(err as Error).message}`);
      if (!hasError) {
        hasError = true;
        firstError = err;
      }
    }
  }
  if (hasError) throw firstError;
  return failures;
}
