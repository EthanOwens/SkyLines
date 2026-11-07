import { MAX_NOTE_PALETTE_SIZE } from "@/lib/themes/types";

export type NoteColorSlot = `note-${number}`;

export const NOTE_COLOR_SLOTS: readonly NoteColorSlot[] = Array.from(
  { length: MAX_NOTE_PALETTE_SIZE },
  (_, i) => `note-${i + 1}` as const,
);

export function isNoteColorSlot(value: unknown): value is NoteColorSlot {
  return typeof value === "string" && (NOTE_COLOR_SLOTS as readonly string[]).includes(value);
}

export function noteColorVar(slot: NoteColorSlot): string {
  return `var(--${slot})`;
}

/**
 * Number of consecutive non-empty --note-N variables on the document root,
 * starting from 1. 0 means no palette.
 */
export function getNotePaletteSize(): number {
  const style = getComputedStyle(document.documentElement);
  let size = 0;
  while (
    size < MAX_NOTE_PALETTE_SIZE &&
    style.getPropertyValue(`--note-${size + 1}`).trim() !== ""
  ) {
    size++;
  }
  return size;
}

/** The slot if it is valid and inside the current palette, else null (no color). */
export function resolveNoteColorSlot(value: unknown): NoteColorSlot | null {
  if (!isNoteColorSlot(value)) return null;
  const n = Number(value.slice("note-".length));
  return n <= getNotePaletteSize() ? value : null;
}
