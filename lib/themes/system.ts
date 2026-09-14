// System theme resolution (spec.md subtask 11, "Rename 'Default' theme to
// 'System'"). Single source of truth for reading the OS's current light/dark
// preference and mapping it onto the app's own LIGHT_THEME/DARK_THEME - used
// both by AccountMenu.tsx (live matchMedia listener while "System" is the
// active selection) and AppShell.tsx (resolving the correct theme once on
// restore/reload).

import { DARK_THEME, LIGHT_THEME } from "./builtin";
import type { Theme } from "./types";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/**
 * Returns `true` if the OS currently prefers dark mode. Returns `false`
 * (rather than throwing) in any environment where `matchMedia` isn't
 * available (SSR/static export build-time rendering) - matches this
 * codebase's existing SSR-guard convention (see lib/lastOpen.ts,
 * lib/themes/selection.ts).
 */
export function prefersDarkOS(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/**
 * Resolves the `Theme` that "System" should currently apply: `DARK_THEME` or
 * `LIGHT_THEME` based on the OS's live preference at call time (never a
 * cached/stale snapshot).
 */
export function getSystemTheme(): Theme {
  return prefersDarkOS() ? DARK_THEME : LIGHT_THEME;
}

/**
 * Creates the `matchMedia` list for the OS dark-mode preference, for callers
 * that need to attach/detach a live "change" listener themselves (see
 * AccountMenu.tsx). Returns `null` in environments without `matchMedia`
 * (SSR/static export build-time rendering).
 */
export function watchSystemThemeChanges(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(DARK_MEDIA_QUERY);
}
