// Theme picker persistence (spec.md subtask 19, "Theme picker"). Mirrors
// lib/lastOpen.ts's exact defensive pattern (SSR guard, try/catch around
// localStorage, never throws) - this is per-device UI convenience state, not
// user data, so it stays out of the Firestore sync engine just like
// lastOpen.ts/quickAccessPrefs.ts.

const STORAGE_KEY = "skylines:selectedThemeId";

/**
 * Reads the persisted selected-theme id from `localStorage`. Returns `null`
 * if `localStorage` is unavailable (SSR/static export build-time
 * rendering), nothing has been stored yet, or the stored value isn't a
 * non-empty string - never throws. `null` itself is a meaningful value here
 * (see `setSelectedThemeId`): it means "Default, no theme applied".
 */
export function getSelectedThemeId(): string | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persists the selected theme id. Pass `null` to record "Default" (no theme
 * applied, i.e. whatever globals.css renders by default). Silently no-ops if
 * `localStorage` is unavailable - this is best-effort convenience state, not
 * something worth surfacing an error for.
 */
export function setSelectedThemeId(id: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (id === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    }
  } catch {
    // localStorage unavailable/full/disabled - nothing meaningful to do.
  }
}
