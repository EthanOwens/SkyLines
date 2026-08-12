import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOldTombstoneFolders, hardDeleteFolder } from "@/lib/db/folders";
import { getOldTombstoneNotes, hardDeleteNote } from "@/lib/db/notes";
import { getOldTombstoneNotebooks, hardDeleteNotebook } from "@/lib/db/notebooks";
import { getOldTombstonePages, hardDeletePage } from "@/lib/db/pages";
import type { Folder, Note, Notebook, Page } from "@/types";

// Tombstone hard-delete cleanup (spec.md subtask 13, second half - the
// soft-delete-pushed-like-any-other-update half was already done by
// subtasks 11/12's push.ts/pull.ts). A single on-demand cleanup pass:
// finds local folders/notes that have been soft-deleted (`deletedAt` set)
// for longer than `maxAgeMs`, hard-deletes the corresponding Firestore
// document (if one was ever actually pushed), then hard-deletes the local
// row via a genuine `DELETE FROM` - the first real hard-delete in this
// codebase; everything else (lib/db/folders.ts, lib/db/notes.ts) is
// soft-delete only. No scheduling/polling here - just the pass function
// itself (that wiring is a later subtask's job, per spec.md).

const FOLDERS_COLLECTION = "folders";
const NOTES_COLLECTION = "notes";
const NOTEBOOKS_COLLECTION = "notebooks";
const PAGES_COLLECTION = "pages";

/**
 * Default tombstone retention window: 30 days. Chosen as a generous grace
 * period - long enough that any device which has been offline for a normal
 * vacation/extended-outage stretch still gets a chance to pull the
 * tombstone (and thus stop showing/resurrecting the deleted row) before the
 * record disappears from Firestore for good and pull-sync has nothing left
 * to reconcile against. Once local hard-delete + remote `deleteDoc` both
 * happen, there is no tombstone left for a straggling offline device to
 * eventually pull - so this window is a deliberate trade-off between
 * "don't keep dead rows around forever" and "give slow/offline devices a
 * real chance to catch up first."
 */
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Orders a flat list of tombstoned folders so that every folder appears
 * before its parent (if the parent is also in the list) - a topological
 * sort (repeated "peel off current leaves") over the `parentId` edges
 * within this batch. Required because `folders.parent_id REFERENCES
 * folders(id)` is an enforced foreign key (confirmed in an earlier subtask
 * that sqlx-sqlite turns on `PRAGMA foreign_keys=ON`), so hard-deleting a
 * parent while a child folder row still points at it throws an FK
 * constraint error.
 *
 * In the common case this doesn't even matter: `deleteFolder` (subtask 10)
 * always cascades the SAME `deletedAt` timestamp to a folder and every
 * descendant folder/note at once, so an entire deleted subtree becomes
 * "old enough" together and would already come back from
 * `getOldTombstoneFolders` in a safe order almost by construction. This
 * function makes that ordering guaranteed rather than incidental, and also
 * covers the (currently unreachable, but not structurally impossible)
 * mixed case where only part of a tombstoned subtree is old enough yet.
 *
 * If the batch isn't a clean forest (e.g. a live/non-deleted folder
 * elsewhere in the table still parents one of these ids, or some other
 * unexpected reference), the leftover rows are appended as-is at the end;
 * their `DELETE FROM` will surface the real FK error from SQLite rather
 * than this function silently dropping or reordering them incorrectly.
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
 * Hard-deletes one tombstoned row - but only once it's actually safe to.
 * There are three cases, keyed off `dirty` (has this row's CURRENT state,
 * including its `deletedAt`, been confirmed synced to Firestore?) and
 * `syncedAt` (has this row ever been synced to Firestore in ANY state?):
 *
 * 1. `!dirty` - the soft-delete itself was successfully pushed; Firestore
 *    already reflects `deletedAt`. Safe to hard-delete both remote (if
 *    `syncedAt !== null`) and local.
 * 2. `dirty && syncedAt === null` - this row never existed on Firestore in
 *    any form (created and soft-deleted entirely offline). Safe to
 *    hard-delete locally; there's nothing remote to delete.
 * 3. `dirty && syncedAt !== null` - the row WAS live-and-pushed at some
 *    point, but the soft-delete itself was never confirmed pushed
 *    (`syncedAt` predates the deletion, it's stale). Hard-deleting the
 *    remote doc here would erase a document every OTHER device still
 *    believes is live, with no way for them to ever find out (pull.ts
 *    deliberately no-ops on Firestore "removed" events - see that file).
 *    Hard-deleting the LOCAL row here would destroy the only record that
 *    this pending deletion still needs to be pushed, permanently
 *    orphaning the remote doc as "live" forever. So this case is skipped
 *    entirely - the row stays soft-deleted-but-dirty until a future push
 *    succeeds, after which case 1 applies and a later cleanup pass can
 *    finish the job.
 *
 * When case 1 does apply, remote-before-local is deliberate, for
 * self-healing under partial failure: if this cleanup pass (or the app)
 * dies between the two deletes, the local row is the one left behind
 * either way, and a local tombstone row is exactly what a future cleanup
 * pass looks for - it'll retry both steps again, and a repeat
 * `deleteDoc()` on an already-deleted/nonexistent doc is a harmless
 * no-op. The reverse order (local-first) would be unrecoverable on
 * partial failure: once the local tombstone is gone, nothing in this app
 * ever looks at that row/id again, so a Firestore doc orphaned by a
 * failed second step would never get cleaned up.
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
 * Runs one tombstone-cleanup pass for `userId`: hard-deletes (both locally
 * and on Firestore) every page/note/folder/notebook that has been
 * soft-deleted for longer than `maxAgeMs`. Pages are cleaned up before notes
 * so that a page whose `note_id` points at an about-to-be-hard-deleted note
 * is already gone by the time that note's `DELETE FROM` runs
 * (`pages.note_id REFERENCES notes(id)` is an enforced FK). Notes are
 * cleaned up before folders so that a note whose `folder_id` points at an
 * about-to-be-hard-deleted folder is already gone by the time that folder's
 * `DELETE FROM` runs (`notes.folder_id REFERENCES folders(id)` is an
 * enforced FK); within the folders batch, `orderFoldersLeavesFirst` further
 * ensures children are deleted before their parents for the same reason.
 * Notebooks are cleaned up last, after folders, so that a folder whose
 * `notebook_id` points at an about-to-be-hard-deleted notebook is already
 * gone by the time that notebook's `DELETE FROM` runs
 * (`folders.notebook_id REFERENCES notebooks(id)` is an enforced FK) - no
 * analogous "leaves first" ordering is needed within the notebooks batch
 * itself since notebooks don't reference each other (see
 * lib/db/notebooks.ts).
 *
 * Single on-demand pass only - no scheduling/timer here (see file header).
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
