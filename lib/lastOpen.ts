// Last-open notebook/section/note persistence (spec.md subtask 5,
// "Last-open persistence"). Per the spec's Non-Goals, this is deliberately
// per-device `localStorage` state, not pushed through the Firestore sync
// engine - it's UI convenience state, not user data, so there's no
// dirty/syncedAt/deletedAt bookkeeping here, unlike lib/db/*.ts.
//
// This is intentionally a single "most recent note" record, not a history
// stack - a future back/forward navigation stack (spec.md subtask 14) is a
// separate, later concern.

import type { Note } from "@/types";
import { getFolderById } from "@/lib/db/folders";

const STORAGE_KEY = "skylines:lastOpen";

export interface LastOpenState {
  notebookId: string | null;
  folderId: string | null;
  // Nullable (spec.md subtask 6, "Notebook picker"): a notebook can be
  // "open" with no note selected/opened yet - e.g. right after picking a
  // notebook from the picker, before any note exists or has been opened.
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
 * Reads the last-open state from `localStorage`. Returns `null` if
 * `localStorage` is unavailable (SSR/static export build-time rendering),
 * nothing has been stored yet, or the stored value is corrupt/malformed -
 * never throws.
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

/**
 * Records the last-open notebook/section/note triple. Silently no-ops if
 * `localStorage` is unavailable - this is best-effort convenience state, not
 * something worth surfacing an error for.
 */
export function setLastOpen(state: LastOpenState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable/full/disabled - nothing meaningful to do.
  }
}

/**
 * Records that `notebookId` was just opened (selected from the notebook
 * picker, spec.md subtask 6) with no section/note chosen yet. Distinct from
 * `recordNoteOpened` below, which records a specific note - this is for the
 * "notebook open, nothing else selected" state the picker itself produces.
 */
export function setLastOpenNotebook(notebookId: string): void {
  setLastOpen({ notebookId, folderId: null, noteId: null });
}

/**
 * Records that `note` was just opened as the last-open note, looking up its
 * parent folder to derive `notebookId` (`Note` only carries `folderId`
 * directly - see types/index.ts). Folder-less notes are the common case
 * (e.g. notes created directly under a notebook via Sidebar.tsx's "New
 * Note"/"New Canvas" buttons) and are recorded with `notebookId`/`folderId`
 * both `null` rather than being skipped. If `note.folderId` points at a
 * folder that can't be found (a stale/broken reference), the note is still
 * recorded the same way, since `noteId` - the only field the restore path
 * actually consumes - is still valid.
 *
 * Called from app/note/page.tsx and app/canvas/page.tsx once a note has
 * successfully loaded.
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
