"use client";

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getDb } from "@/lib/db/client";
import {
  createNotebook,
  deleteNotebook,
  getNotebookRowById,
  updateNotebook,
} from "@/lib/db/notebooks";
import { pushDirtyNotebooks, pushDirtyRows } from "@/lib/sync/push";
import { startPullSync } from "@/lib/sync/pull";
import { cleanupOldTombstones } from "@/lib/sync/cleanup";
import { getSyncConflicts } from "@/lib/db/syncConflicts";

// Throwaway verification harness for the notebooks-table extension to
// lib/sync/push.ts / pull.ts / cleanup.ts, mirroring app/spike-push,
// app/spike-pull, and app/spike-cleanup's exact patterns but scoped to a
// single page since all three are "apply the same established pattern to a
// third table." Signs in with a throwaway test account solely to satisfy
// firestore.rules - "Cleanup" tears everything down again, remote docs
// before the auth account, per project convention. Not production UI.

const TEST_EMAIL = "skylines-notebook-sync-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function docGone(id: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "notebooks", id));
    return !snap.exists();
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") return true;
    throw err;
  }
}

async function backdate(id: string, deletedAt: number) {
  const conn = await getDb();
  await conn.execute(`UPDATE notebooks SET deleted_at = $1 WHERE id = $2`, [deletedAt, id]);
}

export default function SpikeNotebookSync() {
  const [log, setLog] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [unsubscribe, setUnsubscribe] = useState<(() => void) | null>(null);
  const pushedNotebookIdsRef = useRef<string[]>([]);

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

      const unsub = startPullSync(cred.user.uid);
      setUnsubscribe(() => unsub);
      append("pull listener started (all 3 collections, including notebooks)");
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  async function runPushCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await createNotebook(user.uid, "Push Spike Notebook", 1);
      pushedNotebookIdsRef.current.push(notebookId);
      const before = await getNotebookRowById(notebookId);
      append(`created local notebook -> id=${notebookId} dirty=${before?.dirty} updatedAt=${before?.updatedAt}`);

      await pushDirtyNotebooks(user.uid);
      append("pushDirtyNotebooks() completed");

      const after = await getNotebookRowById(notebookId);
      const snap = await getDoc(doc(db, "notebooks", notebookId));
      append(
        `after push (local): dirty=${after?.dirty} syncedAt=${after?.syncedAt}`,
      );
      append(`after push (firestore): exists=${snap.exists()} data=${JSON.stringify(snap.data())}`);

      const pass =
        after?.dirty === false &&
        typeof after?.syncedAt === "number" &&
        snap.exists() &&
        snap.data()?.updatedAt === before?.updatedAt; // own edit-time updatedAt, NOT push-time
      append(`PUSH CASE RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`PUSH CASE FAILED: ${String(err)}`);
    }
  }

  async function runPullRemoteNewerCase() {
    if (!user) return append("sign in first");
    try {
      const remoteId = crypto.randomUUID();
      const now = Date.now();
      await setDoc(doc(db, "notebooks", remoteId), {
        name: "Remote-Only Notebook",
        userId: user.uid,
        order: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      pushedNotebookIdsRef.current.push(remoteId);
      append(`wrote remote-only notebook doc -> id=${remoteId} (no local row yet)`);

      await sleep(2000);
      const local = await getNotebookRowById(remoteId);
      append(
        `local after pull: found=${!!local} name=${local?.name} dirty=${local?.dirty} syncedAt=${local?.syncedAt}`,
      );
      const pass = local !== null && local.name === "Remote-Only Notebook" && local.dirty === false;
      append(`PULL (remote-newer/insert) RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`PULL (remote-newer) CASE FAILED: ${String(err)}`);
    }
  }

  async function runConflictCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await createNotebook(user.uid, "Local Notebook (conflict, remote wins)", 1);
      pushedNotebookIdsRef.current.push(notebookId);
      await pushDirtyNotebooks(user.uid);
      const synced = await getNotebookRowById(notebookId);
      append(`created+pushed -> syncedAt=${synced?.syncedAt}`);

      await sleep(50);
      await updateNotebook(notebookId, { name: "Local Edit (should lose)" });
      const dirtyLocal = await getNotebookRowById(notebookId);
      append(`local edited (dirty, unpushed) -> updatedAt=${dirtyLocal?.updatedAt} dirty=${dirtyLocal?.dirty}`);

      // Remote write with updatedAt AFTER both syncedAt and the local edit's
      // updatedAt - both sides touched since last sync, remote is later, so
      // remote should win.
      const remoteUpdatedAt = (dirtyLocal?.updatedAt ?? Date.now()) + 10_000;
      await setDoc(
        doc(db, "notebooks", notebookId),
        { name: "Remote Edit (should win)", updatedAt: remoteUpdatedAt },
        { merge: true },
      );
      append(`wrote conflicting remote update -> updatedAt=${remoteUpdatedAt}`);

      await sleep(2000);
      const local = await getNotebookRowById(notebookId);
      const conflicts = await getSyncConflicts("notebooks", notebookId);
      append(`local after pull: name=${local?.name} dirty=${local?.dirty}`);
      append(
        `sync_conflicts rows=${conflicts.length} losingData=${JSON.stringify(conflicts[0]?.losingData)}`,
      );
      const losing = conflicts[0]?.losingData as { name?: string } | undefined;
      const pass =
        local?.name === "Remote Edit (should win)" &&
        local?.dirty === false &&
        conflicts.length === 1 &&
        losing?.name === "Local Edit (should lose)";
      append(`CONFLICT (remote wins) RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`CONFLICT CASE FAILED: ${String(err)}`);
    }
  }

  async function runOldTombstoneCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await createNotebook(user.uid, "Cleanup Case: old tombstone notebook", 1);
      await pushDirtyRows(user.uid);
      pushedNotebookIdsRef.current.push(notebookId);
      append(`created+pushed notebook=${notebookId}`);

      await deleteNotebook(notebookId);
      await pushDirtyRows(user.uid); // push the deletedAt tombstone
      append("soft-deleted + pushed tombstone");

      const oldDeletedAt = Date.now() - THIRTY_ONE_DAYS_MS;
      await backdate(notebookId, oldDeletedAt);
      append(`backdated deleted_at -> ${oldDeletedAt} (31 days ago)`);

      await cleanupOldTombstones(user.uid);
      append("ran cleanupOldTombstones");

      const localNotebook = await getNotebookRowById(notebookId);
      const remoteGone = await docGone(notebookId);
      append(`local: notebook=${localNotebook === null ? "GONE" : "STILL PRESENT"}`);
      append(`remote: notebook gone=${remoteGone}`);
      const pass = localNotebook === null && remoteGone;
      append(`OLD TOMBSTONE CASE RESULT: ${pass ? "PASS" : "FAIL"}`);

      if (pass) {
        pushedNotebookIdsRef.current = pushedNotebookIdsRef.current.filter((id) => id !== notebookId);
      }
    } catch (err) {
      append(`OLD TOMBSTONE CASE FAILED: ${String(err)}`);
    }
  }

  /**
   * Case 3 from lib/sync/cleanup.ts's hardDeleteTombstone: a notebook that
   * was live-and-pushed at some point (non-null syncedAt), then soft-deleted
   * locally, but that soft-delete itself was NEVER pushed (dirty stays
   * true, syncedAt stays stale/pre-deletion). Deliberately skips the
   * pushDirtyRows call after deleteNotebook - that's the whole point.
   * Cleanup must leave both sides alone.
   */
  async function runStaleSyncedAtCase() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await createNotebook(user.uid, "Cleanup Case: stale syncedAt notebook", 1);
      await pushDirtyRows(user.uid); // live-and-pushed: dirty=false, syncedAt=non-null
      pushedNotebookIdsRef.current.push(notebookId);
      append(`created+pushed notebook=${notebookId}`);

      await deleteNotebook(notebookId); // soft-delete: dirty=1 again, deletedAt set - NOT pushed
      append("soft-deleted locally WITHOUT pushing (syncedAt now stale)");

      const oldDeletedAt = Date.now() - THIRTY_ONE_DAYS_MS;
      await backdate(notebookId, oldDeletedAt);
      append(`backdated deleted_at -> ${oldDeletedAt} (31 days ago)`);

      const beforeLocal = await getNotebookRowById(notebookId);
      append(
        `before cleanup: local dirty=${beforeLocal?.dirty} syncedAt=${beforeLocal?.syncedAt} deletedAt=${beforeLocal?.deletedAt}`,
      );

      await cleanupOldTombstones(user.uid);
      append("ran cleanupOldTombstones");

      const localNotebook = await getNotebookRowById(notebookId);
      const remoteSnap = await getDoc(doc(db, "notebooks", notebookId));

      append(
        `local: notebook=${localNotebook === null ? "GONE" : `STILL PRESENT (dirty=${localNotebook.dirty}, deletedAt=${localNotebook.deletedAt})`}`,
      );
      append(`remote: notebook exists=${remoteSnap.exists()}`);

      const pass =
        localNotebook !== null &&
        localNotebook.dirty === true &&
        localNotebook.deletedAt !== null &&
        remoteSnap.exists();
      append(`STALE SYNCEDAT (case 3, should skip both sides) RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`STALE SYNCEDAT CASE FAILED: ${String(err)}`);
    }
  }

  async function cleanup() {
    try {
      if (unsubscribe) {
        unsubscribe();
        append("pull listener stopped");
      }
      for (const notebookId of pushedNotebookIdsRef.current) {
        await deleteDoc(doc(db, "notebooks", notebookId)).catch(() => {});
      }
      append(`deleted leftover firestore docs: notebooks=${pushedNotebookIdsRef.current.length}`);
      pushedNotebookIdsRef.current = [];

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
      <h1 className="text-2xl font-semibold">Spike Notebook Sync (push/pull/cleanup for notebooks)</h1>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in + start pull listener
        </button>
        <button onClick={() => void runPushCase()} className="rounded bg-green-600 px-4 py-2 text-white">
          2. Push case
        </button>
        <button onClick={() => void runPullRemoteNewerCase()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Pull (remote-newer/insert) case
        </button>
        <button onClick={() => void runConflictCase()} className="rounded bg-orange-600 px-4 py-2 text-white">
          4. Conflict (remote wins) case
        </button>
        <button onClick={() => void runOldTombstoneCase()} className="rounded bg-purple-600 px-4 py-2 text-white">
          5. Old tombstone - should hard-delete both sides
        </button>
        <button onClick={() => void runStaleSyncedAtCase()} className="rounded bg-orange-600 px-4 py-2 text-white">
          6. Stale syncedAt - should skip both sides
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          7. Cleanup (delete test data + user)
        </button>
      </div>
      <ul data-testid="spike-notebook-sync-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
