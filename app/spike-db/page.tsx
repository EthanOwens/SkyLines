"use client";

import { useState } from "react";
import {
  createFolder,
  deleteFolder,
  getFolders,
  updateFolder,
} from "@/lib/db/folders";
import { createNote, deleteNote, getNoteById, getNotes, updateNote } from "@/lib/db/notes";

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
      const folderId = await createFolder(userId, "Spike Folder", null, 1);
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
      const noteId = await createNote(userId, "note", null, "Spike Note");
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
      </div>
      <ul data-testid="spike-db-log" className="w-full max-w-2xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
