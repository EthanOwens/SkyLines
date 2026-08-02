"use client";

import { useState } from "react";
import {
  createNotebook,
  deleteNotebook,
  getDirtyNotebooks,
  getNotebookById,
  getNotebookRowById,
  getNotebooks,
  getOldTombstoneNotebooks,
  hardDeleteNotebook,
  markNotebookSynced,
  updateNotebook,
  upsertNotebookFromRemote,
} from "@/lib/db/notebooks";
import { createFolder, getFolderById } from "@/lib/db/folders";
import { createNote, getNoteById } from "@/lib/db/notes";

// M1 spike route (spec.md subtask 2). Exercises lib/db/notebooks.ts
// end-to-end against the real "sqlite:skylines.db" file, same pattern as
// app/spike-db/page.tsx. Not production UI - a throwaway verification
// harness.
export default function SpikeNotebooks() {
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runNotebookRoundTrip() {
    const userId = "spike-notebook-user";
    try {
      const notebookId = await createNotebook(userId, "Spike Notebook", 1);
      append(`createNotebook -> id=${notebookId}`);

      let notebooks = await getNotebooks(userId);
      const created = notebooks.find((n) => n.id === notebookId);
      append(
        `after create: found=${!!created} dirty=${created?.dirty} deletedAt=${created?.deletedAt} name=${created?.name}`,
      );

      const folderId = await createFolder(userId, "Spike Section", notebookId, null, 1);
      const folder = await getFolderById(folderId);
      append(`createFolder(notebookId=${notebookId}) -> id=${folderId} folder.notebookId=${folder?.notebookId}`);

      await updateNotebook(notebookId, { name: "Renamed Spike Notebook" });
      notebooks = await getNotebooks(userId);
      const updated = notebooks.find((n) => n.id === notebookId);
      append(
        `after update: name=${updated?.name} dirty=${updated?.dirty} updatedAt=${updated?.updatedAt}`,
      );
    } catch (err) {
      append(`NOTEBOOK ROUND-TRIP FAILED: ${String(err)}`);
    }
  }

  async function runCascadeDeleteCheck() {
    // Verify: deleteNotebook soft-deletes the notebook itself, every folder
    // with notebook_id = <id>, and every note in those folders - in a
    // single atomic multi-statement db.execute() call (mirrors deleteFolder
    // in lib/db/folders.ts and the atomicity bug fixed there).
    const userId = "spike-notebook-cascade-user";
    try {
      const notebookId = await createNotebook(userId, "Cascade Notebook", 1);
      const folderId = await createFolder(userId, "Cascade Folder", notebookId, null, 1);
      const noteId = await createNote(userId, "note", notebookId, folderId, "Cascade Note");
      append(`created: notebook=${notebookId} folder=${folderId} note=${noteId}`);

      await deleteNotebook(notebookId);
      append(`deleteNotebook(${notebookId}) called - no throw means atomic multi-statement execute() succeeded`);

      const [gotNotebook, gotFolder, gotNote] = await Promise.all([
        getNotebookById(notebookId),
        getFolderById(folderId),
        getNoteById(noteId),
      ]);
      const rawNotebook = await getNotebookRowById(notebookId);
      append(
        `after cascade delete (all expect null via non-deleted getters): notebook=${gotNotebook} folder=${gotFolder} note=${gotNote}`,
      );
      append(
        `raw notebook row (includes soft-deleted): deletedAt=${rawNotebook?.deletedAt} dirty=${rawNotebook?.dirty}`,
      );

      const cascadeOk = gotNotebook === null && gotFolder === null && gotNote === null && rawNotebook?.deletedAt != null && rawNotebook?.dirty === true;
      append(`CASCADE DELETE CHECK RESULT: ${cascadeOk ? "PASS" : "FAIL"}`);
    } catch (err) {
      append(`CASCADE DELETE CHECK FAILED (unexpected throw): ${String(err)}`);
    }
  }

  async function runSyncBookkeepingCheck() {
    const userId = "spike-notebook-sync-user";
    try {
      const notebookId = await createNotebook(userId, "Sync Notebook", 1);
      let dirty = await getDirtyNotebooks(userId);
      append(`getDirtyNotebooks after create: count=${dirty.length} includesNew=${dirty.some((n) => n.id === notebookId)}`);

      const syncedAt = Date.now();
      await markNotebookSynced(notebookId, syncedAt);
      dirty = await getDirtyNotebooks(userId);
      append(`getDirtyNotebooks after markNotebookSynced: count=${dirty.length} (expect 0 for this notebook)`);

      const row = await getNotebookRowById(notebookId);
      append(`after markNotebookSynced: dirty=${row?.dirty} syncedAt=${row?.syncedAt}`);

      // upsertNotebookFromRemote
      await upsertNotebookFromRemote(
        {
          id: notebookId,
          name: "Remote-Renamed Notebook",
          userId,
          order: 2,
          createdAt: row!.createdAt,
          updatedAt: Date.now(),
          deletedAt: null,
        },
        false,
        Date.now(),
      );
      const afterUpsert = await getNotebookById(notebookId);
      append(`after upsertNotebookFromRemote: name=${afterUpsert?.name} order=${afterUpsert?.order} dirty=${afterUpsert?.dirty}`);

      // Old tombstone + hard delete
      await deleteNotebook(notebookId);
      const cutoffMs = Date.now() + 1000; // anything deleted before "now + 1s" counts as old
      const oldTombstones = await getOldTombstoneNotebooks(userId, cutoffMs);
      append(`getOldTombstoneNotebooks: count=${oldTombstones.length} includesTarget=${oldTombstones.some((n) => n.id === notebookId)}`);

      await hardDeleteNotebook(notebookId);
      const afterHardDelete = await getNotebookRowById(notebookId);
      append(`after hardDeleteNotebook: row=${afterHardDelete} (expect null)`);
    } catch (err) {
      append(`SYNC BOOKKEEPING CHECK FAILED: ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Notebooks (lib/db/notebooks)</h1>
      <div className="flex gap-4">
        <button
          onClick={() => void runNotebookRoundTrip()}
          className="rounded bg-blue-500 px-4 py-2 text-white"
        >
          Run notebook round-trip
        </button>
        <button
          onClick={() => void runCascadeDeleteCheck()}
          className="rounded bg-purple-600 px-4 py-2 text-white"
        >
          Run cascade delete check
        </button>
        <button
          onClick={() => void runSyncBookkeepingCheck()}
          className="rounded bg-green-600 px-4 py-2 text-white"
        >
          Run sync bookkeeping check
        </button>
      </div>
      <ul data-testid="spike-notebooks-log" className="w-full max-w-2xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
