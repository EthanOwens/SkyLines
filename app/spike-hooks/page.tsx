"use client";

import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { AuthProvider, useAuthContext } from "@/components/AuthProvider";
import { useAuth } from "@/hooks/useAuth";
import { useFolders } from "@/hooks/useFolders";
import { useNotes } from "@/hooks/useNotes";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useAppStore } from "@/stores/appStore";
import { createFolder, getFolderRowById } from "@/lib/db/folders";
import { createNote } from "@/lib/db/notes";
import { getSyncStatus } from "@/lib/sync/engine";

// spec.md subtask 15 verification route (M4 "auth + data hooks rewire").
// Exercises the whole rewired data layer end-to-end against real Firestore +
// real SQLite: AuthProvider/useAuth, useFolders/useNotes now reading from
// lib/db/folders.ts/notes.ts instead of Firestore onSnapshot,
// lib/db/events.ts's change-notification driving automatic store updates,
// useSyncEngine wiring lib/sync/engine.ts into lifecycle (start on sign-in,
// stop on sign-out, syncStatus mirrored into stores/appStore.ts), and the
// "local write schedules a push, remote-origin write does not" distinction
// (no manual scheduleDirtyPush/pushDirtyRows call anywhere in this file -
// every push observed here must come from the real wiring). Signs in with a
// throwaway test account solely to satisfy firestore.rules (same pattern as
// app/spike-engine/page.tsx, app/spike-pull/page.tsx) - cleanup deletes
// Firestore test docs BEFORE the auth account, always. Not production UI.

const TEST_EMAIL = "skylines-hooks-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function SpikeHooksInner() {
  const { user, loading } = useAuthContext();
  const viaHook = useAuth(); // independent onAuthStateChanged listener, should always agree with the context

  useFolders(user?.uid);
  useNotes(user?.uid);
  useSyncEngine(user?.uid);

  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);
  const syncStatus = useAppStore((s) => s.syncStatus);

  const [log, setLog] = useState<string[]>([]);
  const createdFolderIdsRef = useRef<string[]>([]);
  const createdNoteIdsRef = useRef<string[]>([]);
  const lastUidRef = useRef<string | null>(null);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  useEffect(() => {
    if (user?.uid) lastUidRef.current = user.uid;
  }, [user?.uid]);

  async function signIn() {
    try {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      } catch {
        cred = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      }
      append(`signed in -> userId=${cred.user.uid}`);
      append(`AUTH RESULT: ${cred.user.uid ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  async function doSignOut() {
    await signOut(auth);
    append("signed out (AuthProvider/useAuth should both report user=null; useSyncEngine's effect should tear the engine down)");
  }

  async function createTestFolder() {
    if (!user) return append("sign in first");
    const id = await createFolder(user.uid, "Spike Hooks Folder", null, 1);
    createdFolderIdsRef.current.push(id);
    append(`created LOCAL folder id=${id} via lib/db/folders.ts createFolder only (no scheduleDirtyPush call here)`);
  }

  async function createTestNote() {
    if (!user) return append("sign in first");
    const id = await createNote(user.uid, "note", null, "Spike Hooks Note");
    createdNoteIdsRef.current.push(id);
    append(`created LOCAL note id=${id} via lib/db/notes.ts createNote only (no scheduleDirtyPush call here)`);
  }

  /** Polls the store directly (bypassing this component's own render cycle)
   * to confirm useFolders/useNotes re-fetched automatically off the
   * lib/db/events.ts change-notification, with no manual re-fetch call from
   * this test. */
  async function checkStoreAutoUpdated() {
    if (createdFolderIdsRef.current.length === 0 && createdNoteIdsRef.current.length === 0) {
      return append("create a local folder/note first");
    }
    const deadline = Date.now() + 5000;
    let foldersOk = false;
    let notesOk = false;
    while (Date.now() < deadline) {
      const state = useAppStore.getState();
      foldersOk = createdFolderIdsRef.current.every((id) => state.folders.some((f) => f.id === id));
      notesOk = createdNoteIdsRef.current.every((id) => state.notes.some((n) => n.id === id));
      if (foldersOk && notesOk) break;
      await sleep(200);
    }
    const state = useAppStore.getState();
    append(`store now: folders=${state.folders.length} notes=${state.notes.length}`);
    append(`STORE AUTO-UPDATE RESULT: ${foldersOk && notesOk ? "PASS" : "FAIL"}`);
  }

  /** Confirms a local create actually reaches Firestore automatically -
   * never calling scheduleDirtyPush/pushDirtyRows/flushDirtyPush from this
   * test code, only relying on useSyncEngine's real wiring (step 7). */
  async function checkAutoPush() {
    if (createdFolderIdsRef.current.length === 0) return append("create a local folder first");
    const folderId = createdFolderIdsRef.current[createdFolderIdsRef.current.length - 1];
    append(`polling Firestore for folder ${folderId} (debounce window is 10s, max-wait 15s) - waiting only, no manual push call...`);
    const deadline = Date.now() + 18000;
    let found = false;
    let localDirty: boolean | undefined;
    while (Date.now() < deadline) {
      const snap = await getDoc(doc(db, "folders", folderId));
      const local = await getFolderRowById(folderId);
      localDirty = local?.dirty;
      if (snap.exists() && local?.dirty === false) {
        found = true;
        break;
      }
      await sleep(1000);
    }
    append(`AUTO-PUSH RESULT: ${found ? "PASS" : "FAIL"} (firestoreDocExists=${found}, local.dirty=${localDirty})`);
  }

  /** Confirms pulling a remote-only change does NOT get redundantly
   * re-pushed as if it were a new local dirty write: writes a doc directly
   * to Firestore, confirms it lands locally (dirty=false, since
   * upsertFolderFromRemote sets dirty=false and notifies "remote", which
   * useSyncEngine's subscriber explicitly does NOT forward to
   * scheduleDirtyPush), then waits past a full debounce+max-wait cycle and
   * re-checks that the row is still not dirty and Firestore's document is
   * untouched (same updatedAt as originally written). */
  async function runRemoteWriteNoLoopTest() {
    if (!user) return append("sign in first");
    try {
      const remoteId = crypto.randomUUID();
      const now = Date.now();
      await setDoc(doc(db, "folders", remoteId), {
        name: "Spike Hooks Remote-Only Folder",
        parentId: null,
        userId: user.uid,
        order: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      createdFolderIdsRef.current.push(remoteId);
      append(`wrote REMOTE-ONLY folder doc directly to Firestore -> id=${remoteId} updatedAt=${now}`);

      await sleep(2500);
      const localAfterPull = await getFolderRowById(remoteId);
      append(`local after pull lands it: found=${!!localAfterPull} name=${localAfterPull?.name} dirty=${localAfterPull?.dirty}`);

      append("waiting 18s (past debounce+max-wait) to confirm no push-loop schedules a re-push of this remote-origin row...");
      await sleep(18000);
      const localAfterWait = await getFolderRowById(remoteId);
      const remoteAfterWait = await getDoc(doc(db, "folders", remoteId));
      const remoteUpdatedAtAfterWait = remoteAfterWait.data()?.updatedAt;
      append(
        `after settle: local.dirty=${localAfterWait?.dirty} remote.updatedAt unchanged=${remoteUpdatedAtAfterWait === now} (was ${now}, now ${remoteUpdatedAtAfterWait})`,
      );

      const pass =
        localAfterPull?.dirty === false &&
        localAfterWait?.dirty === false &&
        remoteUpdatedAtAfterWait === now;
      append(`NO PUSH-LOOP RESULT: ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`NO PUSH-LOOP TEST FAILED: ${String(err)}`);
    }
  }

  /** Confirms the engine actually stopped on sign-out: creates a local dirty
   * row using the last known uid (auth.currentUser is null post-signout, so
   * this simulates "an edit happened right after teardown"), waits past a
   * full debounce+max-wait window, and confirms it was NOT auto-pushed -
   * proving useSyncEngine's teardown (and its scheduleDirtyPush wiring)
   * really stopped rather than lingering. Checks ONLY the local `dirty`
   * flag (via lib/db/folders.ts, not a Firestore read): a successful push
   * is the only thing that ever flips `dirty` back to false
   * (markFolderSynced), so `dirty` staying true is sufficient proof no push
   * happened - reading Firestore itself isn't needed, and firestore.rules
   * denies reads while signed out anyway (`request.auth != null`), which
   * would make a `getDoc` call here throw instead of proving anything. */
  async function checkEngineStoppedAfterSignout() {
    if (!lastUidRef.current) return append("sign in (and out) at least once first");
    if (auth.currentUser) return append("sign out first - engine is still running for the current session");
    const uid = lastUidRef.current;
    const id = await createFolder(uid, "Post-signout folder", null, 1);
    createdFolderIdsRef.current.push(id);
    append(`created LOCAL folder id=${id} for uid=${uid} AFTER sign-out (engine + its push wiring should be torn down)`);
    append(`getSyncStatus() right after teardown = ${getSyncStatus()}`);

    await sleep(18000);
    const local = await getFolderRowById(id);
    append(`after 18s post-signout: local.dirty=${local?.dirty} (still true means never pushed - markFolderSynced never ran)`);
    const pass = local?.dirty === true;
    append(`ENGINE STOPPED ON SIGN-OUT RESULT: ${pass ? "PASS" : "FAIL"}`);
  }

  async function cleanup() {
    try {
      for (const id of createdFolderIdsRef.current) {
        await deleteDoc(doc(db, "folders", id)).catch(() => {});
      }
      append(`deleted ${createdFolderIdsRef.current.length} test firestore folder docs`);
      createdFolderIdsRef.current = [];

      for (const id of createdNoteIdsRef.current) {
        await deleteDoc(doc(db, "notes", id)).catch(() => {});
      }
      append(`deleted ${createdNoteIdsRef.current.length} test firestore note docs`);
      createdNoteIdsRef.current = [];

      await sleep(200);

      if (auth.currentUser) {
        await auth.currentUser.delete();
        append("deleted test auth user");
      } else {
        try {
          const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
          await cred.user.delete();
          append("re-signed-in and deleted test auth user");
        } catch {
          append("no signed-in session and re-sign-in failed - test account may already be gone");
        }
      }
    } catch (err) {
      append(`CLEANUP FAILED (delete test data/user manually): ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Hooks (auth + data hooks rewire)</h1>
      <p className="text-sm" data-testid="spike-hooks-auth">
        context: loading={String(loading)} user={user?.uid ?? "null"} email={user?.email ?? "null"} | via-hook: loading=
        {String(viaHook.loading)} user={viaHook.user?.uid ?? "null"} | agree={String((user?.uid ?? null) === (viaHook.user?.uid ?? null))}
      </p>
      <p className="text-sm" data-testid="spike-hooks-store">
        store: folders={folders.length} notes={notes.length} syncStatus={syncStatus} (raw engine status={getSyncStatus()})
      </p>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={() => void createTestFolder()} className="rounded bg-green-600 px-4 py-2 text-white">
          2. Create local folder
        </button>
        <button onClick={() => void createTestNote()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Create local note
        </button>
        <button onClick={() => void checkStoreAutoUpdated()} className="rounded bg-teal-600 px-4 py-2 text-white">
          4. Check store auto-updated
        </button>
        <button onClick={() => void checkAutoPush()} className="rounded bg-purple-600 px-4 py-2 text-white">
          5. Check auto-push (no manual call)
        </button>
        <button onClick={() => void runRemoteWriteNoLoopTest()} className="rounded bg-orange-600 px-4 py-2 text-white">
          6. Remote write -&gt; no push-loop
        </button>
        <button onClick={() => void doSignOut()} className="rounded bg-teal-800 px-4 py-2 text-white">
          7. Sign out
        </button>
        <button onClick={() => void checkEngineStoppedAfterSignout()} className="rounded bg-pink-600 px-4 py-2 text-white">
          8. Check engine stopped after sign-out
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          9. Cleanup (delete test data + user)
        </button>
      </div>
      <ul data-testid="spike-hooks-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SpikeHooksPage() {
  return (
    <AuthProvider>
      <SpikeHooksInner />
    </AuthProvider>
  );
}
