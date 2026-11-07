"use client";

import { Check, Palette } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/appStore";
import {
  getNotePaletteSize,
  noteColorVar,
  resolveNoteColorSlot,
  type NoteColorSlot,
} from "@/lib/colors/noteColors";

/** "Color" submenu shared by the note and page row menus. */
export function ColorMenu({
  color,
  onChange,
}: {
  color: string | null;
  onChange: (slot: NoteColorSlot | null) => void;
}) {
  const current = resolveNoteColorSlot(color);
  const size = getNotePaletteSize();
  const slots = Array.from({ length: size }, (_, i) => `note-${i + 1}` as NoteColorSlot);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="mr-2 h-4 w-4" /> Color
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div className="grid grid-cols-4 gap-1 p-1">
          {slots.map((slot) => (
            <DropdownMenuItem
              key={slot}
              data-color-swatch={slot}
              aria-label={slot}
              className="h-6 w-6 justify-center rounded-full p-0"
              style={{ backgroundColor: noteColorVar(slot) }}
              onClick={() => onChange(slot)}
            >
              {current === slot && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" />}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuItem data-color-swatch="none" onClick={() => onChange(null)}>
          None
          {current === null && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Display settings for a row's color, read from the store (defaults until loaded). */
export function useRowColor(color: string | null) {
  const settings = useAppStore((s) => s.userSettings);
  const slot = resolveNoteColorSlot(color);
  return {
    slot,
    bookend: !!slot && (settings?.colorBookend ?? true),
    highlight: !!slot && (settings?.colorHighlight ?? false),
  };
}

/** `indent` is the bar's left offset in px, so it follows the row's nesting. */
export function RowColorMarks({
  slot,
  bookend,
  highlight,
  indent = 0,
}: ReturnType<typeof useRowColor> & { indent?: number }) {
  if (!slot) return null;
  const v = noteColorVar(slot);
  return (
    <>
      {highlight && (
        <span
          data-note-color-tint
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{ backgroundColor: `color-mix(in oklab, ${v} 18%, transparent)` }}
        />
      )}
      {bookend && (
        <span
          data-note-color-bar
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 w-1 rounded-full"
          style={{ backgroundColor: v, left: indent }}
        />
      )}
    </>
  );
}
