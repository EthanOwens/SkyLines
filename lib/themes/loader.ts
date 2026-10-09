// User themes are JSON files in <app-config-dir>/themes.

import { appConfigDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
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
  // Reported for the spike page; not needed by the loader itself.
  skipped: string[];
}

/**
 * Bad files are skipped and logged, never fatal: they're hand-edited, so typos
 * are expected.
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
      // Bad JSON, or a file that vanished between listing and reading: skip it.
      skipped.push(entry.name);
    }
  }

  return { dir, themes, skipped };
}

/** Files are named by id, not by the editable, non-unique name. */
function themeFileName(themeId: string): string {
  return `${themeId}.json`;
}

/** Overwrites the existing file for the same id. */
export async function saveTheme(theme: Theme): Promise<void> {
  const dir = await ensureThemesDir();
  const filePath = await join(dir, themeFileName(theme.id));
  await writeTextFile(filePath, JSON.stringify(theme, null, 2));
}

/** A missing file is fine. */
export async function deleteThemeFile(themeId: string): Promise<void> {
  const dir = await getThemesDir();
  const filePath = await join(dir, themeFileName(themeId));
  const fileExists = await exists(filePath);
  if (!fileExists) return;
  await remove(filePath);
}
