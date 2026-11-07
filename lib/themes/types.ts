// The variables from globals.css's :root/.dark blocks (without the leading --).
// A theme may override any subset.

export const MAX_NOTE_PALETTE_SIZE = 24;

type NoteIndex =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24;

export type NoteVariableKey = `note-${NoteIndex}`;

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
  | "radius"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring"
  | NoteVariableKey;

// Keep in sync with the union above; used to validate user theme files at
// runtime.
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
  "radius",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  ...(Array.from(
    { length: MAX_NOTE_PALETTE_SIZE },
    (_, i) => `note-${i + 1}`,
  ) as NoteVariableKey[]),
];

const THEME_VARIABLE_KEY_SET: ReadonlySet<string> = new Set(THEME_VARIABLE_KEYS);

/** Note palette generator state, stored with the theme so the editor can restore it. */
export interface NotePaletteSettings {
  count: number;
  /** One hue (0 to 360) per color. */
  hues: number[];
  lightness: number;
  chroma: number;
  /** Fixed hex per color, or null to use the generated color. */
  overrides: (string | null)[];
}

export interface Theme {
  id: string;
  name: string;
  variables: Partial<Record<ThemeVariableKey, string>>;
  notePalette?: NotePaletteSettings;
}

/**
 * Unknown variable keys are rejected so a typo fails loudly instead of doing
 * nothing.
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

  // Contents are sanitized when read, so a bad palette can't reject the theme.
  if (
    v.notePalette !== undefined &&
    (!v.notePalette || typeof v.notePalette !== "object" || Array.isArray(v.notePalette))
  ) {
    return false;
  }

  return true;
}
