"use client";

import { useState } from "react";
import { loadThemes, getThemesDir, type LoadedThemesResult } from "@/lib/themes/loader";
import { applyTheme, clearThemeOverrides } from "@/lib/themes/apply";
import type { Theme } from "@/lib/themes/types";

// M6 spike route (spec.md subtask 17, "Theme engine foundation"). Exercises
// lib/themes/{types,loader,apply}.ts end-to-end against the real on-disk
// themes directory - same pattern as app/spike-notebooks/page.tsx. Not
// production UI - a throwaway verification harness. There is no real
// theme-picker UI surface until spec.md subtask 19, so this is the only way
// to prove the loader/apply mechanism genuinely works end-to-end for now.
export default function SpikeThemes() {
  const [dir, setDir] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function reload() {
    try {
      const result: LoadedThemesResult = await loadThemes();
      setDir(result.dir);
      setThemes(result.themes);
      setSkipped(result.skipped);
      append(
        `loadThemes() -> dir=${result.dir} themes=${result.themes.length} skipped=${result.skipped.length} (${result.skipped.join(", ")})`,
      );
    } catch (err) {
      append(`loadThemes() FAILED: ${String(err)}`);
    }
  }

  async function resolveDirOnly() {
    try {
      const d = await getThemesDir();
      setDir(d);
      append(`getThemesDir() -> ${d}`);
    } catch (err) {
      append(`getThemesDir() FAILED: ${String(err)}`);
    }
  }

  function handleApply(theme: Theme) {
    clearThemeOverrides();
    applyTheme(theme);
    setAppliedId(theme.id);
    const computed = getComputedStyle(document.documentElement);
    append(
      `applyTheme(${theme.id}) -> computed --primary=${computed.getPropertyValue("--primary").trim()}`,
    );
  }

  function handleClear() {
    clearThemeOverrides();
    setAppliedId(null);
    append("clearThemeOverrides() called");
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike Themes (lib/themes)</h1>

      <div className="flex gap-4">
        <button
          onClick={() => void resolveDirOnly()}
          className="rounded bg-gray-600 px-4 py-2 text-white"
        >
          Resolve themes dir
        </button>
        <button
          onClick={() => void reload()}
          className="rounded bg-blue-500 px-4 py-2 text-white"
        >
          Load themes
        </button>
        <button
          onClick={handleClear}
          className="rounded bg-gray-400 px-4 py-2 text-white"
        >
          Clear overrides
        </button>
      </div>

      {dir && (
        <p className="text-sm" data-testid="spike-themes-dir">
          Themes dir: <code>{dir}</code>
        </p>
      )}

      <div className="w-full max-w-2xl">
        <h2 className="font-medium">Loaded themes ({themes.length})</h2>
        <ul data-testid="spike-themes-list" className="flex flex-col gap-2">
          {themes.map((theme) => (
            <li key={theme.id} className="flex items-center gap-3">
              <span>
                {theme.name} (id={theme.id}, {Object.keys(theme.variables).length} vars)
              </span>
              <button
                onClick={() => handleApply(theme)}
                className="rounded bg-emerald-600 px-3 py-1 text-sm text-white"
              >
                Apply
              </button>
              {appliedId === theme.id && <span className="text-xs text-emerald-700">applied</span>}
            </li>
          ))}
        </ul>

        {skipped.length > 0 && (
          <p className="mt-2 text-sm text-red-600" data-testid="spike-themes-skipped">
            Skipped (malformed/invalid): {skipped.join(", ")}
          </p>
        )}
      </div>

      <div className="flex gap-4 rounded border p-4">
        <div className="rounded bg-primary p-6 text-primary-foreground">bg-primary / text-primary-foreground</div>
        <div className="rounded bg-secondary p-6 text-secondary-foreground">bg-secondary / text-secondary-foreground</div>
        <div className="rounded border bg-background p-6 text-foreground">bg-background / text-foreground</div>
      </div>

      <ul data-testid="spike-themes-log" className="w-full max-w-2xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
