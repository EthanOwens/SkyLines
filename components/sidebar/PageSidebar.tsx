"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import { ChevronLeft, ChevronRight, Clipboard, Plus } from "lucide-react";
import { createPage, getPages, updatePage } from "@/lib/db/pages";
import { isSidebarDragEvent, nextOrderValue, readSidebarDragPayload } from "@/lib/dnd/sidebar";
import { pastePageClipboardEntry } from "@/lib/clipboard/sidebarClipboard";
import { useAppStore } from "@/stores/appStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { PageItem } from "./PageItem";
import type { Note } from "@/types";

// Sidebar listing the open note's pages. Shares the store's pages and
// selectedPageId with CanvasEditor, so selecting a row switches the canvas
// directly. Reuses lib/dnd/sidebar.ts (reorder only; pages don't nest) and the
// sidebar clipboard.

interface Props {
  note: Note;
}

export function PageSidebar({ note }: Props) {
  const pages = useAppStore((s) => s.pages);
  const setPages = useAppStore((s) => s.setPages);
  const selectedPageId = useAppStore((s) => s.selectedPageId);
  const setSelectedPageId = useAppStore((s) => s.setSelectedPageId);
  const pagesLoading = useAppStore((s) => s.pagesLoading);
  const clipboard = useAppStore((s) => s.clipboard);
  const setClipboard = useAppStore((s) => s.setClipboard);

  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rootDropActive, setRootDropActive] = useState(false);

  const orderedPages = [...pages].sort((a, b) => a.order - b.order);
  const pageIds = orderedPages.map((p) => p.id);

  // The only thing keeping pages fresh after CanvasEditor's initial load.
  // Selects preferId when present; if the selected page is gone, falls back to
  // the first page so the canvas never points at a deleted page.
  async function refresh(preferId?: string) {
    const fresh = await getPages(note.id);
    setPages(fresh);
    const currentSelected = useAppStore.getState().selectedPageId;
    if (preferId && fresh.some((p) => p.id === preferId)) {
      setSelectedPageId(preferId);
    } else if (!fresh.some((p) => p.id === currentSelected)) {
      setSelectedPageId(fresh[0]?.id ?? null);
    }
  }

  async function handleAddPage() {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createPage(
        note.id,
        note.userId,
        "Untitled",
        nextOrderValue(pages.map((p) => p.order)),
      );
      await refresh(newId);
    } finally {
      setCreating(false);
    }
  }

  async function handlePasteToEnd() {
    if (!clipboard || clipboard.type !== "page") return;
    const pasted = await pastePageClipboardEntry(clipboard, { noteId: note.id }, pages);
    if (pasted && clipboard.kind === "cut") {
      setClipboard(null);
    }
    if (pasted) await refresh();
  }

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

  async function handleRootDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setRootDropActive(false);
    const payload = readSidebarDragPayload(e);
    if (!payload || payload.type !== "page") return;
    // Dropped below the list: move to the end.
    await updatePage(payload.id, { order: nextOrderValue(pages.map((p) => p.order)) });
    await refresh();
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center gap-2 bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" onClick={() => setCollapsed(false)} className="h-8 w-8">
                <ChevronRight className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="right">Show pages</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-full w-52 shrink-0 flex-col bg-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-sm font-semibold text-sidebar-foreground">Pages</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleAddPage}
                  disabled={creating}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent>Add page</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed(true)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent>Hide pages</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Separator />

      <ScrollArea className="flex-1 px-1 py-1">
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                className={`min-h-full rounded-md transition-colors ${
                  rootDropActive ? "bg-sidebar-accent/50 ring-1 ring-inset ring-sidebar-ring" : ""
                }`}
                onDragOver={handleRootDragOver}
                onDragLeave={handleRootDragLeave}
                onDrop={handleRootDrop}
              >
                {pagesLoading ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
                ) : orderedPages.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No pages yet.</p>
                ) : (
                  orderedPages.map((page) => (
                    <PageItem
                      key={page.id}
                      page={page}
                      isActive={page.id === selectedPageId}
                      siblingPageIds={pageIds}
                      onSelect={() => setSelectedPageId(page.id)}
                      onChanged={() => void refresh()}
                    />
                  ))
                )}
              </div>
            }
          />
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={handlePasteToEnd} disabled={!clipboard || clipboard.type !== "page"}>
              <Clipboard className="mr-2 h-4 w-4" /> Paste
            </DropdownMenuItem>
          </DropdownMenuContent>
        </ContextMenu>
      </ScrollArea>
    </div>
  );
}
