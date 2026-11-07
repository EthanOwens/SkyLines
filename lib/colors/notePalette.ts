// Pure logic behind the theme editor's note palette generator.

import { converter, parse } from "culori";
import { themeColorToPickerHex } from "@/lib/themes/color";
import {
  MAX_NOTE_PALETTE_SIZE,
  type NotePaletteSettings,
  type NoteVariableKey,
  type Theme,
} from "@/lib/themes/types";

const toOklch = converter("oklch");

export const LIGHTNESS_MIN = 0.3;
export const LIGHTNESS_MAX = 0.95;
export const CHROMA_MIN = 0;
export const CHROMA_MAX = 0.4;

const DEFAULT_COUNT = 8;
const DEFAULT_START_HUE = 25;
const DEFAULT_END_HUE = 340;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** Evenly spaced hues from start to end; a single color sits at start. */
export function spaceHues(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
}

export function defaultPalette(): NotePaletteSettings {
  return {
    count: DEFAULT_COUNT,
    hues: spaceHues(DEFAULT_START_HUE, DEFAULT_END_HUE, DEFAULT_COUNT),
    lightness: 0.66,
    chroma: 0.16,
    overrides: Array<string | null>(DEFAULT_COUNT).fill(null),
  };
}

/** "#rrggbb" for any CSS color, gamut-mapped. */
export function colorToHex(color: string): string {
  return themeColorToPickerHex(color).slice(0, 7);
}

/** Accepts "abc", "#abc", "#aabbcc"; returns lowercase "#rrggbb" or null. */
export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h}`;
}

/** Oklch hue of a hex color, 0 to 360. */
export function hexToHue(hex: string): number | null {
  const parsed = parse(hex);
  if (!parsed) return null;
  return toOklch(parsed).h ?? 0;
}

export function generatedColor(s: NotePaletteSettings, hue: number): string {
  return `oklch(${round(s.lightness, 2)} ${round(s.chroma, 2)} ${round(hue, 1)})`;
}

export function resolvedColor(s: NotePaletteSettings, index: number): string {
  return s.overrides[index] ?? generatedColor(s, s.hues[index]);
}

export function paletteVariables(
  s: NotePaletteSettings,
): Partial<Record<NoteVariableKey, string>> {
  const out: Partial<Record<NoteVariableKey, string>> = {};
  for (let i = 0; i < s.count; i++) {
    out[`note-${i + 1}` as NoteVariableKey] = resolvedColor(s, i);
  }
  return out;
}

/** Clamps and repairs stored settings; null when they are unusable. */
export function sanitizePalette(value: unknown): NotePaletteSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const count = v.count;
  if (typeof count !== "number" || !Number.isInteger(count)) return null;
  if (count < 1 || count > MAX_NOTE_PALETTE_SIZE) return null;
  if (!Array.isArray(v.hues) || v.hues.length !== count) return null;
  if (!v.hues.every((h) => typeof h === "number" && Number.isFinite(h))) return null;
  if (typeof v.lightness !== "number" || typeof v.chroma !== "number") return null;

  const rawOverrides = Array.isArray(v.overrides) ? v.overrides : [];
  return {
    count,
    hues: (v.hues as number[]).map((h) => clamp(h, 0, 360)),
    lightness: clamp(v.lightness, LIGHTNESS_MIN, LIGHTNESS_MAX),
    chroma: clamp(v.chroma, CHROMA_MIN, CHROMA_MAX),
    overrides: Array.from({ length: count }, (_, i) =>
      typeof rawOverrides[i] === "string" ? normalizeHex(rawOverrides[i] as string) : null,
    ),
  };
}

/**
 * Stored settings if valid; otherwise the theme's note colors become overrides
 * on a default generator.
 */
export function paletteForTheme(theme: Theme): NotePaletteSettings {
  const stored = sanitizePalette(theme.notePalette);
  if (stored) return stored;

  const base = defaultPalette();
  const colors: string[] = [];
  for (let i = 0; i < MAX_NOTE_PALETTE_SIZE; i++) {
    const c = theme.variables[`note-${i + 1}` as NoteVariableKey];
    if (!c) break;
    colors.push(c);
  }
  if (colors.length === 0) return base;

  const hues = colors.map((c, i) => {
    const parsed = parse(c);
    return parsed ? clamp(toOklch(parsed).h ?? 0, 0, 360) : base.hues[i] ?? 0;
  });
  return {
    ...base,
    count: colors.length,
    hues,
    overrides: colors.map(colorToHex),
  };
}

/** Changes the color count, respacing between the current ends. */
export function withCount(s: NotePaletteSettings, count: number): NotePaletteSettings {
  const n = clamp(Math.round(count), 1, MAX_NOTE_PALETTE_SIZE);
  const start = s.hues[0];
  const end = s.hues[s.count - 1];
  return {
    ...s,
    count: n,
    hues: spaceHues(start, end, n),
    overrides: Array.from({ length: n }, (_, i) => s.overrides[i] ?? null),
  };
}

/** Moves one end (0 = start, 1 = end) and respaces everything between. */
export function withEndHue(
  s: NotePaletteSettings,
  end: "start" | "end",
  hue: number,
): NotePaletteSettings {
  const h = clamp(hue, 0, 360);
  const start = end === "start" ? h : s.hues[0];
  const stop = end === "end" ? h : s.hues[s.count - 1];
  return { ...s, hues: spaceHues(start, stop, s.count) };
}

/** Changes one color's hue and drops its override. */
export function withColorHue(
  s: NotePaletteSettings,
  index: number,
  hue: number,
): NotePaletteSettings {
  const hues = [...s.hues];
  hues[index] = clamp(hue, 0, 360);
  const overrides = [...s.overrides];
  overrides[index] = null;
  return { ...s, hues, overrides };
}

export function withOverride(
  s: NotePaletteSettings,
  index: number,
  hex: string | null,
): NotePaletteSettings {
  const overrides = [...s.overrides];
  overrides[index] = hex;
  return { ...s, overrides };
}

/** Shifts every hue by delta, limited so none leaves 0 to 360. */
export function withShift(
  base: NotePaletteSettings,
  delta: number,
): NotePaletteSettings {
  const d = clamp(delta, -Math.min(...base.hues), 360 - Math.max(...base.hues));
  return { ...base, hues: base.hues.map((h) => h + d) };
}
