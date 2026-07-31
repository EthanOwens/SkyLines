"use client";

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { AuthProvider, useAuthContext } from "@/components/AuthProvider";
import { useFolders } from "@/hooks/useFolders";
import { useNotes } from "@/hooks/useNotes";
import { useAppStore } from "@/stores/appStore";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { createFolder as dbCreateFolder } from "@/lib/db/folders";
import { createNote as dbCreateNote } from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";

// spec.md subtask 16 verification route (M4 "sidebar"). Renders the real,
// ported Sidebar/FolderTree/FolderItem/NoteItem components wired against the
// SQLite-backed useFolders/useNotes hooks (subtask 15) and real Firebase
// Auth, so the sidebar's inline rename, create note/canvas/folder, per-folder
// context menu, and recursive delete (subtask 10) can be exercised end to
// end in a real browser. There is no app/login or app/home page yet (those
// land in later subtasks), so this route stands in as the host page - same
// pattern as app/spike-hooks/page.tsx, app/spike-engine/page.tsx. Signs in
// with a throwaway test account solely to satisfy firestore.rules for the
// sync engine wiring that starts once a user is present; this subtask's
// actual behavior under test is local-SQLite-driven. Cleanup deletes
// Firestore test docs BEFORE the auth account, always, and every created id
// is tracked in a ref (survives re-renders, not page reloads - do not reload
// mid-session). Not production UI.

const TEST_EMAIL = "skylines-sidebar-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

function SpikeSidebarInner() {
  const { user, loading } = useAuthContext();
  useFolders(user?.uid);
  useNotes(user?.uid);

  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);

  const [log, setLog] = useState<string[]>([]);
  const createdFolderIdsRef = useRef<Set<string>>(new Set());
  const createdNoteIdsRef = useRef<Set<string>>(new Set());

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

  // Creates a folder directly via lib/db (bypassing the Sidebar UI) to
  // sanity-check that the sidebar auto-updates off hooks/useFolders.ts's
  // change-notification wiring, per this subtask's verification section.
  async function createFolderDirectly() {
    if (!user) return append("sign in first");
    const notebookId = await getOrCreateDefaultNotebookId(user.uid);
    const id = await dbCreateFolder(user.uid, "Direct DB Folder", notebookId);
    createdFolderIdsRef.current.add(id);
    append(`created folder id=${id} directly via lib/db/folders.ts (not through the Sidebar UI)`);
  }

  async function createNoteDirectly() {
    if (!user) return append("sign in first");
    const id = await dbCreateNote(user.uid, "note", null, "Direct DB Note");
    createdNoteIdsRef.current.add(id);
    append(`created note id=${id} directly via lib/db/notes.ts (not through the Sidebar UI)`);
  }

  function recordAllCurrentIds() {
    // Tracks every folder/note currently in the store as "created by this
    // session" so Cleanup below removes anything made through the Sidebar UI
    // too (not just the direct-DB helpers above), surviving reloads by being
    // re-derivable from the store at any time rather than only from create
    // callbacks.
    const state = useAppStore.getState();
    for (const f of state.folders) createdFolderIdsRef.current.add(f.id);
    for (const n of state.notes) createdNoteIdsRef.current.add(n.id);
    append(
      `recorded current store contents for cleanup: folders=${createdFolderIdsRef.current.size} notes=${createdNoteIdsRef.current.size}`,
    );
  }

  async function cleanup() {
    try {
      recordAllCurrentIds();
      for (const id of createdFolderIdsRef.current) {
        await deleteDoc(doc(db, "folders", id)).catch(() => {});
      }
      append(`deleted ${createdFolderIdsRef.current.size} test firestore folder docs`);
      createdFolderIdsRef.current.clear();

      for (const id of createdNoteIdsRef.current) {
        await deleteDoc(doc(db, "notes", id)).catch(() => {});
      }
      append(`deleted ${createdNoteIdsRef.current.size} test firestore note docs`);
      createdNoteIdsRef.current.clear();

      await new Promise((r) => setTimeout(r, 200));

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
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-2 border-b border-border p-2 text-xs">
        <span data-testid="spike-sidebar-auth">
          loading={String(loading)} user={user?.uid ?? "null"}
        </span>
        <span data-testid="spike-sidebar-store">
          store: folders={folders.length} notes={notes.length}
        </span>
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-2 py-1 text-white">
          Sign in
        </button>
        <button onClick={() => void doSignOut()} className="rounded bg-teal-800 px-2 py-1 text-white">
          Sign out
        </button>
        <button onClick={() => void createFolderDirectly()} className="rounded bg-green-600 px-2 py-1 text-white">
          Create folder via lib/db (bypass UI)
        </button>
        <button onClick={() => void createNoteDirectly()} className="rounded bg-green-600 px-2 py-1 text-white">
          Create note via lib/db (bypass UI)
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-2 py-1 text-white">
          Cleanup (delete test data + user)
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {user ? (
          <Sidebar user={user} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Sign in to render the Sidebar.</div>
        )}
        <main className="flex-1 overflow-auto p-4">
          <p className="text-sm text-muted-foreground">
            Main content area placeholder (app/note, app/canvas pages are later subtasks).
          </p>
          <ul data-testid="spike-sidebar-log" className="mt-4 max-w-3xl text-xs">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}

export default function SpikeSidebarPage() {
  return (
    <AuthProvider>
      <SpikeSidebarInner />
    </AuthProvider>
  );
}
