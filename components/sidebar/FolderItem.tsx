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

// Ported from ../note_taking_app/components/sidebar/FolderItem.tsx (spec.md
// subtask 16). Mutations now go through the SQLite-backed lib/db/notes.ts /
// lib/db/folders.ts instead of lib/firestore/notes.ts / folders.ts.
// `deleteFolder` here already recursively soft-deletes all descendant
// subfolders and notes (fixed in subtask 10) - the redundant per-note
// `deleteNote` cascade the reference did for direct child notes is dropped
// since it's now fully handled inside `deleteFolder` itself. Note/canvas
// links use the query-param routing form (/note?id=..., /canvas?id=...) per
// subtask 5 instead of /note/[id] / /canvas/[id]. The "···" trigger uses
// `<DropdownMenuTrigger render={<button .../>} />` instead of the
// reference's `asChild` - see components/sidebar/Sidebar.tsx's header
// comment for why.
//
// M4 (spec.md subtask 7, "Sidebar drag-and-drop"): this row is now
// draggable (moves the folder when dropped elsewhere), and is itself a drop
// target two ways - drop near the TOP/BOTTOM edge to reorder among sibling
// folders (`siblingFolderIds`, passed down from the parent level), or drop
// on the MIDDLE band to move the dragged note/folder INSIDE this folder
// (re-parent). A folder can never be dropped onto itself or one of its own
// descendants (`isFolderOrDescendant`) - doing so would corrupt the tree.
//
// M4 (spec.md subtask 8, "Right-click context menu"): this row now also
// opens a real `onContextMenu`-triggered menu (via `ContextMenu`/
// `ContextMenuTrigger`, components/ui/context-menu.tsx) with the same
// actions as the existing "···" `DropdownMenu` trigger, PLUS Cut/Copy/Paste
// against the generic clipboard mechanism (stores/appStore.ts's
// `clipboard` field + lib/clipboard/sidebarClipboard.ts's
// `pasteClipboardEntry`). "Paste" only appears here (a folder row) when the
// clipboard is non-empty; pasting is blocked (`pasteClipboardEntry` itself
// no-ops) if it would move this folder into itself or one of its own
// descendants.

interface Props {
  folder: FolderType;
  allFolders: FolderType[];
  allNotes: Note[];
  userId: string;
  depth: number;
  /** Ordered ids of the sibling folders at this same level (same parent),
   * including this folder itself - used to compute the new order when a
   * dragged folder is dropped before/after this one. */
  siblingFolderIds: string[];
  /** Called from this row's own `handleDragOver` (in addition to its own
   * `e.stopPropagation()`) so the root `FolderTree` container can clear its
   * "drop to root" highlight while a specific row is being hovered - see
   * `FolderTree.tsx`'s `handleRowDragOver` comment for why this is needed. */
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
    // A note created inside this folder inherits the folder's notebook -
    // `folder.notebookId` is guaranteed non-null in practice, see the
    // notebookId comment on the `Folder` type in types/index.ts (same
    // reasoning `addSubfolder` below already relies on). spec.md subtask 6
    // ("Merge note creation UI"): every note is now the merged free-form-
    // canvas editor, so this always creates `type: "canvas"` and routes to
    // /canvas?id=... - there's no longer a separate "New canvas" action.
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
    // A new subfolder inherits its parent's notebook (folders don't move
    // between notebooks by being nested) - `folder.notebookId` is
    // guaranteed non-null in practice, see the notebookId comment on the
    // `Folder` type in types/index.ts.
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
        // A dragged page has no valid drop target here - folders/notebooks
        // don't contain pages (pages only live inside a note), so ignore.
        return;
      }
      setOpen(true);
      return;
    }

    // "before"/"after": reorder among this row's own siblings, re-parenting
    // the dragged item to this row's parent if it came from elsewhere.
    if (payload.type === "folder") {
      if (payload.id === folder.id) return;
      // Reordering moves the dragged folder to `folder.parentId` (this
      // row's own parent). That's only a cycle if `folder.parentId` is the
      // dragged folder itself or one of ITS descendants - a null
      // `folder.parentId` (moving to root) is always safe.
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
      // A note dropped before/after a folder row has no note siblings here
      // to reorder against - treat it as "move into this folder's parent
      // level, appended at the end" isn't well-defined for a folder target,
      // so ignore (notes only reorder against other notes; use the
      // "inside" band to move a note into a folder).
      return;
    }
  }

  const paddingLeft = depth * 12 + 8;

  // Shared between the "···" `DropdownMenu` trigger and the right-click
  // `ContextMenu` trigger below (spec.md subtask 8) - both open the exact
  // same set of actions, just via different entry points, so the item list
  // itself is only written once.
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
      <ContextMenu>
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
                // Selecting a folder for toolbar-creation scoping is layered
                // on top of the pre-existing expand/collapse toggle, not a
                // replacement for it (spec.md M2 subtask 4). Stop
                // propagation so this doesn't also bubble up to
                // FolderTree.tsx's own container click, which clears the
                // selection back to root-scoped for clicks on empty space.
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

              <DropdownMenu>
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
