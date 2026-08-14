"use client";

import { useState, useRef } from "react";
import type { DragEvent } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Pencil, Trash2, Scissors, Copy } from "lucide-react";
import { updateNote, deleteNote } from "@/lib/db/notes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useAppStore } from "@/stores/appStore";
import {
  isSidebarDragEvent,
  readSidebarDragPayload,
  reindexSiblings,
  resolveRowDropPosition,
  setSidebarDragPayload,
  type RowDropPosition,
} from "@/lib/dnd/sidebar";
import type { Note } from "@/types";

// Ported from ../note_taking_app/components/sidebar/NoteItem.tsx (spec.md
// subtask 16). Mutations now go through the SQLite-backed lib/db/notes.ts
// instead of lib/firestore/notes.ts. The note/canvas `href` is built with
// the query-param routing form (/note?id=..., /canvas?id=...) per subtask 5
// instead of /note/[id] / /canvas/[id]. The "···" trigger uses
// `<DropdownMenuTrigger render={<button .../>} />` instead of the
// reference's `asChild` - see components/sidebar/Sidebar.tsx's header
// comment for why.
//
// M4 (spec.md subtask 7, "Sidebar drag-and-drop"): this row is now
// draggable, and is a drop target for reordering among sibling notes
// (`siblingNoteIds`, the other notes in the same folder/root level, passed
// down from the parent level) - dropping near the top/bottom half of the
// row reorders. Notes can't contain children, so unlike `FolderItem` there
// is no "drop inside" band here; moving a note into a folder happens by
// dropping it on that folder's row instead.
//
// M4 (spec.md subtask 8, "Right-click context menu"): this row now also
// opens a real `onContextMenu`-triggered menu (via `ContextMenu`/
// `ContextMenuTrigger`, components/ui/context-menu.tsx) with the same
// actions as the existing "···" `DropdownMenu` trigger, plus Cut/Copy
// against the generic clipboard mechanism (stores/appStore.ts's
// `clipboard` field, executed by lib/clipboard/sidebarClipboard.ts). There
// is no "Paste" here - per spec.md's paste UX, pasting only makes sense on
// a container (a folder row or the notebook root), not on a note leaf.

interface Props {
  note: Note;
  userId: string;
  depth: number;
  /** Ordered ids of the sibling notes at this same level (same folder),
   * including this note itself - used to compute the new order when a
   * dragged note is dropped before/after this one. */
  siblingNoteIds: string[];
  /** Called from this row's own `handleDragOver` (in addition to its own
   * `e.stopPropagation()`) so the root `FolderTree` container can clear its
   * "drop to root" highlight while a specific row is being hovered - see
   * `FolderTree.tsx`'s `handleRowDragOver` comment for why this is needed. */
  onDragOverRow: () => void;
}

export function NoteItem({ note, depth, siblingNoteIds, onDragOverRow }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(note.title || "Untitled");
  const [dropPosition, setDropPosition] = useState<RowDropPosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setClipboard = useAppStore((s) => s.setClipboard);

  // spec.md subtask 6 ("Merge note creation UI"): every note - old
  // `type: "note"` rows included - now opens through the merged free-form-
  // canvas editor at /canvas?id=... . An old-format note (real Tiptap
  // `content`, no `canvasData` yet) is safely, minimally, idempotently
  // migrated to a single RichTextShape inline the moment it's opened there
  // (see components/canvas/CanvasEditor.tsx), so this never renders as a
  // blank canvas - see this repo's spec.md subtask 6/8 notes for the full
  // data-safety reasoning.
  const href = `/canvas?id=${note.id}`;
  const isActive = pathname === href;
  const paddingLeft = depth * 12 + 20;

  function startRename() {
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 10);
  }

  async function commitRename() {
    setRenaming(false);
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== note.title) {
      await updateNote(note.id, { title: trimmed });
    }
  }

  async function handleDelete() {
    await deleteNote(note.id);
    if (isActive) router.replace("/");
  }

  function handleCut() {
    setClipboard({ kind: "cut", type: "note", id: note.id });
  }

  function handleCopy() {
    setClipboard({ kind: "copy", type: "note", id: note.id });
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (renaming) {
      e.preventDefault();
      return;
    }
    setSidebarDragPayload(e, { type: "note", id: note.id });
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isSidebarDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    onDragOverRow();
    const position = resolveRowDropPosition(e, e.currentTarget.getBoundingClientRect(), false);
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
    const position = dropPosition === "inside" ? "after" : dropPosition;
    setDropPosition(null);
    const payload = readSidebarDragPayload(e);
    if (!payload || !position || payload.type !== "note" || payload.id === note.id) return;

    const reindexed = reindexSiblings(siblingNoteIds, payload.id, note.id, position);
    for (const { id, order } of reindexed) {
      if (id === payload.id) {
        await updateNote(id, { folderId: note.folderId, order });
      } else {
        await updateNote(id, { order });
      }
    }
  }

  // Shared between the "···" `DropdownMenu` trigger and the right-click
  // `ContextMenu` trigger below (spec.md subtask 8).
  function menuItems() {
    return (
      <>
        <DropdownMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCut}>
          <Scissors className="mr-2 h-4 w-4" /> Cut
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="mr-2 h-4 w-4" /> Copy
        </DropdownMenuItem>
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
              className={`group flex items-center gap-1.5 rounded-md py-0.5 pr-1 cursor-pointer transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "hover:bg-sidebar-accent"
              }`}
              style={{ paddingLeft }}
              onClick={(e) => {
                e.stopPropagation();
                if (!renaming) router.push(href);
              }}
            >
              {note.type === "canvas" ? (
                <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}

              {renaming ? (
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent text-sm outline-none"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setTitle(note.title); setRenaming(false); }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 truncate text-sm text-sidebar-foreground select-none">
                  {title}
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
                <DropdownMenuContent align="start" className="w-40">
                  {menuItems()}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
        <DropdownMenuContent align="start" className="w-40">
          {menuItems()}
        </DropdownMenuContent>
      </ContextMenu>
      {dropPosition === "after" && (
        <div className="mx-2 h-0.5 rounded-full bg-primary" style={{ marginLeft: paddingLeft }} />
      )}
    </div>
  );
}
