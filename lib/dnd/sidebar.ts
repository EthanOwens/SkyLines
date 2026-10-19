import type { DragEvent } from "react";
import type { Folder } from "@/types";

// Drag-and-drop helpers for the sidebar, using native HTML5 drag and drop.
//
// A custom MIME type, so text dragged in from elsewhere is never mistaken for a
// sidebar item.
export const SIDEBAR_DRAG_MIME = "application/x-skylines-sidebar-item";

export type SidebarDragPayload = {
  // Pages only reorder; they never nest.
  type: "folder" | "note" | "page";
  id: string;
};

export function setSidebarDragPayload(e: DragEvent, payload: SidebarDragPayload): void {
  e.dataTransfer.setData(SIDEBAR_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

export function readSidebarDragPayload(e: DragEvent): SidebarDragPayload | null {
  // getData returns "" during dragover in some browsers, because data is only
  // readable on drop. Check dataTransfer.types during dragover instead.
  const raw = e.dataTransfer.getData(SIDEBAR_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      ((parsed as SidebarDragPayload).type === "folder" ||
        (parsed as SidebarDragPayload).type === "note" ||
        (parsed as SidebarDragPayload).type === "page") &&
      typeof (parsed as SidebarDragPayload).id === "string"
    ) {
      return parsed as SidebarDragPayload;
    }
  } catch {
    // Not a sidebar drag payload - ignore.
  }
  return null;
}

export function isSidebarDragEvent(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(SIDEBAR_DRAG_MIME);
}

/** Walks up from the target, since a folder has a single parent chain. */
export function isFolderOrDescendant(
  allFolders: Folder[],
  candidateFolderId: string,
  targetFolderId: string,
): boolean {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  let current: string | null = targetFolderId;
  while (current) {
    if (current === candidateFolderId) return true;
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/** The next order value to append an item to the end of a sibling list. */
export function nextOrderValue(siblingOrders: number[]): number {
  return siblingOrders.length === 0 ? 0 : Math.max(...siblingOrders) + 1;
}

/**
 * Reindexes every sibling to small integers instead of fractional orders;
 * sibling lists are small.
 */
export function reindexSiblings(
  orderedIds: string[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
): { id: string; order: number }[] {
  const withoutDragged = orderedIds.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  const insertAt = targetIndex === -1 ? withoutDragged.length : position === "before" ? targetIndex : targetIndex + 1;
  const next = [...withoutDragged.slice(0, insertAt), draggedId, ...withoutDragged.slice(insertAt)];
  return next.map((id, index) => ({ id, order: index }));
}

/** Drop position relative to a row, driven by cursor position within it. */
export type RowDropPosition = "before" | "after" | "inside";

/**
 * The middle 25-75% band means "inside" only when allowInside is set; otherwise
 * the row splits into top and bottom halves.
 */
export function resolveRowDropPosition(
  e: DragEvent,
  rect: DOMRect,
  allowInside: boolean,
): RowDropPosition {
  const ratio = (e.clientY - rect.top) / rect.height;
  if (allowInside) {
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}
