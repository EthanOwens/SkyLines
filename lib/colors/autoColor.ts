import { getDb } from "@/lib/db/client";
import { getUserSettings } from "@/lib/db/userSettings";
import { getNotePaletteSize, resolveNoteColorSlot, type NoteColorSlot } from "./noteColors";

/**
 * Slot for a new item: the one after the most recent colored sibling (wrapping
 * to note-1), note-1 with none, null when automatic coloring is off or there
 * is no palette. `siblingColors` is ordered oldest first.
 */
export function nextAutoColor(
  autoColor: boolean,
  siblingColors: readonly (string | null)[],
  paletteSize: number = getNotePaletteSize(),
): NoteColorSlot | null {
  if (!autoColor || paletteSize < 1) return null;
  for (let i = siblingColors.length - 1; i >= 0; i--) {
    const slot = resolveNoteColorSlot(siblingColors[i]);
    if (slot) {
      const n = Number(slot.slice("note-".length));
      return `note-${n >= paletteSize ? 1 : n + 1}`;
    }
  }
  return "note-1";
}

async function pageSiblingColors(noteId: string) {
  const db = await getDb();
  const rows = await db.select<{ color: string | null }[]>(
    "SELECT color FROM pages WHERE note_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC",
    [noteId],
  );
  return rows.map((r) => r.color);
}

// Each folder (or the notebook root, folderId null) is its own space. `IS`
// matches NULL folder ids, which `=` would not.
async function noteSiblingColors(notebookId: string, folderId: string | null) {
  const db = await getDb();
  const rows = await db.select<{ color: string | null }[]>(
    "SELECT color FROM notes WHERE notebook_id = $1 AND folder_id IS $2 AND deleted_at IS NULL ORDER BY created_at ASC",
    [notebookId, folderId],
  );
  return rows.map((r) => r.color);
}

export async function autoColorForNewNote(
  userId: string,
  notebookId: string,
  folderId: string | null,
): Promise<{ color: NoteColorSlot | null; firstPageColor: NoteColorSlot | null }> {
  const { autoColor } = await getUserSettings(userId);
  return {
    color: nextAutoColor(autoColor, await noteSiblingColors(notebookId, folderId)),
    firstPageColor: nextAutoColor(autoColor, []),
  };
}

export async function autoColorForNewPage(
  userId: string,
  noteId: string,
): Promise<NoteColorSlot | null> {
  const { autoColor } = await getUserSettings(userId);
  return nextAutoColor(autoColor, await pageSiblingColors(noteId));
}
