"use client";

import { useState, useRef } from "react";
import type { DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Scissors,
  Copy,
  Clipboard,
} from "lucide-react";
import { createNote, updateNote } from "@/lib/db/notes";
import { createFolder, updateFolder, deleteFolder } from "@/lib/db/folders";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { CopyReferenceItem, useMenuCloser } from "@/components/references/CopyReferenceItem";
import { useAppStore } from "@/stores/appStore";
import { pasteClipboardEntry } from "@/lib/clipboard/sidebarClipboard";
import {
  isFolderOrDescendant,
  isSidebarDragEvent,
  nextOrderValue,
  readSidebarDragPayload,
  reindexSiblings,
  resolveRowDropPosition,
  setSidebarDragPayload,
  type RowDropPosition,
} from "@/lib/dnd/sidebar";
import { NoteItem } from "./NoteItem";
import type { Folder as FolderType, Note } from "@/types";

// Folder row. Draggable, and a drop target: the top or bottom edge reorders
// among siblings, the middle band moves the item inside. A folder can't be
// dropped into itself or its descendants.
//
// The right-click menu repeats the "···" actions plus Cut, Copy and Paste
// (Paste only when the clipboard has something).

interface Props {
  folder: FolderType;
  allFolders: FolderType[];
  allNotes: Note[];
  userId: string;
  depth: number;
  siblingFolderIds: string[];
  /**
   * Lets FolderTree clear its root-drop highlight: rows stop dragover
   * propagation, so the container can't see the pointer move onto a row.
   */
  onDragOverRow: () => void;
}

export function FolderItem({
  folder,
  allFolders,
  allNotes,
  userId,
  depth,
  siblingFolderIds,
  onDragOverRow,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [dropPosition, setDropPosition] = useState<RowDropPosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clipboard = useAppStore((s) => s.clipboard);
  const setClipboard = useAppStore((s) => s.setClipboard);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const setSelectedFolder = useAppStore((s) => s.setSelectedFolder);
  const { actionsRef, contextActionsRef, closeMenus } = useMenuCloser();
  const isSelected = selectedFolderId === folder.id;

  const childFolders = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.order - b.order);
  const childNotes = allNotes
    .filter((n) => n.folderId === folder.id)
    .sort((a, b) => a.order - b.order);
  const hasChildren = childFolders.length > 0 || childNotes.length > 0;
  const childFolderIds = childFolders.map((f) => f.id);
  const childNoteIds = childNotes.map((n) => n.id);

  function startRename() {
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 10);
  }

  async function commitRename() {
    setRenaming(false);
    const trimmed = name.trim() || folder.name;
    setName(trimmed);
    if (trimmed !== folder.name) {
      await updateFolder(folder.id, { name: trimmed });
    }
  }

  async function handleDelete() {
    // deleteFolder recursively soft-deletes this folder, all descendant
    // subfolders, and every note under any of them (see lib/db/folders.ts).
    await deleteFolder(folder.id);
  }

  function handleCut() {
    setClipboard({ kind: "cut", type: "folder", id: folder.id });
  }

  function handleCopy() {
    setClipboard({ kind: "copy", type: "folder", id: folder.id });
  }

  async function handlePaste() {
    if (!clipboard) return;
    const pasted = await pasteClipboardEntry(
      userId,
      clipboard,
      { notebookId: folder.notebookId as string, folderId: folder.id },
      allFolders,
      allNotes,
    );
    if (pasted && clipboard.kind === "cut") {
      setClipboard(null);
    }
    if (pasted) setOpen(true);
  }

  async function addNote() {
    // New notes inherit the folder's notebook.
    const id = await createNote(
      userId,
      "canvas",
      folder.notebookId as string,
      folder.id,
      "Untitled",
      nextOrderValue(childNotes.map((n) => n.order)),
    );
    setOpen(true);
    router.push(`/canvas?id=${id}`);
  }

  async function addSubfolder() {
    // Subfolders inherit the parent's notebook.
    await createFolder(
      userId,
      "New Folder",
      folder.notebookId as string,
      folder.id,
      nextOrderValue(childFolders.map((f) => f.order)),
    );
    setOpen(true);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (renaming) {
      e.preventDefault();
      return;
    }
    setSidebarDragPayload(e, { type: "folder", id: folder.id });
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isSidebarDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    onDragOverRow();
    const position = resolveRowDropPosition(e, e.currentTarget.getBoundingClientRect(), true);
    e.dataTransfer.dropEffect = "move";
    setDropPosition(position);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropPosition(null);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const position = dropPosition;
    setDropPosition(null);
    const payload = readSidebarDragPayload(e);
    if (!payload || !position) return;

    if (position === "inside") {
      if (payload.type === "folder") {
        if (payload.id === folder.id || isFolderOrDescendant(allFolders, payload.id, folder.id)) return;
        await updateFolder(payload.id, {
          parentId: folder.id,
          order: nextOrderValue(childFolders.map((f) => f.order)),
        });
      } else if (payload.type === "note") {
        await updateNote(payload.id, {
          folderId: folder.id,
          order: nextOrderValue(childNotes.map((n) => n.order)),
        });
      } else {
        // Pages can't be dropped on folders.
        return;
      }
      setOpen(true);
      return;
    }

    // "before"/"after": reorder among this row's own siblings, re-parenting
    // the dragged item to this row's parent if it came from elsewhere.
    if (payload.type === "folder") {
      if (payload.id === folder.id) return;
      // Moving to this row's parent is only a cycle if that parent is the
      // dragged folder or one of its descendants.
      if (folder.parentId && isFolderOrDescendant(allFolders, payload.id, folder.parentId)) {
        return;
      }
      const reindexed = reindexSiblings(siblingFolderIds, payload.id, folder.id, position);
      for (const { id, order } of reindexed) {
        if (id === payload.id) {
          await updateFolder(id, { parentId: folder.parentId, order });
        } else {
          await updateFolder(id, { order });
        }
      }
    } else {
      // Notes reorder only against other notes; drop on the middle band to move
      // a note into a folder.
      return;
    }
  }

  const paddingLeft = depth * 12 + 8;

  // Used by both the "···" menu and the right-click menu.
  function menuItems() {
    return (
      <>
        <DropdownMenuItem onClick={addNote}>
          <FilePlus className="mr-2 h-4 w-4" /> New note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addSubfolder}>
          <FolderPlus className="mr-2 h-4 w-4" /> New subfolder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCut}>
          <Scissors className="mr-2 h-4 w-4" /> Cut
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="mr-2 h-4 w-4" /> Copy
        </DropdownMenuItem>
        <CopyReferenceItem reference={{ kind: "folder", id: folder.id }} onDone={closeMenus} />
        {clipboard && clipboard.type !== "page" && (
          <DropdownMenuItem onClick={handlePaste}>
            <Clipboard className="mr-2 h-4 w-4" /> Paste
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} className="text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <div>
      {dropPosition === "before" && (
        <div className="mx-2 h-0.5 rounded-full bg-primary" style={{ marginLeft: paddingLeft }} />
      )}
      <ContextMenu actionsRef={contextActionsRef}>
        <ContextMenuTrigger
          render={
            <div
              draggable
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`group flex items-center gap-1 rounded-md py-0.5 pr-1 cursor-pointer hover:bg-sidebar-accent transition-colors ${
                dropPosition === "inside"
                  ? "bg-sidebar-accent ring-1 ring-inset ring-sidebar-ring"
                  : isSelected
                    ? "bg-sidebar-accent/40"
                    : ""
              }`}
              style={{ paddingLeft }}
              onClick={(e) => {
                // Selecting a folder (for scoped creation) layers on the expand
                // toggle. Stop propagation so FolderTree's empty-space click
                // doesn't clear the selection.
                e.stopPropagation();
                setOpen((v) => !v);
                setSelectedFolder(folder.id);
              }}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
              />
              {open ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}

              {renaming ? (
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent text-sm outline-none"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setName(folder.name); setRenaming(false); }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 truncate text-sm text-sidebar-foreground select-none">
                  {name}
                </span>
              )}

              <DropdownMenu actionsRef={actionsRef}>
                <DropdownMenuTrigger
                  render={
                    <button
                      className="invisible ml-auto shrink-0 rounded p-0.5 hover:bg-sidebar-accent group-hover:visible"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-muted-foreground text-xs">···</span>
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-44">
                  {menuItems()}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
        <DropdownMenuContent align="start" className="w-44">
          {menuItems()}
        </DropdownMenuContent>
      </ContextMenu>

      {open && hasChildren && (
        <div>
          {childFolders.map((f) => (
            <FolderItem
              key={f.id}
              folder={f}
              allFolders={allFolders}
              allNotes={allNotes}
              userId={userId}
              depth={depth + 1}
              siblingFolderIds={childFolderIds}
              onDragOverRow={onDragOverRow}
            />
          ))}
          {childNotes.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              userId={userId}
              depth={depth + 1}
              siblingNoteIds={childNoteIds}
              onDragOverRow={onDragOverRow}
            />
          ))}
        </div>
      )}

      {dropPosition === "after" && (
        <div className="mx-2 h-0.5 rounded-full bg-primary" style={{ marginLeft: paddingLeft }} />
      )}
    </div>
  );
}
