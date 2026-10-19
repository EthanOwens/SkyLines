import type { Folder, Note, Page } from "@/types";
import { createFolder, getFolders, updateFolder } from "@/lib/db/folders";
import { createNote, getNotes, updateNote } from "@/lib/db/notes";
import { createPage, getPages, updatePage } from "@/lib/db/pages";
import { isFolderOrDescendant, nextOrderValue } from "@/lib/dnd/sidebar";

// Executes sidebar cut/copy/paste. The clipboard value itself lives in the
// store.

export type ClipboardEntry = {
  kind: "cut" | "copy";
  // Pages paste into a note, so they use pastePageClipboardEntry instead.
  type: "note" | "folder" | "page";
  id: string;
};

/** Where a paste lands - a folder (`folderId` non-null) or the notebook root
 * (`folderId: null`). */
export interface PasteTarget {
  notebookId: string;
  folderId: string | null;
}

/** Where a page paste lands - always a specific note (pages don't live in
 * the folder/notebook tree at all, see `ClipboardEntry`'s comment above). */
export interface PagePasteTarget {
  noteId: string;
}

/** createNote can't take content, so this creates then updates. */
async function duplicateNote(
  userId: string,
  note: Note,
  notebookId: string,
  folderId: string | null,
  order: number,
): Promise<string> {
  const id = await createNote(userId, note.type, notebookId, folderId, note.title, order);
  if (note.content !== null || note.canvasData !== null) {
    await updateNote(id, { content: note.content, canvasData: note.canvasData });
  }
  return id;
}

/** Copies the whole subtree as new rows, walking the already-loaded tree. */
async function duplicateFolder(
  userId: string,
  folder: Folder,
  allFolders: Folder[],
  allNotes: Note[],
  notebookId: string,
  parentId: string | null,
  order: number,
): Promise<string> {
  const newId = await createFolder(userId, folder.name, notebookId, parentId, order);

  const childFolders = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.order - b.order);
  const childNotes = allNotes
    .filter((n) => n.folderId === folder.id)
    .sort((a, b) => a.order - b.order);

  for (let i = 0; i < childFolders.length; i++) {
    await duplicateFolder(userId, childFolders[i], allFolders, allNotes, notebookId, newId, i);
  }
  for (let i = 0; i < childNotes.length; i++) {
    await duplicateNote(userId, childNotes[i], notebookId, newId, i);
  }

  return newId;
}

/**
 * Moves a cut folder's whole subtree to another notebook in place. notebook_id
 * isn't derived from parent_id (deleteNotebook cascades by notebook_id), so
 * every descendant has to be updated.
 */
async function retargetFolderNotebook(
  folder: Folder,
  allFolders: Folder[],
  allNotes: Note[],
  notebookId: string,
): Promise<void> {
  await updateFolder(folder.id, { notebookId });

  const childFolders = allFolders.filter((f) => f.parentId === folder.id);
  const childNotes = allNotes.filter((n) => n.folderId === folder.id);

  for (const childFolder of childFolders) {
    await retargetFolderNotebook(childFolder, allFolders, allNotes, notebookId);
  }
  for (const childNote of childNotes) {
    await updateNote(childNote.id, { notebookId });
  }
}

/**
 * Read sibling orders fresh from the DB: Copy keeps the clipboard, so two quick
 * pastes would otherwise compute the same order from a stale store.
 */
async function freshSiblingOrders(
  userId: string,
  kind: "folder" | "note",
  parentId: string | null,
  excludeId?: string,
): Promise<number[]> {
  if (kind === "folder") {
    const folders = await getFolders(userId);
    return folders
      .filter((f) => f.parentId === parentId && f.id !== excludeId)
      .map((f) => f.order);
  }
  const notes = await getNotes(userId);
  return notes.filter((n) => n.folderId === parentId && n.id !== excludeId).map((n) => n.order);
}

/**
 * Returns false for a no-op: the source is gone, or a Cut would move a folder
 * into itself or a descendant. The caller clears the clipboard after a Cut, not
 * after a Copy. Copying a folder into itself is allowed, because it creates new
 * rows.
 */
export async function pasteClipboardEntry(
  userId: string,
  entry: ClipboardEntry,
  target: PasteTarget,
  allFolders: Folder[],
  allNotes: Note[],
): Promise<boolean> {
  if (entry.type === "folder") {
    const folder = allFolders.find((f) => f.id === entry.id);
    if (!folder) return false;

    if (entry.kind === "cut") {
      if (target.folderId && isFolderOrDescendant(allFolders, entry.id, target.folderId)) {
        return false;
      }
      const siblingOrders = await freshSiblingOrders(
        userId,
        "folder",
        target.folderId,
        folder.id,
      );
      const movingNotebooks = target.notebookId !== folder.notebookId;
      await updateFolder(entry.id, {
        parentId: target.folderId,
        order: nextOrderValue(siblingOrders),
        ...(movingNotebooks ? { notebookId: target.notebookId } : {}),
      });
      if (movingNotebooks) {
        // See retargetFolderNotebook.
        const childFolders = allFolders.filter((f) => f.parentId === folder.id);
        const childNotes = allNotes.filter((n) => n.folderId === folder.id);
        for (const childFolder of childFolders) {
          await retargetFolderNotebook(childFolder, allFolders, allNotes, target.notebookId);
        }
        for (const childNote of childNotes) {
          await updateNote(childNote.id, { notebookId: target.notebookId });
        }
      }
      return true;
    }

    const siblingOrders = await freshSiblingOrders(userId, "folder", target.folderId);
    await duplicateFolder(
      userId,
      folder,
      allFolders,
      allNotes,
      target.notebookId,
      target.folderId,
      nextOrderValue(siblingOrders),
    );
    return true;
  }

  const note = allNotes.find((n) => n.id === entry.id);
  if (!note) return false;

  if (entry.kind === "cut") {
    const siblingOrders = await freshSiblingOrders(userId, "note", target.folderId, note.id);
    const movingNotebooks = target.notebookId !== note.notebookId;
    await updateNote(entry.id, {
      folderId: target.folderId,
      order: nextOrderValue(siblingOrders),
      ...(movingNotebooks ? { notebookId: target.notebookId } : {}),
    });
    return true;
  }

  const siblingOrders = await freshSiblingOrders(userId, "note", target.folderId);
  await duplicateNote(userId, note, target.notebookId, target.folderId, nextOrderValue(siblingOrders));
  return true;
}

/** Same create-then-update as duplicateNote. */
async function duplicatePage(
  page: Page,
  noteId: string,
  order: number,
): Promise<string> {
  const id = await createPage(noteId, page.userId, page.title, order);
  if (page.content !== null || page.canvasData !== null) {
    await updatePage(id, { content: page.content, canvasData: page.canvasData });
  }
  return id;
}

/**
 * Pages don't nest, so there's no cycle check. Returns false when the source
 * page is gone.
 */
export async function pastePageClipboardEntry(
  entry: ClipboardEntry,
  target: PagePasteTarget,
  allPages: Page[],
): Promise<boolean> {
  if (entry.type !== "page") return false;
  const page = allPages.find((p) => p.id === entry.id);
  if (!page) return false;

  const siblingPages = await getPages(target.noteId);
  const siblingOrders = siblingPages
    .filter((p) => p.id !== entry.id)
    .map((p) => p.order);

  if (entry.kind === "cut") {
    // updatePage can't change a page's note, so a cross-note cut is rejected
    // rather than reordering the page within its old note.
    if (page.noteId !== target.noteId) return false;
    await updatePage(entry.id, { order: nextOrderValue(siblingOrders) });
    return true;
  }

  await duplicatePage(page, target.noteId, nextOrderValue(siblingOrders));
  return true;
}
