// Per-device UI state in localStorage, deliberately not synced.

const STORAGE_KEY = "skylines:selectedThemeId";

/**
 * null when nothing valid is stored or localStorage is unavailable. Never
 * throws.
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

/** Best-effort; does nothing when localStorage is unavailable. */
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
