import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOldTombstoneFolders, hardDeleteFolder } from "@/lib/db/folders";
import { getOldTombstoneNotes, hardDeleteNote } from "@/lib/db/notes";
import { getOldTombstoneNotebooks, hardDeleteNotebook } from "@/lib/db/notebooks";
import { getOldTombstonePages, hardDeletePage } from "@/lib/db/pages";
import type { Folder, Note, Notebook, Page } from "@/types";

// Tombstone cleanup: hard-deletes rows soft-deleted longer than maxAgeMs, in
// Firestore and locally. Runs one pass on demand.

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";

/**
 * 30 days gives devices that were offline a long time to pull the tombstone.
 * After the hard delete there's nothing left for them to reconcile against.
 */
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Orders folders so children come before parents (parent_id is an enforced FK).
 * deleteFolder gives a whole subtree the same deletedAt, so this is usually
 * already true; this makes it guaranteed. Rows that don't form a clean forest
 * go last, so SQLite reports the real FK error.
 */
function orderFoldersLeavesFirst(folders: Folder[]): Folder[] {
  const remaining = new Map(folders.map((f) => [f.id, f]));
  const childCount = new Map<string, number>();
  for (const f of folders) childCount.set(f.id, 0);
  for (const f of folders) {
    if (f.parentId && childCount.has(f.parentId)) {
      childCount.set(f.parentId, (childCount.get(f.parentId) ?? 0) + 1);
    }
  }

  const ordered: Folder[] = [];
  while (remaining.size > 0) {
    const leaves = [...remaining.values()].filter((f) => (childCount.get(f.id) ?? 0) === 0);
    if (leaves.length === 0) {
      // Not a clean forest within this batch - bail and let the DB's own
      // FK check report the real problem for whatever's left.
      ordered.push(...remaining.values());
      break;
    }
    for (const leaf of leaves) {
      ordered.push(leaf);
      remaining.delete(leaf.id);
      if (leaf.parentId && childCount.has(leaf.parentId)) {
        childCount.set(leaf.parentId, (childCount.get(leaf.parentId) ?? 0) - 1);
      }
    }
  }
  return ordered;
}

/**
 * Hard-deletes one tombstone, but only when it's safe:
 *
 * 1. Not dirty: the soft-delete was pushed. Delete remotely (if it was ever
 * synced) and locally. 2. Dirty and never synced: it never reached Firestore.
 * Delete locally. 3. Dirty but synced before: the soft-delete was never pushed.
 * Skip it. Deleting the remote doc would hide the deletion from other devices
 * (pull ignores "removed" events), and deleting the local row would lose the
 * pending delete. A later pass handles it once the push succeeds.
 *
 * Remote before local: if the pass dies in between, the local tombstone
 * survives and the next pass retries both (deleting a missing doc is a no-op).
 * Local first would leave an orphaned remote doc forever.
 */
async function hardDeleteTombstone(
  collectionName: "folders" | "notes" | "notebooks" | "pages",
  row: Folder | Note | Notebook | Page,
  hardDeleteLocal: (id: string) => Promise<void>,
): Promise<void> {
  if (row.dirty && row.syncedAt !== null) {
    // Case 3: soft-delete never confirmed pushed. Skip entirely this pass.
    return;
  }

  if (!row.dirty) {
    // Case 1: soft-delete confirmed synced.
    await deleteDoc(doc(db, collectionName, row.id));
  }
  // Case 2 (dirty && syncedAt === null) falls through to local-only delete.

  await hardDeleteLocal(row.id);
}

/**
 * Order follows the foreign keys: pages before notes, notes before folders
 * (children before parents), and notebooks last.
 */
export async function cleanupOldTombstones(
  userId: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<void> {
  const cutoffMs = Date.now() - maxAgeMs;

  const oldPages = await getOldTombstonePages(userId, cutoffMs);
  const pageErrors: unknown[] = [];
  for (const page of oldPages) {
    try {
      await hardDeleteTombstone(PAGES_COLLECTION, page, hardDeletePage);
    } catch (err) {
      pageErrors.push(err);
    }
  }

  const oldNotes = await getOldTombstoneNotes(userId, cutoffMs);
  const noteErrors: unknown[] = [];
  for (const note of oldNotes) {
    try {
      await hardDeleteTombstone(NOTES_COLLECTION, note, hardDeleteNote);
    } catch (err) {
      // One bad row shouldn't block cleanup of the rest - it's still a
      // tombstone locally, so the next cleanup pass will retry it.
      noteErrors.push(err);
    }
  }

  const oldFolders = orderFoldersLeavesFirst(await getOldTombstoneFolders(userId, cutoffMs));
  const folderErrors: unknown[] = [];
  for (const folder of oldFolders) {
    try {
      await hardDeleteTombstone(FOLDERS_COLLECTION, folder, hardDeleteFolder);
    } catch (err) {
      folderErrors.push(err);
    }
  }

  const oldNotebooks = await getOldTombstoneNotebooks(userId, cutoffMs);
  const notebookErrors: unknown[] = [];
  for (const notebook of oldNotebooks) {
    try {
      await hardDeleteTombstone(NOTEBOOKS_COLLECTION, notebook, hardDeleteNotebook);
    } catch (err) {
      notebookErrors.push(err);
    }
  }

  const errors = [...pageErrors, ...noteErrors, ...folderErrors, ...notebookErrors];
  if (errors.length > 0) {
    throw new AggregateError(errors, `cleanupOldTombstones: ${errors.length} row(s) failed`);
  }
}
