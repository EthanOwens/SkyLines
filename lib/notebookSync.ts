// Shared helper (spec.md subtask 14, "Back/forward navigation") for keeping
// `selectedNotebookId` (stores/appStore.ts) in sync with whichever note is
// actually being viewed. Factored out of AppShell.tsx's restore effect,
// which already implemented this exact validation for the "restore last-open
// note on cold launch" case - app/note/page.tsx and app/canvas/page.tsx need
// the identical logic on every note load (not just a cold-launch restore),
// since a deep link or Back/Forward navigation can land on a note belonging
// to a different notebook than whatever's currently selected.

import type { Notebook } from "@/types";

/**
 * Resolves the notebook id that should be set as `selectedNotebookId` for a
 * note whose own `notebookId` is `noteNotebookId`.
 *
 * - `null` notebookId (a folder-less/root-level note with no notebook
 *   association) resolves to `null` directly - nothing to validate.
 * - If `notebooks` hasn't finished its first load yet (`notebooksLoaded`
 *   false), it's not yet safe to conclude a non-null id is invalid, so it's
 *   trusted optimistically.
 * - Once loaded, the id is only trusted if it's actually present in the live
 *   `notebooks` array; a stale/deleted notebook id falls back to `null`
 *   rather than being blindly trusted (mirrors AppShell.tsx's restore
 *   effect).
 */
export function resolveNoteNotebookId(
  noteNotebookId: string | null,
  notebooks: Notebook[],
  notebooksLoaded: boolean,
): string | null {
  if (noteNotebookId === null) return null;
  if (!notebooksLoaded) return noteNotebookId;
  return notebooks.some((n) => n.id === noteNotebookId) ? noteNotebookId : null;
}
