// Theme engine foundation (spec.md subtask 17, "Theme engine foundation").
// Applies a `Theme`'s variables as inline styles on `<html>`, which win over
// the CSS-file `:root`/`.dark` rules in app/globals.css - exactly what's
// wanted, since a theme's `Partial` `variables` only need to override a
// subset, and any key it doesn't define should keep falling back to
// whatever globals.css already sets.

import { THEME_VARIABLE_KEYS, type Theme } from "./types";

/**
 * Sets each variable a theme defines as an inline CSS custom property on
 * `document.documentElement`. Keys the theme doesn't define are left
 * untouched (they keep falling back to globals.css's `:root`/`.dark`
 * values) - callers that want a clean slate before applying a *different*
 * theme should call `clearThemeOverrides()` first.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    if (value === undefined) continue;
    root.style.setProperty(`--${key}`, value);
  }
}

/**
 * Removes every inline override this module could have set, restoring the
 * page to whatever globals.css's `:root`/`.dark` rules define. Iterates the
 * full known variable-key surface (not just whatever the last-applied theme
 * happened to define) so switching from a theme that overrides N variables
 * to one that overrides fewer doesn't leave stale inline properties behind.
 */
export function clearThemeOverrides(): void {
  const root = document.documentElement;
  for (const key of THEME_VARIABLE_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
}
