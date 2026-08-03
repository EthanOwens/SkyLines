"use client";

import { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Pencil, Trash2 } from "lucide-react";
import { updateNote, deleteNote } from "@/lib/db/notes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Note } from "@/types";

// Ported from ../note_taking_app/components/sidebar/NoteItem.tsx (spec.md
// subtask 16). Mutations now go through the SQLite-backed lib/db/notes.ts
// instead of lib/firestore/notes.ts. The note/canvas `href` is built with
// the query-param routing form (/note?id=..., /canvas?id=...) per subtask 5
// instead of /note/[id] / /canvas/[id]. The "···" trigger uses
// `<DropdownMenuTrigger render={<button .../>} />` instead of the
// reference's `asChild` - see components/sidebar/Sidebar.tsx's header
// comment for why.

interface Props {
  note: Note;
  userId: string;
  depth: number;
}

export function NoteItem({ note, depth }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(note.title || "Untitled");
  const inputRef = useRef<HTMLInputElement>(null);

  const href = note.type === "canvas" ? `/canvas?id=${note.id}` : `/note?id=${note.id}`;
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

  return (
    <DropdownMenu>
      <div
        className={`group flex items-center gap-1.5 rounded-md py-0.5 pr-1 cursor-pointer transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-foreground"
            : "hover:bg-sidebar-accent"
        }`}
        style={{ paddingLeft }}
        onClick={() => !renaming && router.push(href)}
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

      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} className="text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
