"use client";

// Dev-only verification page for the canvas editor and sync. Not production UI.
//
// Starts the sync engine directly rather than through useSyncEngine, whose
// unmount cleanup would stop it as soon as this page navigates to /canvas. It
// also forwards local writes to scheduleDirtyPush, as useSyncEngine does.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { AuthProvider, useAuthContext } from "@/components/AuthProvider";
import { getSyncStatus, scheduleDirtyPush, startSyncEngine, subscribeSyncStatus } from "@/lib/sync/engine";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";
import { createNote, getNoteById } from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";

const TEST_EMAIL = "skylines-canvas-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function SpikeCanvasInner() {
  const { user, loading } = useAuthContext();
  const router = useRouter();

  const [log, setLog] = useState<string[]>([]);
  const [manualId, setManualId] = useState("");
  const [engineStarted, setEngineStarted] = useState(false);
  const createdNoteIdsRef = useRef<Set<string>>(new Set());
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
      append(`signed in -> userId=${cred.user.uid}`);
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  async function doSignOut() {
    await signOut(auth);
    append("signed out");
  }

  function startEngine() {
    if (!user) return append("sign in first");
    if (engineTeardownRef.current) return append("engine already running");
    const uid = user.uid;
    useAppStore.getState().setSyncStatus(getSyncStatus());
    const unsubStatus = subscribeSyncStatus((s) => useAppStore.getState().setSyncStatus(s));
    const unsubDataChange = subscribeDataChange((origin) => {
      if (origin === "local") scheduleDirtyPush(uid);
    });
    const stopEngine = startSyncEngine(uid);
    engineTeardownRef.current = () => {
      unsubDataChange();
      unsubStatus();
      stopEngine();
    };
    setEngineStarted(true);
    append(`sync engine started (survives navigation to /canvas) -> syncStatus=${getSyncStatus()}`);
  }

  function stopEngine() {
    engineTeardownRef.current?.();
    engineTeardownRef.current = null;
    setEngineStarted(false);
    append("sync engine stopped");
  }

  async function createAndOpenCanvas() {
    if (!user) return append("sign in first");
    const notebookId = await getOrCreateDefaultNotebookId(user.uid);
    const id = await createNote(user.uid, "canvas", notebookId, null, "Spike Canvas Note");
    createdNoteIdsRef.current.add(id);
    setManualId(id);
    append(`created canvas note id=${id} directly via lib/db/notes.ts, navigating to /canvas?id=${id}`);
    router.push(`/canvas?id=${id}`);
  }

  function openManualId() {
    if (!manualId) return append("enter a note id first");
    append(`navigating to /canvas?id=${manualId}`);
    router.push(`/canvas?id=${manualId}`);
  }

  async function inspectNote() {
    if (!manualId) return append("enter a note id first");
    const n = await getNoteById(manualId);
    append(`getNoteById(${manualId}) -> ${JSON.stringify(n)}`);
  }

  // Created ids live in memory and are lost on a hard reload; this lets an id
  // from an earlier session still be cleaned up.
  function trackManualIdForCleanup() {
    if (!manualId) return append("enter a note id first");
    createdNoteIdsRef.current.add(manualId);
    append(`manually tracked id=${manualId} for cleanup (survives this page's own reloads)`);
  }

  function recordAllCreatedIds() {
    append(`tracked note ids for cleanup: ${JSON.stringify([...createdNoteIdsRef.current])}`);
  }

  async function cleanup() {
    try {
      stopEngine();
      recordAllCreatedIds();
      for (const id of createdNoteIdsRef.current) {
        await deleteDoc(doc(db, "notes", id)).catch(() => {});
      }
      append(`deleted ${createdNoteIdsRef.current.size} test firestore note docs`);
      createdNoteIdsRef.current.clear();

      await new Promise((r) => setTimeout(r, 200));

      try {
        if (auth.currentUser) {
          await auth.currentUser.delete();
          append("deleted test auth user");
        } else {
          const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
          await cred.user.delete();
          append("re-signed-in and deleted test auth user");
        }
      } catch (err) {
        // An old sign-in can trigger auth/requires-recent-login on account
        // deletion, so sign in again and retry.
        append(`initial delete-user attempt failed (${String(err)}), re-signing in for a fresh credential and retrying`);
        const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
        await cred.user.delete();
        append("re-signed-in with fresh credential and deleted test auth user");
      }
    } catch (err) {
      append(`CLEANUP FAILED (delete test data/user manually): ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Canvas (app/canvas/page.tsx)</h1>
      <p className="text-sm" data-testid="spike-canvas-auth">
        loading={String(loading)} user={user?.uid ?? "null"} engineStarted={String(engineStarted)}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={startEngine} className="rounded bg-teal-600 px-4 py-2 text-white">
          2. Start sync engine (survives nav to /canvas)
        </button>
        <button onClick={() => void createAndOpenCanvas()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Create canvas note + navigate to /canvas?id=
        </button>
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="note id"
          className="rounded border border-border px-2 py-1 text-sm"
          data-testid="spike-canvas-manual-id"
        />
        <button onClick={openManualId} className="rounded bg-indigo-600 px-4 py-2 text-white">
          4. Navigate to /canvas?id=&lt;above&gt;
        </button>
        <button onClick={() => void inspectNote()} className="rounded bg-purple-600 px-4 py-2 text-white">
          5. Inspect via getNoteById
        </button>
        <button onClick={trackManualIdForCleanup} className="rounded bg-amber-600 px-4 py-2 text-white">
          6. Track id above for cleanup
        </button>
        <button onClick={() => void doSignOut()} className="rounded bg-teal-800 px-4 py-2 text-white">
          6. Sign out
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          7. Cleanup (delete test data + user, stops engine)
        </button>
      </div>
      <ul data-testid="spike-canvas-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SpikeCanvasPage() {
  return (
    <AuthProvider>
      <SpikeCanvasInner />
    </AuthProvider>
  );
}
