// Built-in themes (spec.md subtask 18, "Built-in themes"). Ships three
// bundled `Theme` objects as first-class, selectable themes on top of the
// engine subtask 17 built - these are ordinary in-memory `Theme` values
// (not read from `<app-config-dir>/themes` via lib/themes/loader.ts, which
// is reserved for user-authored theme files), imported directly from app
// code, and each defines ALL 27 `ThemeVariableKey`s (a complete base theme,
// not a partial override set) so any one of them is enough on its own to
// fully paint the app.
//
// LIGHT_THEME and DARK_THEME are literal copies of app/globals.css's
// `:root` and `.dark` blocks respectively - see that file for the source of
// truth. This file must never invent different values for those two; only
// GRUVBOX_DARK_THEME is a genuinely new palette.

import type { Theme } from "./types";

// Copied 1:1 from app/globals.css's `:root` block.
export const LIGHT_THEME: Theme = {
  id: "light",
  name: "Light",
  variables: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.145 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.145 0 0)",
    primary: "oklch(0.205 0 0)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.97 0 0)",
    "secondary-foreground": "oklch(0.205 0 0)",
    muted: "oklch(0.97 0 0)",
    "muted-foreground": "oklch(0.556 0 0)",
    accent: "oklch(0.97 0 0)",
    "accent-foreground": "oklch(0.205 0 0)",
    destructive: "oklch(0.577 0.245 27.325)",
    border: "oklch(0.922 0 0)",
    input: "oklch(0.922 0 0)",
    ring: "oklch(0.708 0 0)",
    radius: "0.625rem",
    sidebar: "oklch(0.985 0 0)",
    "sidebar-foreground": "oklch(0.145 0 0)",
    "sidebar-primary": "oklch(0.205 0 0)",
    "sidebar-primary-foreground": "oklch(0.985 0 0)",
    "sidebar-accent": "oklch(0.97 0 0)",
    "sidebar-accent-foreground": "oklch(0.205 0 0)",
    "sidebar-border": "oklch(0.922 0 0)",
    "sidebar-ring": "oklch(0.708 0 0)",
  },
};

// Copied 1:1 from app/globals.css's `.dark` block.
export const DARK_THEME: Theme = {
  id: "dark",
  name: "Dark",
  variables: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.205 0 0)",
    "card-foreground": "oklch(0.985 0 0)",
    popover: "oklch(0.205 0 0)",
    "popover-foreground": "oklch(0.985 0 0)",
    primary: "oklch(0.922 0 0)",
    "primary-foreground": "oklch(0.205 0 0)",
    secondary: "oklch(0.269 0 0)",
    "secondary-foreground": "oklch(0.985 0 0)",
    muted: "oklch(0.269 0 0)",
    "muted-foreground": "oklch(0.708 0 0)",
    accent: "oklch(0.269 0 0)",
    "accent-foreground": "oklch(0.985 0 0)",
    destructive: "oklch(0.704 0.191 22.216)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 15%)",
    ring: "oklch(0.556 0 0)",
    radius: "0.625rem",
    sidebar: "oklch(0.205 0 0)",
    "sidebar-foreground": "oklch(0.985 0 0)",
    "sidebar-primary": "oklch(0.488 0.243 264.376)",
    "sidebar-primary-foreground": "oklch(0.985 0 0)",
    "sidebar-accent": "oklch(0.269 0 0)",
    "sidebar-accent-foreground": "oklch(0.985 0 0)",
    "sidebar-border": "oklch(1 0 0 / 10%)",
    "sidebar-ring": "oklch(0.556 0 0)",
  },
};

// A new palette using the canonical Gruvbox Dark colors
// (https://github.com/morhetz/gruvbox), mapped onto this app's 31 semantic
// tokens:
//   bg0/bg0_h  #282828 / #1d2021   fg1/fg4    #ebdbb2 / #a89984
//   bg1/bg2    #3c3836 / #504945   bg3/bg4    #665c54 / #7c6f64
//   bright red    #fb4934          bright yellow #fabd2f
//   bright green  #b8bb26          bright blue   #83a598
//   bright purple #d3869b          bright aqua   #8ec07c
//   bright orange #fe8019
// `radius` is kept identical to LIGHT_THEME/DARK_THEME's `0.625rem` -
// this subtask is about color palettes, not layout geometry, and there's no
// reason for a color scheme swap to also reflow corner rounding.
export const GRUVBOX_DARK_THEME: Theme = {
  id: "gruvbox-dark",
  name: "Gruvbox Dark",
  variables: {
    background: "#282828",
    foreground: "#ebdbb2",
    card: "#3c3836",
    "card-foreground": "#ebdbb2",
    popover: "#3c3836",
    "popover-foreground": "#ebdbb2",
    primary: "#fabd2f",
    "primary-foreground": "#282828",
    secondary: "#504945",
    "secondary-foreground": "#ebdbb2",
    muted: "#3c3836",
    "muted-foreground": "#a89984",
    accent: "#665c54",
    "accent-foreground": "#ebdbb2",
    destructive: "#fb4934",
    border: "#504945",
    input: "#3c3836",
    ring: "#7c6f64",
    radius: "0.625rem",
    sidebar: "#1d2021",
    "sidebar-foreground": "#ebdbb2",
    "sidebar-primary": "#fabd2f",
    "sidebar-primary-foreground": "#282828",
    "sidebar-accent": "#3c3836",
    "sidebar-accent-foreground": "#ebdbb2",
    "sidebar-border": "#3c3836",
    "sidebar-ring": "#7c6f64",
  },
};

// A soft, warm light palette - gray/cream/beige tones with real tonal
// variation across slots (not a single flat off-white reused everywhere),
// mirroring how GRUVBOX_DARK_THEME varies its own bg0/bg1/bg2 tones. Text
// stays dark (this is a light theme), and `radius` matches LIGHT_THEME /
// DARK_THEME / GRUVBOX_DARK_THEME's `0.625rem` for the same reason noted
// above - this is a color palette swap, not a layout change.
export const OFF_WHITE_THEME: Theme = {
  id: "off-white",
  name: "Off-white",
  variables: {
    background: "oklch(0.965 0.005 85)",
    foreground: "oklch(0.32 0.015 60)",
    card: "oklch(0.98 0.006 90)",
    "card-foreground": "oklch(0.32 0.015 60)",
    popover: "oklch(0.99 0.004 90)",
    "popover-foreground": "oklch(0.32 0.015 60)",
    primary: "oklch(0.5 0.03 55)",
    "primary-foreground": "oklch(0.98 0.005 90)",
    secondary: "oklch(0.92 0.012 75)",
    "secondary-foreground": "oklch(0.35 0.02 60)",
    muted: "oklch(0.91 0.014 80)",
    "muted-foreground": "oklch(0.5 0.015 65)",
    accent: "oklch(0.88 0.02 70)",
    "accent-foreground": "oklch(0.32 0.02 60)",
    destructive: "oklch(0.56 0.19 27)",
    border: "oklch(0.87 0.014 75)",
    input: "oklch(0.9 0.012 78)",
    ring: "oklch(0.7 0.02 65)",
    radius: "0.625rem",
    sidebar: "oklch(0.94 0.01 80)",
    "sidebar-foreground": "oklch(0.32 0.015 60)",
    "sidebar-primary": "oklch(0.5 0.03 55)",
    "sidebar-primary-foreground": "oklch(0.98 0.005 90)",
    "sidebar-accent": "oklch(0.89 0.016 75)",
    "sidebar-accent-foreground": "oklch(0.32 0.02 60)",
    "sidebar-border": "oklch(0.86 0.014 75)",
    "sidebar-ring": "oklch(0.7 0.02 65)",
  },
};

// Collected list - the natural hand-off point for subtask 19's theme picker.
export const BUILTIN_THEMES: Theme[] = [
  LIGHT_THEME,
  DARK_THEME,
  GRUVBOX_DARK_THEME,
  OFF_WHITE_THEME,
];
