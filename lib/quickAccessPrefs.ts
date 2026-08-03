// Quick access toolbar visibility persistence (spec.md subtask 13, "Quick
// access toolbar"). Mirrors lib/lastOpen.ts's exact defensive pattern (SSR
// guard, try/catch around localStorage/JSON.parse, never throws) - this is
// per-device UI convenience state, not user data, so it stays out of the
// Firestore sync engine just like lastOpen.ts.

const STORAGE_KEY = "skylines:quickAccessVisibility";

export interface QuickAccessVisibility {
  back: boolean;
  forward: boolean;
  undo: boolean;
  redo: boolean;
}

export const DEFAULT_VISIBILITY: QuickAccessVisibility = {
  back: true,
  forward: true,
  undo: true,
  redo: true,
};

function isQuickAccessVisibility(value: unknown): value is QuickAccessVisibility {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.back === "boolean" &&
    typeof v.forward === "boolean" &&
    typeof v.undo === "boolean" &&
    typeof v.redo === "boolean"
  );
}

/**
 * Reads the quick-access visibility prefs from `localStorage`. Returns the
 * "all visible" default if `localStorage` is unavailable (SSR/static export
 * build-time rendering), nothing has been stored yet, or the stored value is
 * corrupt/malformed - never throws.
 */
export function getQuickAccessVisibility(): QuickAccessVisibility {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_VISIBILITY;
  }
  if (!raw) return DEFAULT_VISIBILITY;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isQuickAccessVisibility(parsed) ? parsed : DEFAULT_VISIBILITY;
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

/**
 * Persists the quick-access visibility prefs. Silently no-ops if
 * `localStorage` is unavailable - this is best-effort convenience state, not
 * something worth surfacing an error for.
 */
export function setQuickAccessVisibility(state: QuickAccessVisibility): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable/full/disabled - nothing meaningful to do.
  }
}
