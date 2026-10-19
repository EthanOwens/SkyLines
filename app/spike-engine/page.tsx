"use client";

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { createFolder, getFolderRowById } from "@/lib/db/folders";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import {
  flushDirtyPush,
  getSyncStatus,
  scheduleDirtyPush,
  startSyncEngine,
  subscribeSyncStatus,
} from "@/lib/sync/engine";
import type { SyncStatus } from "@/types";

// Dev-only verification page for lib/sync/engine.ts against real Firestore and
// SQLite. Not production UI.
//
// navigator.onLine and document.visibilityState are overridden on this page and
// the matching events dispatched by hand, which tests the engine's listeners
// rather than real connectivity.

const TEST_EMAIL = "skylines-engine-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

function setDocumentVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  Object.defineProperty(document, "hidden", { value: value === "hidden", configurable: true });
}

export default function SpikeEngine() {
  const [log, setLog] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const createdFolderIdsRef = useRef<string[]>([]);
  const engineTeardownRef = useRef<(() => void) | null>(null);

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

  function startEngine() {
    if (!user) return append("sign in first");
    if (engineTeardownRef.current) return append("engine already running");
    engineTeardownRef.current = startSyncEngine(user.uid);
    setEngineRunning(true);
    append(`engine started -> syncStatus=${getSyncStatus()}`);
  }

  function stopEngine() {
    engineTeardownRef.current?.();
    engineTeardownRef.current = null;
    setEngineRunning(false);
    append("engine stopped");
  }

  /**
   * Rapid scheduleDirtyPush calls must coalesce into one push. Runs with the
   * engine stopped so pull can't cause status changes.
   */
  async function runDebounceTest() {
    if (!user) return append("sign in first");
    if (engineRunning) return append("stop the engine first (this test needs push in isolation)");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "Debounce test folder", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderId);
      append(`created dirty folder id=${folderId}`);

      let syncingCount = 0;
      let savedCount = 0;
      const unsub = subscribeSyncStatus((s: SyncStatus) => {
        if (s === "syncing") syncingCount++;
        if (s === "saved") savedCount++;
      });

      for (let i = 0; i < 5; i++) {
        scheduleDirtyPush(user.uid);
        await sleep(400);
      }
      append("called scheduleDirtyPush 5x over ~2s (debounce window is 10s)");

      await sleep(13_000); // past the 10s debounce window, plus margin
      unsub();

      const folder = await getFolderRowById(folderId);
      append(
        `after wait: syncingCount=${syncingCount} savedCount=${savedCount} folder.dirty=${folder?.dirty} folder.syncedAt=${folder?.syncedAt}`,
      );
      const pass =
        syncingCount === 1 && savedCount === 1 && folder?.dirty === false && folder?.syncedAt !== null;
      append(`DEBOUNCE TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`DEBOUNCE TEST FAILED: ${String(err)}`);
    }
  }

  /**
   * A push scheduled while offline stays pending, then retries immediately when
   * the browser comes back online.
   */
  async function runOfflineReconnectTest() {
    if (!user) return append("sign in first");
    if (!engineRunning) return append("start the engine first (this test needs the online/offline listeners)");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "Offline test folder", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderId);
      append(`created dirty folder id=${folderId}`);

      setNavigatorOnLine(false);
      window.dispatchEvent(new Event("offline"));
      await sleep(100);
      append(`dispatched offline event -> syncStatus=${getSyncStatus()}`);

      scheduleDirtyPush(user.uid);
      await sleep(11_000); // past the 10s debounce window while still offline
      const folderWhileOffline = await getFolderRowById(folderId);
      append(
        `after debounce window while offline -> syncStatus=${getSyncStatus()} folder.dirty=${folderWhileOffline?.dirty}`,
      );

      setNavigatorOnLine(true);
      window.dispatchEvent(new Event("online"));
      await sleep(2500);
      const folderAfterReconnect = await getFolderRowById(folderId);
      append(
        `after online event -> syncStatus=${getSyncStatus()} folder.dirty=${folderAfterReconnect?.dirty} folder.syncedAt=${folderAfterReconnect?.syncedAt}`,
      );

      const pass =
        folderWhileOffline?.dirty === true &&
        folderAfterReconnect?.dirty === false &&
        folderAfterReconnect?.syncedAt !== null &&
        getSyncStatus() === "saved";
      append(`OFFLINE + RECONNECT TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`OFFLINE + RECONNECT TEST FAILED: ${String(err)}`);
    }
  }

  /** Becoming visible again triggers the same immediate retry as reconnecting. */
  async function runAppResumeTest() {
    if (!user) return append("sign in first");
    if (!engineRunning) return append("start the engine first (this test needs the visibilitychange listener)");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "App-resume test folder", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderId);
      append(`created dirty folder id=${folderId}`);

      setNavigatorOnLine(false);
      window.dispatchEvent(new Event("offline"));
      await sleep(100);
      scheduleDirtyPush(user.uid);
      await sleep(500);
      append(`pending push queued while offline -> syncStatus=${getSyncStatus()}`);

      setNavigatorOnLine(true); // connectivity is back, but only a resume event says so
      setDocumentVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await sleep(2500);

      const folder = await getFolderRowById(folderId);
      append(`after visibilitychange(visible) resume -> syncStatus=${getSyncStatus()} folder.dirty=${folder?.dirty}`);
      const pass = folder?.dirty === false && folder?.syncedAt !== null;
      append(`APP-RESUME RETRY TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`APP-RESUME RETRY TEST FAILED: ${String(err)}`);
    }
  }

  /**
   * Regression check: a push requested while another is in flight must not be
   * dropped. Fails if status reads "saved" while folder B is still dirty.
   */
  async function runMidFlightPushTest() {
    if (!user) return append("sign in first");
    try {
      const uid = user.uid;
      const notebookId = await getOrCreateDefaultNotebookId(uid);
      const folderIdA = await createFolder(uid, "Mid-flight A", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderIdA);
      append(`created dirty folder A id=${folderIdA}`);

      flushDirtyPush(uid); // starts push #1 for A, not awaited
      append(`flushed push #1 (for A) -> syncStatus=${getSyncStatus()}`);

      const folderIdB = await createFolder(uid, "Mid-flight B", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderIdB);
      append(`created dirty folder B id=${folderIdB} while push #1 should still be in flight`);

      flushDirtyPush(uid); // request #2 (for B), arrives mid-flight
      append(`flushed push #2 (for B) mid-flight -> syncStatus=${getSyncStatus()}`);

      let sawSavedWhileBDirty = false;
      const deadline = Date.now() + 10_000;
      let folderB = await getFolderRowById(folderIdB);
      while (Date.now() < deadline && folderB?.dirty !== false) {
        const status = getSyncStatus();
        if (status === "saved" && folderB?.dirty === true) {
          sawSavedWhileBDirty = true;
          append(`FAIL CONDITION: observed syncStatus=saved while folder B still dirty (t=${Date.now()})`);
          break;
        }
        await sleep(150);
        folderB = await getFolderRowById(folderIdB);
      }

      await sleep(1000); // let status settle
      const folderA = await getFolderRowById(folderIdA);
      folderB = await getFolderRowById(folderIdB);
      append(
        `final -> syncStatus=${getSyncStatus()} A.dirty=${folderA?.dirty} B.dirty=${folderB?.dirty} B.syncedAt=${folderB?.syncedAt}`,
      );

      const pass =
        !sawSavedWhileBDirty &&
        folderA?.dirty === false &&
        folderB?.dirty === false &&
        folderB?.syncedAt !== null &&
        getSyncStatus() === "saved";
      append(`MID-FLIGHT PUSH TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`MID-FLIGHT PUSH TEST FAILED: ${String(err)}`);
    }
  }

  /**
   * Signing out makes Firestore reject the push with a real error; the backoff
   * retry must then succeed after signing back in.
   */
  async function runBackoffRetryTest() {
    if (!user) return append("sign in first");
    try {
      const notebookId = await getOrCreateDefaultNotebookId(user.uid);
      const folderId = await createFolder(user.uid, "Backoff test folder", notebookId, null, 1);
      createdFolderIdsRef.current.push(folderId);
      const uid = user.uid;
      append(`created dirty folder id=${folderId} (uid=${uid})`);

      const transitions: string[] = [];
      const unsub = subscribeSyncStatus((s: SyncStatus) => transitions.push(s));

      await signOut(auth);
      append("signed out test user (push will now fail with permission-denied)");

      flushDirtyPush(uid);
      await sleep(1500);
      append(`after first (failing) attempt -> syncStatus=${getSyncStatus()} transitions=${JSON.stringify(transitions)}`);

      await sleep(8000); // covers the 2s and 4s backoff retries, both still failing
      append(`after ~9.5s (2s+4s backoff retries elapsed) -> syncStatus=${getSyncStatus()} transitions=${JSON.stringify(transitions)}`);

      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      } catch {
        cred = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      }
      setUser(cred.user);
      append(`signed back in -> userId=${cred.user.uid} (matches original: ${cred.user.uid === uid})`);

      await sleep(10_000); // covers the next scheduled backoff retry (~8s out), now able to succeed
      unsub();

      const folder = await getFolderRowById(folderId);
      append(`final -> syncStatus=${getSyncStatus()} folder.dirty=${folder?.dirty} folder.syncedAt=${folder?.syncedAt}`);
      append(`all status transitions observed: ${JSON.stringify(transitions)}`);

      const sawError = transitions.includes("error");
      const pass =
        sawError && folder?.dirty === false && folder?.syncedAt !== null && getSyncStatus() === "saved";
      append(`BACKOFF/RETRY TEST RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`BACKOFF/RETRY TEST FAILED: ${String(err)}`);
    }
  }

  async function cleanup() {
    try {
      stopEngine();
      setNavigatorOnLine(true);

      for (const folderId of createdFolderIdsRef.current) {
        await deleteDoc(doc(db, "folders", folderId)).catch(() => {});
      }
      append(`deleted ${createdFolderIdsRef.current.length} test firestore folder docs`);
      createdFolderIdsRef.current = [];

      await sleep(200);

      if (auth.currentUser) {
        await auth.currentUser.delete();
        append("deleted test auth user");
      } else if (user) {
        // The backoff test can leave the account signed out; sign in so it can
        // still be deleted.
        const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
        await cred.user.delete();
        append("re-signed-in and deleted test auth user");
      }
      setUser(null);
    } catch (err) {
      append(`CLEANUP FAILED (delete test data/user manually): ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Engine (lib/sync/engine)</h1>
      <p className="text-sm">
        current syncStatus (poll manually): <span data-testid="spike-engine-status">{getSyncStatus()}</span>
      </p>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={() => void runDebounceTest()} className="rounded bg-green-600 px-4 py-2 text-white">
          2. Debounced push test (engine must be stopped)
        </button>
        <button onClick={startEngine} className="rounded bg-teal-600 px-4 py-2 text-white">
          3. Start engine
        </button>
        <button onClick={() => void runOfflineReconnectTest()} className="rounded bg-orange-600 px-4 py-2 text-white">
          4. Offline + reconnect test
        </button>
        <button onClick={() => void runAppResumeTest()} className="rounded bg-orange-600 px-4 py-2 text-white">
          5. App-resume retry test
        </button>
        <button onClick={() => void runBackoffRetryTest()} className="rounded bg-purple-600 px-4 py-2 text-white">
          6. Backoff/retry test (genuine failure)
        </button>
        <button onClick={() => void runMidFlightPushTest()} className="rounded bg-pink-600 px-4 py-2 text-white">
          7. Mid-flight push test (bug fix)
        </button>
        <button onClick={stopEngine} className="rounded bg-teal-800 px-4 py-2 text-white">
          8. Stop engine
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          9. Cleanup (delete test data + user)
        </button>
      </div>
      <ul data-testid="spike-engine-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
