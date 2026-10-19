// Theme variables hold complete CSS colors (mostly oklch(...), some hex), so
// conversion uses culori rather than hand-written OKLCH math. react-colorful
// only understands sRGB formats: values become hex for display, and every edit
// is written back as oklch(...), whatever its original format.

import { converter, formatHex8, parse, toGamut } from "culori";

const toOklch = converter("oklch");
// Gamut-maps by reducing chroma (CSS Color 4) instead of clamping channels,
// which would shift the hue of out-of-gamut colors.
const toGamutRgb = toGamut("rgb", "oklch");

const FALLBACK_PICKER_HEX = "#000000ff";

/** Unparseable values fall back to opaque black instead of throwing. */
export function themeColorToPickerHex(value: string | undefined): string {
  if (!value) return FALLBACK_PICKER_HEX;
  const parsed = parse(value);
  if (!parsed) return FALLBACK_PICKER_HEX;
  return formatHex8(toGamutRgb(parsed));
}

// Keeps written oklch() strings free of floating-point noise.
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
  // An achromatic color has no hue (culori leaves h undefined); write 0.
  const h = round(oklch.h ?? 0, 2);
  const alpha = oklch.alpha ?? 1;

  if (alpha >= 1) {
    return `oklch(${l} ${c} ${h})`;
  }
  return `oklch(${l} ${c} ${h} / ${round(alpha, 4)})`;
}
