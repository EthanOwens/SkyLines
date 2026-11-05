export const NOTE_COLOR_SLOTS = [
  "note-1",
  "note-2",
  "note-3",
  "note-4",
  "note-5",
  "note-6",
  "note-7",
  "note-8",
] as const;

export type NoteColorSlot = (typeof NOTE_COLOR_SLOTS)[number];

export function isNoteColorSlot(value: unknown): value is NoteColorSlot {
  return typeof value === "string" && (NOTE_COLOR_SLOTS as readonly string[]).includes(value);
}

export function noteColorVar(slot: NoteColorSlot): string {
  return `var(--${slot})`;
}
