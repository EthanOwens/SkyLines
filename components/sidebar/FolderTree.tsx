"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import { useAppStore } from "@/stores/appStore";
import { updateFolder } from "@/lib/db/folders";
import { updateNote } from "@/lib/db/notes";
import {
  isSidebarDragEvent,
  nextOrderValue,
  readSidebarDragPayload,
} from "@/lib/dnd/sidebar";
import { FolderItem } from "./FolderItem";
import { NoteItem } from "./NoteItem";

// Ported from ../note_taking_app/components/sidebar/FolderTree.tsx (spec.md
// subtask 16) - reads folders/notes from stores/appStore.ts, which
// hooks/useFolders.ts and hooks/useNotes.ts populate from the SQLite layer
// (subtask 15), instead of this component subscribing to Firestore directly.
//
// Notebook-scoped (spec.md subtask 7): `folders`/`notes` in the store are
// NOT pre-filtered by notebook (useFolders/useNotes fetch everything for the
// signed-in user across all notebooks), so this component itself restricts
// what it renders to the given `notebookId`. Only the ROOT level needs an
// explicit `notebookId` filter - `FolderItem`'s recursive descent below only
// ever walks a folder's children by `parentId` within `allFolders`/
// `allNotes`, and every folder's `parentId` chain necessarily bottoms out at
// one of these already-notebook-scoped root folders (folders don't move
// between notebooks by being nested - see `FolderItem.tsx`'s `addSubfolder`
// comment), so a folder/note nested under a scoped root folder can never
// belong to a different notebook. Filtering only the root level is
// therefore sufficient; `FolderItem`/`NoteItem` don't need a `notebookId`
// prop threaded down to them.
//
// M4 (spec.md subtask 7, "Sidebar drag-and-drop"): root/notes/folders are
// now sorted by their persisted `order` field (previously just render
// order), and this component's own outer container is itself a drop
// target - dropping a dragged note/folder on the empty space below the
// tree (not on a specific row) moves it out to the root of this notebook
// (`parentId`/`folderId: null`), the root-level analogue of `FolderItem`'s
// "drop onto a folder" re-parent behavior.

interface Props {
  userId: string;
  notebookId: string;
}

export function FolderTree({ userId, notebookId }: Props) {
  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);
  const [rootDropActive, setRootDropActive] = useState(false);

  // Notes not inside any folder, scoped to this notebook.
  const rootNotes = notes
    .filter((n) => !n.folderId && n.notebookId === notebookId)
    .sort((a, b) => a.order - b.order);
  // Folders at the root level, scoped to this notebook.
  const rootFolders = folders
    .filter((f) => !f.parentId && f.notebookId === notebookId)
    .sort((a, b) => a.order - b.order);

  const rootFolderIds = rootFolders.map((f) => f.id);
  const rootNoteIds = rootNotes.map((n) => n.id);

  function handleRootDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isSidebarDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setRootDropActive(true);
  }

  function handleRootDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setRootDropActive(false);
  }

  // Passed down to every row (FolderItem/NoteItem, at any depth) and called
  // from each row's own `handleDragOver`. Rows call `e.stopPropagation()` in
  // their own `handleDragOver`, so once the pointer enters empty space in
  // this container (setting `rootDropActive` true, above) and then moves
  // onto a row, this container's own `dragover`/`dragleave` never fire again
  // for that row - without this callback, `rootDropActive` would stay stuck
  // true (glued-on "drop to root" highlight) for the rest of the drag even
  // while hovering a row that's a legitimate reorder/reparent target. Rows
  // are the only ones that can turn the highlight back off once it's on;
  // this container's own `handleRootDragOver` is the only place that turns
  // it on.
  function handleRowDragOver() {
    setRootDropActive(false);
  }

  async function handleRootDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setRootDropActive(false);
    const payload = readSidebarDragPayload(e);
    if (!payload) return;

    if (payload.type === "folder") {
      // Already a root folder - nothing to do.
      if (!folders.find((f) => f.id === payload.id)?.parentId) return;
      await updateFolder(payload.id, {
        parentId: null,
        order: nextOrderValue(rootFolders.map((f) => f.order)),
      });
    } else {
      if (!notes.find((n) => n.id === payload.id)?.folderId) return;
      await updateNote(payload.id, {
        folderId: null,
        order: nextOrderValue(rootNotes.map((n) => n.order)),
      });
    }
  }

  return (
    <div
      className={`min-h-full py-1 text-sm rounded-md transition-colors ${
        rootDropActive ? "bg-sidebar-accent/50 ring-1 ring-inset ring-sidebar-ring" : ""
      }`}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      {rootFolders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          allFolders={folders}
          allNotes={notes}
          userId={userId}
          depth={0}
          siblingFolderIds={rootFolderIds}
          onDragOverRow={handleRowDragOver}
        />
      ))}
      {rootNotes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          userId={userId}
          depth={0}
          siblingNoteIds={rootNoteIds}
          onDragOverRow={handleRowDragOver}
        />
      ))}
      {rootFolders.length === 0 && rootNotes.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No notes yet. Use the toolbar above to create one.
        </p>
      )}
    </div>
  );
}
