// Per-device UI state in localStorage, deliberately not synced.

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
 * Returns the "all visible" default when localStorage is unavailable, empty or
 * corrupt. Never throws.
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

/** Best-effort; does nothing when localStorage is unavailable. */
export function setQuickAccessVisibility(state: QuickAccessVisibility): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable/full/disabled - nothing meaningful to do.
  }
}
