"use client";

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { createFolder, getFolderRowById, updateFolder } from "@/lib/db/folders";
import { pushDirtyFolders } from "@/lib/sync/push";
import { startPullSync } from "@/lib/sync/pull";
import { getSyncConflicts } from "@/lib/db/syncConflicts";

// M3 spike route (spec.md subtask 12). Verifies lib/sync/pull.ts end-to-end
// against real Firestore + real SQLite, exercising every branch of
// decidePull(): plain insert (no local row), ordinary remote-is-newer
// overwrite, both flavors of the "both sides touched since last sync"
// conflict (remote-wins and local-wins), and a deletedAt tombstone pull.
// Signs in with a throwaway test account solely to satisfy firestore.rules
// (same pattern as app/spike-push/page.tsx) - "Delete test account + docs"
// below tears everything down again. Not production UI.

const TEST_EMAIL = "skylines-pull-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function SpikePull() {
  const [log, setLog] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [unsubscribe, setUnsubscribe] = useState<(() => void) | null>(null);
  // A plain local array here would get silently reset to empty on every
  // re-render - and `append()` (setLog) re-renders this component after
  // every single log line - so cleanup would never see anything pushed by
  // earlier renders. useRef persists across renders without itself
  // triggering one.
  const createdFolderIdsRef = useRef<string[]>([]);

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
      append("pull listener started");
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  async function runInsertCase() {
    if (!user) return append("sign in first");
    try {
      const remoteId = crypto.randomUUID();
      const now = Date.now();
      await setDoc(doc(db, "folders", remoteId), {
        name: "Remote-Only Folder",
        parentId: null,
        userId: user.uid,
        order: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      append(`wrote remote-only folder doc -> id=${remoteId} (no local row yet)`);

      await sleep(2000);
      const local = await getFolderRowById(remoteId);
      append(
        `local after pull: found=${!!local} name=${local?.name} dirty=${local?.dirty} syncedAt=${local?.syncedAt}`,
      );
      append(
        `INSERT CASE RESULT: ${local && local.name === "Remote-Only Folder" && local.dirty === false ? "PASS" : "FAIL"}`,
      );
      await deleteDoc(doc(db, "folders", remoteId));
    } catch (err) {
      append(`INSERT CASE FAILED: ${String(err)}`);
    }
  }

  async function runRemoteNewerOverwriteCase() {
    if (!user) return append("sign in first");
    try {
      const folderId = await createFolder(user.uid, "Local Folder (overwrite case)", null, 1);
      createdFolderIdsRef.current.push(folderId);
      await pushDirtyFolders(user.uid);
      const afterPush = await getFolderRowById(folderId);
      append(
        `created+pushed local folder -> id=${folderId} dirty=${afterPush?.dirty} updatedAt=${afterPush?.updatedAt}`,
      );

      await sleep(50);
      const remoteUpdatedAt = Date.now();
      await setDoc(
        doc(db, "folders", folderId),
        { name: "Remote Renamed (not dirty locally)", updatedAt: remoteUpdatedAt },
        { merge: true },
      );
      append(`wrote remote update directly -> updatedAt=${remoteUpdatedAt} (local NOT dirty)`);

      await sleep(2000);
      const local = await getFolderRowById(folderId);
      append(`local after pull: name=${local?.name} dirty=${local?.dirty}`);
      append(
        `REMOTE-NEWER OVERWRITE RESULT: ${local?.name === "Remote Renamed (not dirty locally)" && local?.dirty === false ? "PASS" : "FAIL"}`,
      );
    } catch (err) {
      append(`REMOTE-NEWER OVERWRITE CASE FAILED: ${String(err)}`);
    }
  }

  async function runConflictRemoteWinsCase() {
    if (!user) return append("sign in first");
    try {
      const folderId = await createFolder(user.uid, "Local Folder (conflict, remote wins)", null, 1);
      createdFolderIdsRef.current.push(folderId);
      await pushDirtyFolders(user.uid);
      const synced = await getFolderRowById(folderId);
      append(`created+pushed -> syncedAt=${synced?.syncedAt}`);

      await sleep(50);
      await updateFolder(folderId, { name: "Local Edit (should lose)" });
      const dirtyLocal = await getFolderRowById(folderId);
      append(`local edited (dirty, unpushed) -> updatedAt=${dirtyLocal?.updatedAt} dirty=${dirtyLocal?.dirty}`);

      // Remote write with updatedAt AFTER both syncedAt and the local edit's
      // updatedAt - both sides touched since last sync, and remote is the
      // later one, so remote should win.
      const remoteUpdatedAt = (dirtyLocal?.updatedAt ?? Date.now()) + 10_000;
      await setDoc(
        doc(db, "folders", folderId),
        { name: "Remote Edit (should win)", updatedAt: remoteUpdatedAt },
        { merge: true },
      );
      append(`wrote conflicting remote update -> updatedAt=${remoteUpdatedAt}`);

      await sleep(2000);
      const local = await getFolderRowById(folderId);
      const conflicts = await getSyncConflicts("folders", folderId);
      append(`local after pull: name=${local?.name} dirty=${local?.dirty}`);
      append(
        `sync_conflicts rows=${conflicts.length} losingData=${JSON.stringify(conflicts[0]?.losingData)}`,
      );
      const losing = conflicts[0]?.losingData as { name?: string } | undefined;
      append(
        `CONFLICT (remote wins) RESULT: ${
          local?.name === "Remote Edit (should win)" &&
          local?.dirty === false &&
          conflicts.length === 1 &&
          losing?.name === "Local Edit (should lose)"
            ? "PASS"
            : "FAIL"
        }`,
      );
    } catch (err) {
      append(`CONFLICT (remote wins) CASE FAILED: ${String(err)}`);
    }
  }

  async function runConflictLocalWinsCase() {
    if (!user) return append("sign in first");
    try {
      const folderId = await createFolder(user.uid, "Local Folder (conflict, local wins)", null, 1);
      createdFolderIdsRef.current.push(folderId);
      await pushDirtyFolders(user.uid);
      const synced = await getFolderRowById(folderId);
      append(`created+pushed -> syncedAt=${synced?.syncedAt}`);

      await sleep(200);
      await updateFolder(folderId, { name: "Local Edit (should win)" });
      const dirtyLocal = await getFolderRowById(folderId);
      append(`local edited (dirty, unpushed) -> updatedAt=${dirtyLocal?.updatedAt} dirty=${dirtyLocal?.dirty}`);

      // Remote write with updatedAt strictly between syncedAt and the local
      // edit's updatedAt - remote DID move since last sync (so this is
      // still a genuine conflict), but local's edit is the later one, so
      // local should win and stay dirty for a future push.
      const remoteUpdatedAt = Math.floor(((synced?.syncedAt ?? 0) + (dirtyLocal?.updatedAt ?? 0)) / 2);
      await setDoc(
        doc(db, "folders", folderId),
        { name: "Remote Edit (should lose)", updatedAt: remoteUpdatedAt },
        { merge: true },
      );
      append(`wrote conflicting remote update -> updatedAt=${remoteUpdatedAt}`);

      await sleep(2000);
      const local = await getFolderRowById(folderId);
      const conflicts = await getSyncConflicts("folders", folderId);
      append(`local after pull: name=${local?.name} dirty=${local?.dirty}`);
      append(
        `sync_conflicts rows=${conflicts.length} losingData=${JSON.stringify(conflicts[0]?.losingData)}`,
      );
      const losing = conflicts[0]?.losingData as { name?: string } | undefined;
      append(
        `CONFLICT (local wins) RESULT: ${
          local?.name === "Local Edit (should win)" &&
          local?.dirty === true &&
          conflicts.length === 1 &&
          losing?.name === "Remote Edit (should lose)"
            ? "PASS"
            : "FAIL"
        }`,
      );
    } catch (err) {
      append(`CONFLICT (local wins) CASE FAILED: ${String(err)}`);
    }
  }

  async function runTombstoneCase() {
    if (!user) return append("sign in first");
    try {
      const folderId = await createFolder(user.uid, "Local Folder (tombstone case)", null, 1);
      createdFolderIdsRef.current.push(folderId);
      await pushDirtyFolders(user.uid);
      append(`created+pushed local folder -> id=${folderId}`);

      await sleep(50);
      const remoteUpdatedAt = Date.now();
      await setDoc(
        doc(db, "folders", folderId),
        { deletedAt: remoteUpdatedAt, updatedAt: remoteUpdatedAt },
        { merge: true },
      );
      append(`wrote remote tombstone (deletedAt set) directly -> updatedAt=${remoteUpdatedAt}`);

      await sleep(2000);
      const local = await getFolderRowById(folderId);
      append(`local after pull: deletedAt=${local?.deletedAt} dirty=${local?.dirty}`);
      append(
        `TOMBSTONE RESULT: ${typeof local?.deletedAt === "number" && local?.dirty === false ? "PASS" : "FAIL"}`,
      );
    } catch (err) {
      append(`TOMBSTONE CASE FAILED: ${String(err)}`);
    }
  }

  async function cleanup() {
    try {
      if (unsubscribe) {
        unsubscribe();
        append("pull listener stopped");
      }
      for (const folderId of createdFolderIdsRef.current) {
        await deleteDoc(doc(db, "folders", folderId));
      }
      append(`deleted ${createdFolderIdsRef.current.length} test firestore folder docs`);

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
      <h1 className="text-2xl font-semibold">Spike Pull (lib/sync/pull)</h1>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in + start pull listener
        </button>
        <button onClick={() => void runInsertCase()} className="rounded bg-green-600 px-4 py-2 text-white">
          2. Insert case (remote-only)
        </button>
        <button onClick={() => void runRemoteNewerOverwriteCase()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Remote-newer overwrite
        </button>
        <button onClick={() => void runConflictRemoteWinsCase()} className="rounded bg-orange-600 px-4 py-2 text-white">
          4. Conflict (remote wins)
        </button>
        <button onClick={() => void runConflictLocalWinsCase()} className="rounded bg-orange-600 px-4 py-2 text-white">
          5. Conflict (local wins)
        </button>
        <button onClick={() => void runTombstoneCase()} className="rounded bg-purple-600 px-4 py-2 text-white">
          6. Tombstone pull
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          7. Cleanup (delete test data + user)
        </button>
      </div>
      <ul data-testid="spike-pull-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
