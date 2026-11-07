"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import {
  CHROMA_MAX,
  CHROMA_MIN,
  LIGHTNESS_MAX,
  LIGHTNESS_MIN,
  clamp,
  colorToHex,
  defaultPalette,
  generatedColor,
  hexToHue,
  normalizeHex,
  resolvedColor,
  withColorHue,
  withCount,
  withEndHue,
  withOverride,
  withShift,
} from "@/lib/colors/notePalette";
import { MAX_NOTE_PALETTE_SIZE, type NotePaletteSettings } from "@/lib/themes/types";
import { NoteColorPopover } from "./NoteColorPopover";

interface NotePaletteGeneratorProps {
  settings: NotePaletteSettings;
  onChange: (next: NotePaletteSettings) => void;
}

// Pointer position along a bar as a hue, 0 to 360.
function hueFromPointer(e: PointerEvent, bar: RefObject<HTMLDivElement | null>): number {
  const rect = bar.current?.getBoundingClientRect();
  if (!rect || rect.width === 0) return 0;
  return clamp(((e.clientX - rect.left) / rect.width) * 360, 0, 360);
}

// Capture-based drag: calls onMove with the hue under the pointer.
function dragProps(
  bar: RefObject<HTMLDivElement | null>,
  onStart: ((hue: number) => void) | null,
  onMove: (hue: number) => void,
) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const hue = hueFromPointer(e, bar);
      onStart?.(hue);
      onMove(hue);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(hueFromPointer(e, bar));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
  };
}

// Text-looking number input; commits only valid in-range values and snaps back
// on blur.
function InlineNumber({
  value,
  min,
  max,
  step,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
      }}
      className="w-12 border-b border-transparent bg-transparent text-right text-xs tabular-nums text-sidebar-foreground outline-none hover:border-dotted hover:border-muted-foreground focus:border-muted-foreground"
    />
  );
}

// Looks like text; typing a valid hex commits, and blur shows the normalized hex.
function InlineHex({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  return (
    <input
      aria-label={label}
      value={text}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const hex = normalizeHex(e.target.value);
        if (hex) onCommit(hex);
      }}
      className="w-[4.25rem] border-b border-transparent bg-transparent text-xs tabular-nums text-sidebar-foreground outline-none hover:border-dotted hover:border-muted-foreground focus:border-muted-foreground"
    />
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-sidebar-foreground">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
      />
      <InlineNumber
        label={`${label} value`}
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={0.01}
        onCommit={(n) => onChange(Number(n.toFixed(2)))}
      />
    </div>
  );
}

// Swatch strip, hue bar, global bar and numeric controls for one note palette.
export function NotePaletteGenerator({ settings, onChange }: NotePaletteGeneratorProps) {
  const hueBarRef = useRef<HTMLDivElement>(null);
  const globalBarRef = useRef<HTMLDivElement>(null);
  // Hues at the start of a circle drag, so the shift doesn't compound.
  const shiftBase = useRef<{ settings: NotePaletteSettings; hue: number } | null>(null);

  const { count, hues, lightness, chroma } = settings;
  const startHue = hues[0];
  const endHue = hues[count - 1];
  const midHue = (startHue + endHue) / 2;

  const spectrum = `linear-gradient(to right, ${Array.from(
    { length: 13 },
    (_, i) => `${generatedColor(settings, i * 30)} ${(i / 12) * 100}%`,
  ).join(", ")})`;

  const [countText, setCountText] = useState(String(count));
  useEffect(() => setCountText(String(count)), [count]);

  function commitEndHex(end: "start" | "end", hex: string) {
    const hue = hexToHue(hex);
    if (hue !== null) onChange(withEndHue(settings, end, hue));
  }

  const startColor = resolvedColor(settings, 0);
  const endColor = resolvedColor(settings, count - 1);

  return (
    <div className="flex flex-col gap-2 py-1" data-note-palette-generator="">
      <div className="flex w-full gap-px" data-note-strip="">
        {hues.map((_, i) => {
          const color = resolvedColor(settings, i);
          const overridden = settings.overrides[i] !== null;
          return (
            <NoteColorPopover
              key={i}
              hex={colorToHex(color)}
              isOverridden={overridden}
              onPick={(hex) => onChange(withOverride(settings, i, hex))}
              onResetToHue={() => onChange(withOverride(settings, i, null))}
              trigger={
                <button
                  type="button"
                  aria-label={`Note color ${i + 1}`}
                  data-note-swatch={i + 1}
                  data-overridden={overridden ? "" : undefined}
                  className="relative h-7 min-w-0 flex-1 first:rounded-l-md last:rounded-r-md"
                  style={{ backgroundColor: color }}
                >
                  {overridden && (
                    <span
                      data-note-override-dot=""
                      className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-black/40"
                    />
                  )}
                </button>
              }
            />
          );
        })}
      </div>

      <div
        ref={hueBarRef}
        data-note-hue-bar=""
        className="relative h-4 w-full rounded-sm"
        style={{ background: spectrum }}
      >
        {hues.map((hue, i) => (
          <div
            key={i}
            data-note-hue-line={i + 1}
            title={`Color ${i + 1} hue`}
            className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${(hue / 360) * 100}%` }}
            {...dragProps(hueBarRef, null, (h) => onChange(withColorHue(settings, i, h)))}
          >
            <span className="pointer-events-none absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
          </div>
        ))}
      </div>

      <div ref={globalBarRef} data-note-global-bar="" className="relative h-3.5 w-full">
        <div
          className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${(Math.min(startHue, endHue) / 360) * 100}%`,
            width: `${(Math.abs(endHue - startHue) / 360) * 100}%`,
            background: `linear-gradient(to right, ${generatedColor(settings, Math.min(startHue, endHue))}, ${generatedColor(settings, Math.max(startHue, endHue))})`,
          }}
        />
        {(["start", "end"] as const).map((end) => {
          const hue = end === "start" ? startHue : endHue;
          return (
            <div
              key={end}
              data-note-global-end={end}
              title={`Move ${end} hue`}
              className="absolute top-0 h-full w-1 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{
                left: `${(hue / 360) * 100}%`,
                backgroundColor: generatedColor(settings, hue),
              }}
              {...dragProps(globalBarRef, null, (h) => onChange(withEndHue(settings, end, h)))}
            />
          );
        })}
        <div
          data-note-global-center=""
          title="Shift all hues"
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{
            left: `${(midHue / 360) * 100}%`,
            backgroundColor: generatedColor(settings, midHue),
          }}
          {...dragProps(
            globalBarRef,
            (h) => {
              shiftBase.current = { settings, hue: h };
            },
            (h) => {
              const base = shiftBase.current;
              if (base) onChange(withShift(base.settings, h - base.hue));
            },
          )}
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="note-palette-count" className="text-xs text-sidebar-foreground">
          Colors
        </label>
        <input
          id="note-palette-count"
          type="number"
          min={1}
          max={MAX_NOTE_PALETTE_SIZE}
          step={1}
          value={countText}
          onChange={(e) => {
            setCountText(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (Number.isInteger(n) && n >= 1 && n <= MAX_NOTE_PALETTE_SIZE) {
              onChange(withCount(settings, n));
            }
          }}
          onBlur={() => setCountText(String(count))}
          className="h-6 w-14 rounded-md border border-input bg-transparent px-1.5 text-xs tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button
          type="button"
          onClick={() => onChange(defaultPalette())}
          className="ml-auto rounded-md border border-input px-2 py-0.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: startColor }}
        />
        <span>start</span>
        <InlineHex
          label="Start hex"
          value={colorToHex(startColor)}
          onCommit={(hex) => commitEndHex("start", hex)}
        />
        <span
          className="ml-1 h-3.5 w-3.5 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: endColor }}
        />
        <span>end</span>
        <InlineHex
          label="End hex"
          value={colorToHex(endColor)}
          onCommit={(hex) => commitEndHex("end", hex)}
        />
      </div>

      <SliderRow
        label="Lightness"
        value={lightness}
        min={LIGHTNESS_MIN}
        max={LIGHTNESS_MAX}
        onChange={(v) => onChange({ ...settings, lightness: v })}
      />
      <SliderRow
        label="Chroma"
        value={chroma}
        min={CHROMA_MIN}
        max={CHROMA_MAX}
        onChange={(v) => onChange({ ...settings, chroma: v })}
      />
    </div>
  );
}
