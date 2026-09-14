import type { DragEvent } from "react";
import type { Folder } from "@/types";

// Shared drag-and-drop helpers for the sidebar folder/note tree (spec.md M4
// subtask 7, "Sidebar drag-and-drop reordering"). Native HTML5 drag-and-drop
// (`draggable`/`onDragStart`/`onDragOver`/`onDrop`) is used rather than a
// third-party dnd library, since none is installed (confirmed via
// package.json) and the interaction needed here - reorder within a sibling
// list, or drop onto a folder to re-parent - doesn't need anything beyond
// what the native API already provides.

/** Custom MIME type used to carry the dragged item's identity through
 * `DataTransfer`. Kept distinct from `text/plain` so drags originating from
 * outside the sidebar (e.g. plain text dragged in from elsewhere) are never
 * misinterpreted as a sidebar item drop. */
export const SIDEBAR_DRAG_MIME = "application/x-skylines-sidebar-item";

export type SidebarDragPayload = {
  // "page" (spec.md M6 subtask 17, "Page sidebar") reuses this same generic
  // payload/MIME mechanism for reordering a note's Pages - pages don't nest
  // or re-parent (isFolderOrDescendant below is folder-only and doesn't
  // apply to them), so they only ever use the reorder ("before"/"after")
  // half of this module, never "inside".
  type: "folder" | "note" | "page";
  id: string;
};

export function setSidebarDragPayload(e: DragEvent, payload: SidebarDragPayload): void {
  e.dataTransfer.setData(SIDEBAR_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

export function readSidebarDragPayload(e: DragEvent): SidebarDragPayload | null {
  // `e.dataTransfer.getData` returns "" (not a thrown error) both when the
  // MIME type isn't present at all and during `dragover` in some browsers
  // (data is only readable in `drop` for security reasons) - callers that
  // need to distinguish "is this a sidebar drag at all" during `dragover`
  // should check `e.dataTransfer.types.includes(SIDEBAR_DRAG_MIME)` instead,
  // since the payload itself isn't reliably readable until `drop`.
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

/**
 * True if `targetFolderId` is `candidateFolderId` itself, or a descendant of
 * it - i.e. dropping `candidateFolderId` "into" `targetFolderId` would make
 * the folder its own descendant and corrupt the tree. Walks `parentId`
 * upward from `targetFolderId` rather than walking down from
 * `candidateFolderId`, since a folder only ever has one parent chain to
 * walk, regardless of how many descendants it has.
 */
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
 * Given an ordered list of sibling ids (all of the same type as the dragged
 * item), returns a full reindex - one 0-based `order` per id - reflecting
 * `draggedId` moved to just before/after `targetId`. Reindexing every
 * sibling (rather than only the ones that moved) keeps the resulting order
 * values simple, small integers instead of needing fractional/gap-based
 * insertion - sidebar sibling lists are small, so the extra writes are
 * cheap.
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
 * Resolves a `dragover` event's vertical position within `rect` to a
 * before/after/inside indicator. The middle band (25%-75% of the row's
 * height) resolves to "inside" only when `allowInside` is true (i.e. the
 * row is a folder that can accept a re-parent drop); otherwise the row is
 * split evenly into a "before" (top half) / "after" (bottom half) zone.
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
