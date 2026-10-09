// Per-device UI state in localStorage, deliberately not synced.

import type { Note } from "@/types";
import { getFolderById } from "@/lib/db/folders";

const STORAGE_KEY = "skylines:lastOpen";

export interface LastOpenState {
  notebookId: string | null;
  folderId: string | null;
  // Null while a notebook is open with no note chosen yet.
  noteId: string | null;
}

function isLastOpenState(value: unknown): value is LastOpenState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.notebookId === "string" || v.notebookId === null) &&
    (typeof v.folderId === "string" || v.folderId === null) &&
    (v.noteId === null || (typeof v.noteId === "string" && v.noteId.length > 0))
  );
}

/**
 * Returns null when localStorage is unavailable (static export build), empty or
 * corrupt. Never throws.
 */
export function getLastOpen(): LastOpenState | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isLastOpenState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort; does nothing when localStorage is unavailable. */
export function setLastOpen(state: LastOpenState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable/full/disabled - nothing meaningful to do.
  }
}

/** A notebook opened from the picker, with no note yet. */
export function setLastOpenNotebook(notebookId: string): void {
  setLastOpen({ notebookId, folderId: null, noteId: null });
}

/**
 * Derives notebookId from the note's folder. Notes without a folder (common)
 * and notes whose folder can't be found are still recorded, because restore
 * only needs noteId.
 */
export async function recordNoteOpened(note: Note): Promise<void> {
  if (!note.folderId) {
    setLastOpen({ notebookId: null, folderId: null, noteId: note.id });
    return;
  }

  const folder = await getFolderById(note.folderId);
  if (!folder) {
    setLastOpen({ notebookId: null, folderId: null, noteId: note.id });
    return;
  }

  setLastOpen({
    notebookId: folder.notebookId,
    folderId: folder.id,
    noteId: note.id,
  });
}
