"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { createFolder, getFolderById } from "@/lib/db/folders";
import { createNote, getNoteById, updateNote } from "@/lib/db/notes";
import { pushDirtyRows } from "@/lib/sync/push";

// M3 spike route (spec.md subtask 11). Verifies lib/sync/push.ts end-to-end:
// sign in (Firestore's rules require request.auth.uid == userId - see
// ../note_taking_app/firestore.rules - and this repo has no auth flow yet,
// so this route signs in with a throwaway test account solely to exercise
// the push path), create dirty local rows, push them, then read the
// Firestore docs back with getDoc() and re-read the local rows to confirm
// dirty/syncedAt got cleared. Not production UI - a throwaway verification
// harness, same pattern as app/spike-db/page.tsx.
export default function SpikePush() {
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runPushRoundTrip() {
    try {
      const email = "skylines-push-verify@example.com";
      const password = "TestPassword123!";
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userId = cred.user.uid;
      append(`signed in -> userId=${userId}`);

      const folderId = await createFolder(userId, "Push Spike Folder", null, 1);
      const noteId = await createNote(userId, "note", null, "Push Spike Note");
      append(`created local rows -> folderId=${folderId} noteId=${noteId}`);

      await updateNote(noteId, { content: { type: "doc", content: [] } });
      append("updated local note (still dirty)");

      const folderBefore = await getFolderById(folderId);
      const noteBefore = await getNoteById(noteId);
      append(
        `before push: folder.dirty=${folderBefore?.dirty} folder.syncedAt=${folderBefore?.syncedAt} note.dirty=${noteBefore?.dirty} note.syncedAt=${noteBefore?.syncedAt}`,
      );

      await pushDirtyRows(userId);
      append("pushDirtyRows() completed");

      const folderAfter = await getFolderById(folderId);
      const noteAfter = await getNoteById(noteId);
      append(
        `after push (local): folder.dirty=${folderAfter?.dirty} folder.syncedAt=${folderAfter?.syncedAt} note.dirty=${noteAfter?.dirty} note.syncedAt=${noteAfter?.syncedAt}`,
      );

      const folderSnap = await getDoc(doc(db, "folders", folderId));
      const noteSnap = await getDoc(doc(db, "notes", noteId));
      append(
        `after push (firestore): folder.exists=${folderSnap.exists()} folder.data=${JSON.stringify(folderSnap.data())}`,
      );
      append(
        `after push (firestore): note.exists=${noteSnap.exists()} note.data=${JSON.stringify(noteSnap.data())}`,
      );

      const pushOk =
        folderAfter?.dirty === false &&
        typeof folderAfter?.syncedAt === "number" &&
        noteAfter?.dirty === false &&
        typeof noteAfter?.syncedAt === "number" &&
        folderSnap.exists() &&
        noteSnap.exists() &&
        typeof folderSnap.data()?.updatedAt === "number" &&
        typeof noteSnap.data()?.updatedAt === "number";
      append(`PUSH ROUND-TRIP RESULT: ${pushOk ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`PUSH ROUND-TRIP FAILED: ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Push (lib/sync/push)</h1>
      <div className="flex gap-4">
        <button
          onClick={() => void runPushRoundTrip()}
          className="rounded bg-blue-500 px-4 py-2 text-white"
        >
          Run push round-trip
        </button>
      </div>
      <ul data-testid="spike-push-log" className="w-full max-w-2xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
