"use client";

import { useState } from "react";
import {
  createFolder,
  deleteFolder,
  getFolderById,
  getFolders,
  updateFolder,
} from "@/lib/db/folders";
import {
  createNote,
  deleteNote,
  getNoteById,
  getNotes,
  updateNote,
} from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";

// M2 spike route (spec.md subtask 9). Exercises lib/db/notes.ts and
// lib/db/folders.ts end-to-end (create -> read -> update -> soft-delete ->
// read again) against the real "sqlite:skylines.db" file created by the
// migration in src-tauri/src/lib.rs. Not production UI - a throwaway
// verification harness, same pattern as the earlier app/spike-sql page.
export default function SpikeDb() {
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runFolderRoundTrip() {
    const userId = "spike-user";
    try {
      const notebookId = await getOrCreateDefaultNotebookId(userId);
      const folderId = await createFolder(userId, "Spike Folder", notebookId, null, 1);
      append(`createFolder -> id=${folderId}`);

      let folders = await getFolders(userId);
      const created = folders.find((f) => f.id === folderId);
      append(
        `after create: found=${!!created} dirty=${created?.dirty} deletedAt=${created?.deletedAt} name=${created?.name}`,
      );

      await updateFolder(folderId, { name: "Renamed Spike Folder" });
      folders = await getFolders(userId);
      const updated = folders.find((f) => f.id === folderId);
      append(
        `after update: name=${updated?.name} dirty=${updated?.dirty} updatedAt=${updated?.updatedAt}`,
      );

      await deleteFolder(folderId);
      folders = await getFolders(userId);
      const stillVisible = folders.some((f) => f.id === folderId);
      append(
        `after soft-delete: stillVisible(non-deleted query)=${stillVisible} (expect false)`,
      );
    } catch (err) {
      append(`FOLDER ROUND-TRIP FAILED: ${String(err)}`);
    }
  }

  async function runNoteRoundTrip() {
    const userId = "spike-user";
    try {
      const notebookId = await getOrCreateDefaultNotebookId(userId);
      const noteId = await createNote(userId, "note", notebookId, null, "Spike Note");
      append(`createNote -> id=${noteId}`);

      let note = await getNoteById(noteId);
      append(
        `after create: found=${!!note} dirty=${note?.dirty} deletedAt=${note?.deletedAt} content=${JSON.stringify(note?.content)}`,
      );

      await updateNote(noteId, {
        title: "Renamed Spike Note",
        content: { type: "doc", content: [] },
      });
      note = await getNoteById(noteId);
      append(
        `after update: title=${note?.title} content=${JSON.stringify(note?.content)} dirty=${note?.dirty}`,
      );

      const notes = await getNotes(userId);
      append(`getNotes count (includes new note)=${notes.length}`);

      await deleteNote(noteId);
      note = await getNoteById(noteId);
      append(`after soft-delete: getNoteById=${note} (expect null)`);
    } catch (err) {
      append(`NOTE ROUND-TRIP FAILED: ${String(err)}`);
    }
  }

  async function runFolderDeleteRecursionCheck() {
    // spec.md subtask 10 verification: build a 3-level-deep folder tree
    // (A -> B -> C) with a note in each of A/B/C, plus an unrelated sibling
    // folder+note outside the tree. Delete A and confirm A, B, C, and all
    // three notes are soft-deleted, while the sibling folder/note are not.
    const userId = "spike-user-recursion";
    try {
      const notebookId = await getOrCreateDefaultNotebookId(userId);
      const folderA = await createFolder(userId, "A", notebookId, null, 1);
      const folderB = await createFolder(userId, "B", notebookId, folderA, 1);
      const folderC = await createFolder(userId, "C", notebookId, folderB, 1);
      const sibling = await createFolder(userId, "Sibling", notebookId, null, 2);
      append(`created tree: A=${folderA} B=${folderB} C=${folderC} Sibling=${sibling}`);

      const noteA = await createNote(userId, "note", notebookId, folderA, "Note in A");
      const noteB = await createNote(userId, "note", notebookId, folderB, "Note in B");
      const noteC = await createNote(userId, "note", notebookId, folderC, "Note in C");
      const noteSibling = await createNote(userId, "note", notebookId, sibling, "Note in Sibling");
      append(
        `created notes: noteA=${noteA} noteB=${noteB} noteC=${noteC} noteSibling=${noteSibling}`,
      );

      await deleteFolder(folderA);
      append(`deleteFolder(A) called`);

      const [gotA, gotB, gotC, gotSibling] = await Promise.all([
        getFolderById(folderA),
        getFolderById(folderB),
        getFolderById(folderC),
        getFolderById(sibling),
      ]);
      const [gotNoteA, gotNoteB, gotNoteC, gotNoteSibling] = await Promise.all([
        getNoteById(noteA),
        getNoteById(noteB),
        getNoteById(noteC),
        getNoteById(noteSibling),
      ]);

      append(
        `folders after delete (all expect null except Sibling): A=${gotA} B=${gotB} C=${gotC} Sibling=${gotSibling ? "PRESENT" : "MISSING"}`,
      );
      append(
        `notes after delete (all expect null except Sibling's): noteA=${gotNoteA} noteB=${gotNoteB} noteC=${gotNoteC} noteSibling=${gotNoteSibling ? "PRESENT" : "MISSING"}`,
      );

      const cascadeOk =
        gotA === null &&
        gotB === null &&
        gotC === null &&
        gotSibling !== null &&
        gotNoteA === null &&
        gotNoteB === null &&
        gotNoteC === null &&
        gotNoteSibling !== null;
      append(`RECURSION CHECK RESULT: ${cascadeOk ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`FOLDER DELETE RECURSION CHECK FAILED: ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike DB (lib/db)</h1>
      <div className="flex gap-4">
        <button
          onClick={() => void runFolderRoundTrip()}
          className="rounded bg-blue-500 px-4 py-2 text-white"
        >
          Run folder round-trip
        </button>
        <button
          onClick={() => void runNoteRoundTrip()}
          className="rounded bg-green-600 px-4 py-2 text-white"
        >
          Run note round-trip
        </button>
        <button
          onClick={() => void runFolderDeleteRecursionCheck()}
          className="rounded bg-purple-600 px-4 py-2 text-white"
        >
          Run folder-delete recursion check
        </button>
      </div>
      <ul data-testid="spike-db-log" className="w-full max-w-2xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
