// Theme engine foundation (spec.md subtask 17, "Theme engine foundation").
// This is the exact variable surface defined in app/globals.css's `:root`/
// `.dark` blocks (minus the leading `--`) - a theme JSON file can override
// any subset of these via `variables`, and undefined keys simply aren't
// touched, falling through to whatever globals.css already defines for them.

export type ThemeVariableKey =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "radius"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring";

// Kept in sync with the union above - used at runtime to validate a
// hand-authored theme file's `variables` keys without trusting `as` casts on
// arbitrary user JSON.
export const THEME_VARIABLE_KEYS: readonly ThemeVariableKey[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "radius",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
];

const THEME_VARIABLE_KEY_SET: ReadonlySet<string> = new Set(THEME_VARIABLE_KEYS);

export interface Theme {
  id: string;
  name: string;
  variables: Partial<Record<ThemeVariableKey, string>>;
}

/**
 * Validates that `value` is a well-formed `Theme` - a hand-edited JSON file
 * can contain anything, so this is a real runtime check, not just a type
 * assertion. Unknown keys inside `variables` are rejected (rather than
 * silently ignored) so a typo'd variable name fails loudly enough to be
 * caught during loader validation, instead of being silently no-op forever.
 */
export function isTheme(value: unknown): value is Theme {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.name !== "string" || v.name.length === 0) return false;
  if (!v.variables || typeof v.variables !== "object" || Array.isArray(v.variables)) {
    return false;
  }

  const variables = v.variables as Record<string, unknown>;
  for (const [key, val] of Object.entries(variables)) {
    if (!THEME_VARIABLE_KEY_SET.has(key)) return false;
    if (typeof val !== "string") return false;
  }

  return true;
}
