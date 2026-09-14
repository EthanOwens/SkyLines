import type { Folder, Note, Page } from "@/types";
import { createFolder, getFolders, updateFolder } from "@/lib/db/folders";
import { createNote, getNotes, updateNote } from "@/lib/db/notes";
import { createPage, getPages, updatePage } from "@/lib/db/pages";
import { isFolderOrDescendant, nextOrderValue } from "@/lib/dnd/sidebar";

// Generic cut/copy/paste mechanism for the sidebar tree (spec.md M4 subtask
// 8, "Right-click context menu with delete/rename/cut/copy/paste"). The
// clipboard VALUE itself (`ClipboardEntry`) lives in stores/appStore.ts
// (same transient-cross-component-signal pattern as `pendingEditClickPoint`
// - read once by whichever row's "Paste" is clicked, not persisted data).
// This module holds the logic that actually EXECUTES a paste against
// lib/db/notes.ts / lib/db/folders.ts, kept deliberately generic (keyed off
// `entry.type`/`entry.kind`, not "FolderItem internals") so it can be
// reused as-is by M6's Page sidebar - see the "Key Decision" in spec.md.

export type ClipboardEntry = {
  kind: "cut" | "copy";
  // "page" (spec.md M6 subtask 17, "Page sidebar") reuses this same
  // clipboard field/mechanism for a note's Pages - see
  // `pastePageClipboardEntry` below, a sibling to `pasteClipboardEntry`
  // rather than a branch inside it, since a page's paste target (a Note) is
  // a fundamentally different kind of container than a folder/notebook.
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

/**
 * Duplicates a single note under `folderId`, copying its content/canvasData.
 * `createNote` itself never accepts content/canvasData (every note starts
 * empty), so this is a create-then-update - two writes are unavoidable
 * without a lower-level insert primitive, and this whole operation isn't on
 * any hot path.
 */
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

/**
 * Recursively duplicates `folder` and everything inside it (subfolders,
 * notes, and their content, at any depth) under `parentId`, as genuinely new
 * rows/ids - not references. `allFolders`/`allNotes` are the full
 * already-loaded tree (from stores/appStore.ts), so no extra DB reads are
 * needed to walk the source subtree.
 */
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
 * Recursively retargets `folder` and everything inside it (subfolders,
 * notes, at any depth) to `notebookId`, in place - i.e. the same subtree
 * walk `duplicateFolder` does, but issuing `updateFolder`/`updateNote`
 * calls against the EXISTING rows instead of creating new ones. Used by a
 * cross-notebook folder Cut+Paste to keep every descendant's `notebookId`
 * consistent with its new location, since `notebook_id` is not derived from
 * `parent_id` anywhere else in the schema (e.g. `deleteNotebook` cascades by
 * `notebook_id` directly).
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
 * Returns the current `order` values of the siblings a pasted item would
 * land among, read FRESH from the DB rather than from the caller's
 * (possibly stale) `allFolders`/`allNotes` snapshot. Copy deliberately
 * leaves the clipboard populated to support repeated pastes, so two Paste
 * clicks fired in quick succession - before the store's async post-write
 * refetch resolves - would otherwise both compute `order` from the same
 * stale in-memory snapshot and land on an identical, ambiguous `order`
 * value. A one-shot re-read here closes that window without requiring a
 * larger architectural change (e.g. optimistic local order tracking).
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
 * Executes a paste of `entry` into `target`. Returns `true` if something was
 * actually written, `false` if the paste was a no-op (the source row no
 * longer exists, or - for a Cut - the target is the folder itself or one of
 * its own descendants, which would corrupt the tree). Callers are
 * responsible for clearing the clipboard afterward for a Cut (one-shot
 * move) and leaving it alone for a Copy (repeatable, normal clipboard
 * semantics) - this function only performs the write.
 *
 * A Copy of a folder pasted back inside itself (or one of its own copies) is
 * NOT blocked - it creates new ids, so it's not a cycle, just a legitimate
 * (if a little redundant) duplicate subfolder.
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
        // Keep every descendant folder/note's notebookId consistent with
        // the folder's new location - see retargetFolderNotebook's doc
        // comment for why this can't be left to derive from parentId.
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

/**
 * Duplicates a single page under `noteId`, copying its title/content/
 * canvasData. Same create-then-update shape as `duplicateNote` above -
 * `createPage` never accepts content/canvasData directly either.
 */
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
 * Page analogue of `pasteClipboardEntry` above (spec.md M6 subtask 17, "Page
 * sidebar") - kept as a sibling function rather than a branch inside
 * `pasteClipboardEntry` since a page's target is a Note (`PagePasteTarget`),
 * not a `PasteTarget` (folder/notebook); pages don't live in that tree at
 * all. Same return-value contract: `true` if something was written, `false`
 * for a no-op (source page no longer exists).
 *
 * Unlike folders, pages can't be re-parented onto themselves/descendants (no
 * nesting), so there's no `isFolderOrDescendant`-style guard needed for the
 * "cut" branch - moving a page to any note (including its own) is always
 * safe, it just lands at the end of that note's page order.
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
    // Pages moving between notes isn't a feature this subtask builds -
    // `updatePage` has no way to change which note a page belongs to (no
    // `noteId` field in its update type), so a cross-note cut-paste would
    // otherwise silently reorder the source page among ITS OWN note's
    // siblings using an order value computed from an unrelated note. Reject
    // it as a clean no-op instead, leaving the clipboard intact.
    if (page.noteId !== target.noteId) return false;
    await updatePage(entry.id, { order: nextOrderValue(siblingOrders) });
    return true;
  }

  await duplicatePage(page, target.noteId, nextOrderValue(siblingOrders));
  return true;
}
