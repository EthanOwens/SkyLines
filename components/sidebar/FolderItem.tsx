"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, FolderOpen, FilePlus, LayoutDashboard, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { createNote } from "@/lib/db/notes";
import { createFolder, updateFolder, deleteFolder } from "@/lib/db/folders";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface Props {
  folder: FolderType;
  allFolders: FolderType[];
  allNotes: Note[];
  userId: string;
  depth: number;
}

export function FolderItem({ folder, allFolders, allNotes, userId, depth }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const childFolders = allFolders.filter((f) => f.parentId === folder.id);
  const childNotes = allNotes.filter((n) => n.folderId === folder.id);
  const hasChildren = childFolders.length > 0 || childNotes.length > 0;

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

  async function addNote() {
    // A note created inside this folder inherits the folder's notebook -
    // `folder.notebookId` is guaranteed non-null in practice, see the
    // notebookId comment on the `Folder` type in types/index.ts (same
    // reasoning `addSubfolder` below already relies on).
    const id = await createNote(userId, "note", folder.notebookId as string, folder.id);
    setOpen(true);
    router.push(`/note?id=${id}`);
  }

  async function addCanvas() {
    const id = await createNote(userId, "canvas", folder.notebookId as string, folder.id);
    setOpen(true);
    router.push(`/canvas?id=${id}`);
  }

  async function addSubfolder() {
    // A new subfolder inherits its parent's notebook (folders don't move
    // between notebooks by being nested) - `folder.notebookId` is
    // guaranteed non-null in practice, see the notebookId comment on the
    // `Folder` type in types/index.ts.
    await createFolder(userId, "New Folder", folder.notebookId as string, folder.id);
    setOpen(true);
  }

  const paddingLeft = depth * 12 + 8;

  return (
    <div>
      <DropdownMenu>
        <div
          className="group flex items-center gap-1 rounded-md py-0.5 pr-1 cursor-pointer hover:bg-sidebar-accent transition-colors"
          style={{ paddingLeft }}
          onClick={() => setOpen((v) => !v)}
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
        </div>

        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={addNote}>
            <FilePlus className="mr-2 h-4 w-4" /> New note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={addCanvas}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> New canvas
          </DropdownMenuItem>
          <DropdownMenuItem onClick={addSubfolder}>
            <FolderPlus className="mr-2 h-4 w-4" /> New subfolder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={startRename}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
            />
          ))}
          {childNotes.map((n) => (
            <NoteItem key={n.id} note={n} userId={userId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
