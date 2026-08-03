// Theme engine foundation (spec.md subtask 17, "Theme engine foundation").
// Resolves and reads the on-disk themes directory - the "like PowerShell
// themes" request taken literally: users add a theme by hand-editing/
// dropping a JSON file into this directory, no in-app editor.
//
// Uses Tauri v2's current `@tauri-apps/api/path` naming (`appConfigDir`,
// `join`) - verified against the actually-installed `@tauri-apps/api`
// version's `path.d.ts` rather than assumed, per spec.md's Open Questions
// note that this has changed across Tauri versions.

import { appConfigDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { isTheme, type Theme } from "./types";

const THEMES_SUBDIR = "themes";

/**
 * Resolves the absolute path to the themes directory
 * (`<app-config-dir>/themes`). Does not create it - see `ensureThemesDir`.
 */
export async function getThemesDir(): Promise<string> {
  const configDir = await appConfigDir();
  return join(configDir, THEMES_SUBDIR);
}

/**
 * Ensures the themes directory exists on disk, creating it (recursively)
 * if this is the first run. Safe to call repeatedly.
 */
export async function ensureThemesDir(): Promise<string> {
  const dir = await getThemesDir();
  const dirExists = await exists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export interface LoadedThemesResult {
  dir: string;
  themes: Theme[];
  // Filenames that were found but skipped (non-JSON, malformed JSON, or
  // JSON that doesn't match the Theme schema) - surfaced for the spike
  // page's malformed-file-resilience verification, not required for the
  // loader's own correctness.
  skipped: string[];
}

/**
 * Reads and validates every `.json` file in the themes directory. Never
 * throws on a per-file basis: a malformed/invalid file (bad JSON syntax,
 * wrong shape, unknown variable keys) is skipped and logged, not fatal -
 * these are hand-edited files, so typos are expected. Non-JSON files are
 * skipped silently.
 */
export async function loadThemes(): Promise<LoadedThemesResult> {
  const dir = await ensureThemesDir();

  const entries = await readDir(dir);
  const themes: Theme[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.name.toLowerCase().endsWith(".json")) continue;

    const filePath = await join(dir, entry.name);
    try {
      const raw = await readTextFile(filePath);
      const parsed: unknown = JSON.parse(raw);
      if (isTheme(parsed)) {
        themes.push(parsed);
      } else {
        skipped.push(entry.name);
      }
    } catch {
      // Invalid JSON syntax, or a read failure on a file that vanished
      // between readDir and readTextFile - either way, skip and continue
      // with the rest rather than letting one bad file take down the
      // whole loader.
      skipped.push(entry.name);
    }
  }

  return { dir, themes, skipped };
}
