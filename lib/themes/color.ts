// Color-space conversion helpers for the theme editor's color-wheel picker
// (spec.md M7 subtask 15).
//
// This app's theme variables store COMPLETE CSS `<color>` values, not bare
// component numbers - see lib/themes/builtin.ts: most built-in themes use
// `oklch(...)` strings (with some using the `/ <alpha>` syntax for
// translucent borders), while GRUVBOX_DARK_THEME uses plain hex. A prior
// subtask (M5 #8) already hit a real bug from wrongly assuming these were
// bare HSL components, so this module leans on a real, well-tested
// color-conversion library (`culori`) rather than hand-rolling OKLCH<->sRGB
// math.
//
// The color-wheel library chosen for this subtask (`react-colorful`) only
// understands sRGB-ish formats (hex/rgb/hsl/hsv), not OKLCH, so every value
// has to be converted to a picker-friendly hex string for display and
// converted back on change. Design choice: regardless of a variable's
// *original* stored format (hex or oklch), any value edited through the
// picker is normalized to `oklch(...)` going forward - oklch is what the
// large majority of this app's built-in themes already use, it's a
// perceptually-uniform space well suited to a color-wheel UI, and it's a
// valid standalone CSS `<color>` value, which is all lib/themes/apply.ts
// requires (it just does `style.setProperty(--key, value)`).

import { converter, formatHex8, parse, toGamut } from "culori";

const toOklch = converter("oklch");
// Maps an arbitrary color into the sRGB gamut using perceptually-aware
// gamut mapping (CSS Color 4's recommended approach: hold lightness/hue
// fixed and reduce chroma until the color fits, falling back to a clip at
// the gamut boundary), rather than `converter("rgb")`'s raw output, which
// can have out-of-[0,1] channels for out-of-gamut OKLCH colors that
// `formatHex8` would otherwise naively (and hue-shiftingly) clamp.
const toGamutRgb = toGamut("rgb", "oklch");

// Fallback shown when a stored value fails to parse (e.g. an empty string
// for a not-yet-set variable) - opaque black, a safe default starting point.
const FALLBACK_PICKER_HEX = "#000000ff";

/**
 * Converts a theme variable's stored CSS color value (oklch(...), hex,
 * rgb(...), etc.) into the 8-digit hex string react-colorful's
 * `HexAlphaColorPicker`/`HexColorInput` expect for display. Values that fail
 * to parse (unset, malformed) fall back to opaque black rather than
 * throwing, since this is only ever used to seed a picker's displayed value.
 */
export function themeColorToPickerHex(value: string | undefined): string {
  if (!value) return FALLBACK_PICKER_HEX;
  const parsed = parse(value);
  if (!parsed) return FALLBACK_PICKER_HEX;
  return formatHex8(toGamutRgb(parsed));
}

// Rounds to `digits` decimal places, used to keep the written-back oklch()
// strings readable instead of carrying full floating-point noise through
// the hex -> rgb -> oklch round trip.
function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/**
 * Converts a hex color string (as produced by react-colorful, e.g.
 * "#rrggbb" or "#rrggbbaa") into the `oklch(...)` CSS string this module
 * writes back into `draftVariables`. See the module-level comment for why
 * oklch is the chosen write-back format regardless of the variable's
 * original format.
 */
export function pickerHexToThemeColor(hex: string): string {
  const parsed = parse(hex);
  if (!parsed) return hex;

  const oklch = toOklch(parsed);
  const l = round(oklch.l ?? 0, 4);
  const c = round(oklch.c ?? 0, 4);
  // A fully achromatic color (chroma 0) has no meaningful hue - culori
  // leaves `h` undefined in that case, matching CSS's "none" keyword, but a
  // plain `0` is just as valid and simpler to read/round-trip.
  const h = round(oklch.h ?? 0, 2);
  const alpha = oklch.alpha ?? 1;

  if (alpha >= 1) {
    return `oklch(${l} ${c} ${h})`;
  }
  return `oklch(${l} ${c} ${h} / ${round(alpha, 4)})`;
}
