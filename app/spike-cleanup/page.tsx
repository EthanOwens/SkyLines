"use client";

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { deleteDoc, doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getDb } from "@/lib/db/client";
import {
  createFolder,
  deleteFolder,
  getFolderRowById,
} from "@/lib/db/folders";
import { createNote, deleteNote, getNoteRowById } from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import { pushDirtyRows } from "@/lib/sync/push";
import { cleanupOldTombstones } from "@/lib/sync/cleanup";

// M3 spike route (spec.md subtask 13). Verifies lib/sync/cleanup.ts
// end-to-end against real Firestore + real SQLite: old tombstones get
// genuinely hard-deleted on both sides, young tombstones are left alone,
// and a folder+child-note tombstone pair with an FK relationship cleans up
// without an FK constraint error. Signs in with a throwaway test account
// solely to satisfy firestore.rules (same pattern as app/spike-pull/
// page.tsx) - "Cleanup" below tears everything down again. Not production
// UI.

const TEST_EMAIL = "skylines-cleanup-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `getDoc()` on an already-hard-deleted document under this project's
 * `firestore.rules` (`allow read: if ... request.auth.uid ==
 * resource.data.userId`) throws `permission-denied`, not "not found" -
 * `resource` is null for a nonexistent doc, so `resource.data.userId`
 * itself throws inside rule evaluation, and Firestore reports that as
 * permission-denied to the client. Deterministic consequence of this
 * ruleset, unrelated to lib/sync/cleanup.ts's correctness - this treats
 * that specific error as "confirmed gone" so cases that assert a doc no
 * longer exists can actually complete, while still surfacing any other
 * unexpected error (wrong project, network, etc).
 */
async function docGone(collectionName: "folders" | "notes", id: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, collectionName, id));
    return !snap.exists();
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") return true;
    throw err;
  }
}

export default function SpikeCleanup() {
  const [log, setLog] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  // Ids this harness has pushed to Firestore, tracked so "Cleanup" can
  // delete anything left over (e.g. from a FAILed case) before deleting the
  // test auth account - deleting the account first would orphan the docs
  // permanently (per project history, avoid repeating that mistake).
  const pushedFolderIdsRef = useRef<string[]>([]);
  const pushedNoteIdsRef = useRef<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function signIn() {
    try {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      } catch {
        cred = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      }
      setUser(cred.user);
      append(`signed in -> userId=${cred.user.uid}`);
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  /** Raw backdate of a row's deleted_at, simulating "this tombstone is old" without waiting 31 real days. */
  async function backdate(table: "folders" | "notes", id: string, deletedAt: number) {
    const conn = await getDb();
    await conn.execute(`UPDATE ${table} SET deleted_at = $1 WHERE id = $2`, [deletedAt, id]);
  }

  async function runOldTombstoneCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "Cleanup Case: old tombstone folder", notebookId, null, 1);
      const noteId = await createNote(user.uid, "note", notebookId, folderId, "Cleanup Case: old tombstone note");
      await pushDirtyRows(user.uid);
      pushedFolderIdsRef.current.push(folderId);
      pushedNoteIdsRef.current.push(noteId);
      append(`created+pushed folder=${folderId} note=${noteId}`);

      await deleteFolder(folderId); // soft-delete: cascades to the note too
      await pushDirtyRows(user.uid); // push the deletedAt tombstones
      append("soft-deleted (cascaded) + pushed tombstones");

      const oldDeletedAt = Date.now() - THIRTY_ONE_DAYS_MS;
      await backdate("folders", folderId, oldDeletedAt);
      await backdate("notes", noteId, oldDeletedAt);
      append(`backdated deleted_at -> ${oldDeletedAt} (31 days ago)`);

      await cleanupOldTombstones(user.uid);
      append("ran cleanupOldTombstones");

      const localFolder = await getFolderRowById(folderId);
      const localNote = await getNoteRowById(noteId);
      const remoteFolderGone = await docGone("folders", folderId);
      const remoteNoteGone = await docGone("notes", noteId);

      append(
        `local: folder=${localFolder === null ? "GONE" : "STILL PRESENT"} note=${localNote === null ? "GONE" : "STILL PRESENT"}`,
      );
      append(`remote: folder gone=${remoteFolderGone} note gone=${remoteNoteGone}`);
      const pass =
        localFolder === null && localNote === null && remoteFolderGone && remoteNoteGone;
      append(`OLD TOMBSTONE CASE RESULT: ${pass ? "PASS" : "FAIL"}`);

      if (!pass) {
        // Leave for manual inspection but still track for final cleanup.
      } else {
        // Already gone on both sides - nothing left to track for cleanup.
        pushedFolderIdsRef.current = pushedFolderIdsRef.current.filter((id) => id !== folderId);
        pushedNoteIdsRef.current = pushedNoteIdsRef.current.filter((id) => id !== noteId);
      }
    } catch (err) {
      append(`OLD TOMBSTONE CASE FAILED: ${String(err)}`);
    }
  }

  async function runYoungTombstoneCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "Cleanup Case: young tombstone folder", notebookId, null, 1);
      await pushDirtyRows(user.uid);
      pushedFolderIdsRef.current.push(folderId);
      append(`created+pushed folder=${folderId}`);

      await deleteFolder(folderId);
      await pushDirtyRows(user.uid);
      append("soft-deleted + pushed tombstone (deleted_at = now, NOT backdated)");

      await cleanupOldTombstones(user.uid); // default 30-day window
      append("ran cleanupOldTombstones (default maxAgeMs)");

      const localFolder = await getFolderRowById(folderId);
      const remoteFolderSnap = await getDoc(doc(db, "folders", folderId));
      append(
        `local: folder=${localFolder === null ? "GONE" : `STILL PRESENT (deletedAt=${localFolder.deletedAt})`}`,
      );
      append(`remote: folder exists=${remoteFolderSnap.exists()}`);
      const pass = localFolder !== null && localFolder.deletedAt !== null && remoteFolderSnap.exists();
      append(`YOUNG TOMBSTONE (left alone) RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`YOUNG TOMBSTONE CASE FAILED: ${String(err)}`);
    }
  }

  /**
   * Case 3 from lib/sync/cleanup.ts's hardDeleteTombstone: a note that was
   * live-and-pushed at some point (non-null syncedAt), then soft-deleted
   * locally, but that soft-delete itself was NEVER pushed (dirty stays
   * true, syncedAt stays stale/pre-deletion). Deliberately skips the
   * `pushDirtyRows` call after `deleteNote` - that's the whole point of this
   * scenario. Cleanup must leave both sides alone: hard-deleting the remote
   * doc here would desync every other device (they still believe it's
   * live), and hard-deleting the local row would destroy the only pending
   * record of this deletion.
   */
  async function runStaleSyncedAtCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const noteId = await createNote(user.uid, "note", notebookId, null, "Cleanup Case: stale syncedAt note");
      await pushDirtyRows(user.uid); // live-and-pushed: dirty=false, syncedAt=non-null
      pushedNoteIdsRef.current.push(noteId);
      append(`created+pushed note=${noteId}`);

      await deleteNote(noteId); // soft-delete: dirty=1 again, deletedAt set - NOT pushed
      append("soft-deleted locally WITHOUT pushing (syncedAt now stale)");

      const oldDeletedAt = Date.now() - THIRTY_ONE_DAYS_MS;
      await backdate("notes", noteId, oldDeletedAt);
      append(`backdated deleted_at -> ${oldDeletedAt} (31 days ago)`);

      const beforeLocal = await getNoteRowById(noteId);
      append(
        `before cleanup: local dirty=${beforeLocal?.dirty} syncedAt=${beforeLocal?.syncedAt} deletedAt=${beforeLocal?.deletedAt}`,
      );

      await cleanupOldTombstones(user.uid);
      append("ran cleanupOldTombstones");

      const localNote = await getNoteRowById(noteId);
      const remoteNoteSnap = await getDoc(doc(db, "notes", noteId));

      append(
        `local: note=${localNote === null ? "GONE" : `STILL PRESENT (dirty=${localNote.dirty}, deletedAt=${localNote.deletedAt})`}`,
      );
      append(`remote: note exists=${remoteNoteSnap.exists()}`);

      const pass =
        localNote !== null &&
        localNote.dirty === true &&
        localNote.deletedAt !== null &&
        remoteNoteSnap.exists();
      append(`STALE SYNCEDAT (case 3, should skip both sides) RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`STALE SYNCEDAT CASE FAILED: ${String(err)}`);
    }
  }

  async function runNestedFolderFkCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const parentId = await createFolder(user.uid, "Cleanup Case: FK parent", notebookId, null, 1);
      const childId = await createFolder(user.uid, "Cleanup Case: FK child", notebookId, parentId, 1);
      const noteId = await createNote(user.uid, "note", notebookId, childId, "Cleanup Case: FK note in child");
      await pushDirtyRows(user.uid);
      pushedFolderIdsRef.current.push(parentId, childId);
      pushedNoteIdsRef.current.push(noteId);
      append(`created+pushed parent=${parentId} child=${childId} note=${noteId}`);

      await deleteFolder(parentId); // cascades to child folder + note
      await pushDirtyRows(user.uid);
      append("soft-deleted parent (cascaded to child+note) + pushed tombstones");

      const oldDeletedAt = Date.now() - THIRTY_ONE_DAYS_MS;
      await backdate("folders", parentId, oldDeletedAt);
      await backdate("folders", childId, oldDeletedAt);
      await backdate("notes", noteId, oldDeletedAt);
      append(`backdated all three rows -> ${oldDeletedAt}`);

      await cleanupOldTombstones(user.uid);
      append("ran cleanupOldTombstones (no FK error thrown = good sign already)");

      const localParent = await getFolderRowById(parentId);
      const localChild = await getFolderRowById(childId);
      const localNote = await getNoteRowById(noteId);
      const remoteParentGone = await docGone("folders", parentId);
      const remoteChildGone = await docGone("folders", childId);
      const remoteNoteGone = await docGone("notes", noteId);

      append(
        `local: parent=${localParent === null ? "GONE" : "STILL PRESENT"} child=${localChild === null ? "GONE" : "STILL PRESENT"} note=${localNote === null ? "GONE" : "STILL PRESENT"}`,
      );
      append(
        `remote: parent gone=${remoteParentGone} child gone=${remoteChildGone} note gone=${remoteNoteGone}`,
      );
      const pass =
        localParent === null &&
        localChild === null &&
        localNote === null &&
        remoteParentGone &&
        remoteChildGone &&
        remoteNoteGone;
      append(`NESTED FOLDER FK CASE RESULT: ${pass ? "PASS" : "FAIL"}`);

      if (pass) {
        pushedFolderIdsRef.current = pushedFolderIdsRef.current.filter(
          (id) => id !== parentId && id !== childId,
        );
        pushedNoteIdsRef.current = pushedNoteIdsRef.current.filter((id) => id !== noteId);
      }
    } catch (err) {
      append(`NESTED FOLDER FK CASE FAILED: ${String(err)}`);
    }
  }

  async function cleanup() {
    try {
      for (const folderId of pushedFolderIdsRef.current) {
        await deleteDoc(doc(db, "folders", folderId)).catch(() => {});
      }
      for (const noteId of pushedNoteIdsRef.current) {
        await deleteDoc(doc(db, "notes", noteId)).catch(() => {});
      }
      append(
        `deleted leftover firestore docs: folders=${pushedFolderIdsRef.current.length} notes=${pushedNoteIdsRef.current.length}`,
      );
      pushedFolderIdsRef.current = [];
      pushedNoteIdsRef.current = [];

      await sleep(200);

      if (user) {
        await user.delete();
        append("deleted test auth user");
      }
    } catch (err) {
      append(`CLEANUP FAILED (delete test data/user manually): ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Cleanup (lib/sync/cleanup)</h1>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={() => void runOldTombstoneCase()} className="rounded bg-green-600 px-4 py-2 text-white">
          2. Old tombstone (folder+note) - should hard-delete both sides
        </button>
        <button onClick={() => void runYoungTombstoneCase()} className="rounded bg-yellow-600 px-4 py-2 text-white">
          3. Young tombstone - should be left alone
        </button>
        <button onClick={() => void runStaleSyncedAtCase()} className="rounded bg-orange-600 px-4 py-2 text-white">
          4. Stale syncedAt (case 3) - soft-delete never pushed, should skip both sides
        </button>
        <button onClick={() => void runNestedFolderFkCase()} className="rounded bg-purple-600 px-4 py-2 text-white">
          5. Nested folder + note (FK ordering)
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          6. Cleanup (delete leftover test data + user) - remote before auth account, always
        </button>
      </div>
      <ul data-testid="spike-cleanup-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
