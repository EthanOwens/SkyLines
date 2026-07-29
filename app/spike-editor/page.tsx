"use client";

// spec.md subtask 17 verification route (M4 "rich text editor"). There is no
// app shell/login/home page yet (out of scope for this subtask, see
// spec.md's "Background" note), so this route stands in as a launcher for
// app/note/page.tsx - same pattern as app/spike-sidebar/page.tsx,
// app/spike-engine/page.tsx. Creates a note directly via
// lib/db/notes.ts's `createNote` and navigates to `/note?id=<id>` so the
// real RichTextEditor/EditorToolbar can be exercised end to end (typing,
// title blur, formatting buttons, sync status badge). Signs in with a
// throwaway test account solely to satisfy firestore.rules for the sync
// engine. Cleanup deletes Firestore test docs BEFORE the auth account,
// always, and every created id is tracked in a ref (survives
// re-renders/re-navigations within the app, not full page reloads - do not
// hard-reload mid-session before cleaning up). Not production UI.
//
// Deliberately calls lib/sync/engine.ts's `startSyncEngine`/
// `subscribeSyncStatus` directly here instead of via hooks/useSyncEngine.ts:
// that hook ties the engine's lifetime to this component's mount (its
// `useEffect` cleanup stops the engine on unmount), which would tear the
// engine down the instant "Create note + navigate" below navigates away to
// /note - the opposite of what this verification needs, since the whole
// point is watching the real toolbar sync badge react to push activity
// WHILE looking at /note. The engine itself (lib/sync/engine.ts) is a
// module-level singleton independent of any component tree, so starting it
// imperatively and never tearing it down for the rest of this verification
// session keeps it running across the SPA navigation to /note, same as it
// would once a real app shell wires it at the root. `subscribeSyncStatus`
// is bridged straight into stores/appStore.ts's `setSyncStatus` here so
// every page reading `useAppStore((s) => s.syncStatus)` - including
// EditorToolbar's `SyncStatus` on /note - sees the same real status. Also
// replicates hooks/useSyncEngine.ts's OTHER responsibility - subscribing to
// lib/db/events.ts's change notification and calling `scheduleDirtyPush` for
// `origin === "local"` writes - which is what turns edits made later on
// /note (typing, title blur) into scheduled pushes; `startSyncEngine` on its
// own only pushes what's already dirty at the moment it starts.

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

const TEST_EMAIL = "skylines-editor-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function SpikeEditorInner() {
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
    append(`sync engine started (survives navigation to /note) -> syncStatus=${getSyncStatus()}`);
  }

  function stopEngine() {
    engineTeardownRef.current?.();
    engineTeardownRef.current = null;
    setEngineStarted(false);
    append("sync engine stopped");
  }

  async function createAndOpenNote() {
    if (!user) return append("sign in first");
    const id = await createNote(user.uid, "note", null, "Spike Editor Note");
    createdNoteIdsRef.current.add(id);
    setManualId(id);
    append(`created note id=${id} directly via lib/db/notes.ts, navigating to /note?id=${id}`);
    router.push(`/note?id=${id}`);
  }

  function openManualId() {
    if (!manualId) return append("enter a note id first");
    append(`navigating to /note?id=${manualId}`);
    router.push(`/note?id=${manualId}`);
  }

  async function inspectNote() {
    if (!manualId) return append("enter a note id first");
    const n = await getNoteById(manualId);
    append(`getNoteById(${manualId}) -> ${JSON.stringify(n)}`);
  }

  // Manual escape hatch: this page's own "created ids" tracking is
  // in-memory React state, which a hard page reload (e.g. testing a direct
  // /note?id= URL reload, per this subtask's verification section) wipes
  // out. Lets a note id created in an earlier, now-reloaded session still be
  // included in Cleanup below instead of silently leaking a Firestore test
  // doc.
  function trackManualIdForCleanup() {
    if (!manualId) return append("enter a note id first");
    createdNoteIdsRef.current.add(manualId);
    append(`manually tracked id=${manualId} for cleanup (survives this page's own reloads)`);
  }

  function recordAllCreatedIds() {
    // manualId may reference a note created in a prior render/navigation
    // that wasn't tracked (e.g. user typed an id manually) - only the ids
    // this session actually created via createAndOpenNote are tracked, which
    // is what cleanup below relies on.
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
        // A long-lived CDP-driven session's sign-in can be old enough that
        // Firebase Auth requires a fresh credential before allowing account
        // deletion (`auth/requires-recent-login`) - re-sign-in once more
        // with a fresh credential and retry, instead of leaving the
        // throwaway account behind.
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
      <h1 className="text-2xl font-semibold">Spike Editor (app/note/page.tsx)</h1>
      <p className="text-sm" data-testid="spike-editor-auth">
        loading={String(loading)} user={user?.uid ?? "null"} engineStarted={String(engineStarted)}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={startEngine} className="rounded bg-teal-600 px-4 py-2 text-white">
          2. Start sync engine (survives nav to /note)
        </button>
        <button onClick={() => void createAndOpenNote()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Create note + navigate to /note?id=
        </button>
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="note id"
          className="rounded border border-border px-2 py-1 text-sm"
          data-testid="spike-editor-manual-id"
        />
        <button onClick={openManualId} className="rounded bg-indigo-600 px-4 py-2 text-white">
          4. Navigate to /note?id=&lt;above&gt;
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
      <ul data-testid="spike-editor-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SpikeEditorPage() {
  return (
    <AuthProvider>
      <SpikeEditorInner />
    </AuthProvider>
  );
}
