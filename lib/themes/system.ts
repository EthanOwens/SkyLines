// Maps the OS light/dark preference to LIGHT_THEME or DARK_THEME.

import { DARK_THEME, LIGHT_THEME } from "./builtin";
import type { Theme } from "./types";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** false where matchMedia doesn't exist (static export build). */
export function prefersDarkOS(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/** Reads the live preference on every call. */
export function getSystemTheme(): Theme {
  return prefersDarkOS() ? DARK_THEME : LIGHT_THEME;
}

/** null where matchMedia doesn't exist. */
export function watchSystemThemeChanges(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(DARK_MEDIA_QUERY);
}
