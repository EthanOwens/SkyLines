// Built-in themes (spec.md subtask 18, "Built-in themes"). Ships three
// bundled `Theme` objects as first-class, selectable themes on top of the
// engine subtask 17 built - these are ordinary in-memory `Theme` values
// (not read from `<app-config-dir>/themes` via lib/themes/loader.ts, which
// is reserved for user-authored theme files), imported directly from app
// code, and each defines ALL 31 `ThemeVariableKey`s (a complete base theme,
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
    "chart-1": "oklch(0.809 0.105 251.813)",
    "chart-2": "oklch(0.623 0.214 259.815)",
    "chart-3": "oklch(0.546 0.245 262.881)",
    "chart-4": "oklch(0.488 0.243 264.376)",
    "chart-5": "oklch(0.424 0.199 265.638)",
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
    "chart-1": "oklch(0.809 0.105 251.813)",
    "chart-2": "oklch(0.623 0.214 259.815)",
    "chart-3": "oklch(0.546 0.245 262.881)",
    "chart-4": "oklch(0.488 0.243 264.376)",
    "chart-5": "oklch(0.424 0.199 265.638)",
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
    "chart-1": "#83a598",
    "chart-2": "#8ec07c",
    "chart-3": "#fabd2f",
    "chart-4": "#fe8019",
    "chart-5": "#d3869b",
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

// Collected list - the natural hand-off point for subtask 19's theme picker.
export const BUILTIN_THEMES: Theme[] = [LIGHT_THEME, DARK_THEME, GRUVBOX_DARK_THEME];
