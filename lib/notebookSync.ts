// Keeps selectedNotebookId matched to the note being viewed. Used on every note
// load, because a deep link or Back/Forward can land on another notebook's
// note.

import type { Notebook } from "@/types";

/**
 * null stays null. Before notebooks have loaded, a non-null id is trusted;
 * after that, an id that isn't in the list falls back to null.
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
