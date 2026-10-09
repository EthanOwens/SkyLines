// Built-in themes. Each defines every variable, so it can paint the app on its
// own.
//
// LIGHT_THEME and DARK_THEME are exact copies of globals.css's :root and .dark
// blocks; keep them identical.

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

// Canonical Gruvbox Dark colors (https://github.com/morhetz/gruvbox):
//
// bg0/bg0_h #282828/#1d2021, fg1/fg4 #ebdbb2/#a89984, bg1/bg2 #3c3836/#504945,
// bg3/bg4 #665c54/#7c6f64, red #fb4934, yellow #fabd2f, green #b8bb26, blue
// #83a598, purple #d3869b, aqua #8ec07c, orange #fe8019.
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

// Warm light palette with real tonal variation between slots.
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

export const BUILTIN_THEMES: Theme[] = [
  LIGHT_THEME,
  DARK_THEME,
  GRUVBOX_DARK_THEME,
  OFF_WHITE_THEME,
];
