"use client";

import { useState, useRef, useEffect } from "react";
import type { DragEvent } from "react";
import { FileText, Pencil, Trash2, Scissors, Copy } from "lucide-react";
import { updatePage, deletePage } from "@/lib/db/pages";
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
import type { Page } from "@/types";

// Row for a single Page inside PageSidebar.tsx (spec.md M6 subtask 17, "Page
// sidebar"). Deliberately modeled on components/sidebar/NoteItem.tsx's exact
// row structure/drag/context-menu pattern (reused, not reimplemented, per
// spec.md's "reuse lib/dnd/sidebar.ts and lib/clipboard/sidebarClipboard.ts"
// guidance) - the differences from NoteItem are only what pages genuinely
// don't have: no router navigation (clicking a page row selects it via
// `onSelect`/stores/appStore.ts's `selectedPageId` instead of routing to a
// new URL - CanvasEditor.tsx re-renders in place), and no "Paste" item here
// (same as NoteItem - pasting only makes sense on a container, which for
// pages is the PageSidebar's own outer list, mirroring FolderTree.tsx's
// root-level "Paste").

interface Props {
  page: Page;
  isActive: boolean;
  siblingPageIds: string[];
  onSelect: () => void;
  /** Called after any mutation (rename/delete/reorder) that changes the
   * page list or its order, so PageSidebar.tsx can refetch and - for a
   * delete of the currently-selected page - fall back to selecting another
   * page. */
  onChanged: () => void;
}

export function PageItem({ page, isActive, siblingPageIds, onSelect, onChanged }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title || "Untitled");
  const [dropPosition, setDropPosition] = useState<RowDropPosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setClipboard = useAppStore((s) => s.setClipboard);

  // Resyncs from an external rename (e.g. the canvas title header) - not
  // depended on `renaming` so it can't clobber an in-progress edit or the
  // optimistic title commitRename() just set locally.
  useEffect(() => {
    if (!renaming) setTitle(page.title || "Untitled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.title]);

  function startRename() {
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 10);
  }

  async function commitRename() {
    setRenaming(false);
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== page.title) {
      await updatePage(page.id, { title: trimmed });
      onChanged();
    }
  }

  async function handleDelete() {
    await deletePage(page.id);
    onChanged();
  }

  function handleCut() {
    setClipboard({ kind: "cut", type: "page", id: page.id });
  }

  function handleCopy() {
    setClipboard({ kind: "copy", type: "page", id: page.id });
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (renaming) {
      e.preventDefault();
      return;
    }
    setSidebarDragPayload(e, { type: "page", id: page.id });
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isSidebarDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
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
    if (!payload || !position || payload.type !== "page" || payload.id === page.id) return;

    const reindexed = reindexSiblings(siblingPageIds, payload.id, page.id, position);
    for (const { id, order } of reindexed) {
      await updatePage(id, { order });
    }
    onChanged();
  }

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
        <div className="mx-2 h-0.5 rounded-full bg-primary" />
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
              className={`group flex items-center gap-1.5 rounded-md py-1 pl-3 pr-1 cursor-pointer transition-colors ${
                isActive ? "bg-sidebar-accent text-sidebar-foreground" : "hover:bg-sidebar-accent"
              }`}
              onClick={() => !renaming && onSelect()}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

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
                    if (e.key === "Escape") { setTitle(page.title); setRenaming(false); }
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
        <div className="mx-2 h-0.5 rounded-full bg-primary" />
      )}
    </div>
  );
}
