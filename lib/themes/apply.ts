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
