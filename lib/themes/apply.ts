// Themes are applied as inline styles on <html>, which win over globals.css's
// :root/.dark rules. Variables a theme doesn't define fall through to
// globals.css.

import { THEME_VARIABLE_KEYS, type Theme } from "./types";

/**
 * Undefined keys are left alone; call clearThemeOverrides() first when
 * switching themes.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    if (value === undefined) continue;
    root.style.setProperty(`--${key}`, value);
  }
  setNoteKeys(theme.variables, false);
}

/**
 * Clears every known key, not just the last theme's, so no stale overrides
 * remain.
 */
export function clearThemeOverrides(): void {
  const root = document.documentElement;
  for (const key of THEME_VARIABLE_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
}

// `initial` is the guaranteed-invalid value for a custom property, so the color
// reads as empty instead of falling back to globals.css's default palette.
function setNoteKeys(variables: Theme["variables"], clearMissing: boolean): void {
  const root = document.documentElement;
  const hasPalette = variables["note-1"] !== undefined;
  for (const key of THEME_VARIABLE_KEYS) {
    if (!key.startsWith("note-")) continue;
    const value = variables[key];
    if (value !== undefined) root.style.setProperty(`--${key}`, value);
    else if (hasPalette) root.style.setProperty(`--${key}`, "initial");
    else if (clearMissing) root.style.removeProperty(`--${key}`);
  }
}

/**
 * Sets every note-* variable from `variables`. Colors beyond a theme's palette
 * are blanked; a theme with no palette at all falls through to globals.css.
 */
export function applyNoteVariables(variables: Theme["variables"]): void {
  setNoteKeys(variables, true);
}
