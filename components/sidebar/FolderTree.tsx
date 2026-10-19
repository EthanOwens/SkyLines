"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import { Clipboard } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { updateFolder } from "@/lib/db/folders";
import { updateNote } from "@/lib/db/notes";
import {
  isSidebarDragEvent,
  nextOrderValue,
  readSidebarDragPayload,
} from "@/lib/dnd/sidebar";
import { pasteClipboardEntry } from "@/lib/clipboard/sidebarClipboard";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FolderItem } from "./FolderItem";
import { NoteItem } from "./NoteItem";

// The store holds every notebook's folders and notes, so this filters to one
// notebook. Only the root level needs the filter, because nested items always
// descend from a root folder in the same notebook.
//
// The container is also a drop target and has a Paste menu: both put the item
// at the notebook root.

interface Props {
  userId: string;
  notebookId: string;
}

export function FolderTree({ userId, notebookId }: Props) {
  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);
  const clipboard = useAppStore((s) => s.clipboard);
  const setClipboard = useAppStore((s) => s.setClipboard);
  const setSelectedFolder = useAppStore((s) => s.setSelectedFolder);
  const [rootDropActive, setRootDropActive] = useState(false);

  const rootNotes = notes
    .filter((n) => !n.folderId && n.notebookId === notebookId)
    .sort((a, b) => a.order - b.order);
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

  // Rows stop dragover propagation, so once the pointer moves onto a row this
  // container never hears about it. Rows call this to clear the root-drop
  // highlight, which would otherwise stay on.
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
    } else if (payload.type === "note") {
      if (!notes.find((n) => n.id === payload.id)?.folderId) return;
      await updateNote(payload.id, {
        folderId: null,
        order: nextOrderValue(rootNotes.map((n) => n.order)),
      });
    }
    // Pages can't be dropped on the notebook root.
  }

  async function handlePasteToRoot() {
    if (!clipboard) return;
    const pasted = await pasteClipboardEntry(
      userId,
      clipboard,
      { notebookId, folderId: null },
      folders,
      notes,
    );
    if (pasted && clipboard.kind === "cut") {
      setClipboard(null);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={`min-h-full py-1 text-sm rounded-md transition-colors ${
              rootDropActive ? "bg-sidebar-accent/50 ring-1 ring-inset ring-sidebar-ring" : ""
            }`}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            // Clicking empty space clears the selected folder (rows stop
            // propagation).
            onClick={() => setSelectedFolder(null)}
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
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={handlePasteToRoot} disabled={!clipboard || clipboard.type === "page"}>
          <Clipboard className="mr-2 h-4 w-4" /> Paste
        </DropdownMenuItem>
      </DropdownMenuContent>
    </ContextMenu>
  );
}
