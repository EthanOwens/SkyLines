"use client";

import { useState } from "react";
import Database from "@tauri-apps/plugin-sql";

// M0 spike route (spec.md subtask 4). Trivial round-trip test proving
// tauri-plugin-sql wires up correctly: insert a row into the throwaway
// `spike_test` table (created by the Rust-side migration in src-tauri/src/
// lib.rs), read it back, and surface the result here. Not the real schema
// (that's subtask 7) — this table only exists to validate the plugin.
type SpikeRow = {
  id: number;
  value: string;
};

export default function SpikeSql() {
  const [result, setResult] = useState<string>("Not run yet.");
  const [rows, setRows] = useState<SpikeRow[]>([]);

  async function runRoundTrip() {
    try {
      const db = await Database.load("sqlite:skylines-spike.db");
      const value = `hello from frontend @ ${new Date().toISOString()}`;

      await db.execute("INSERT INTO spike_test (value) VALUES ($1)", [value]);

      const selected = await db.select<SpikeRow[]>(
        "SELECT id, value FROM spike_test ORDER BY id",
      );

      setRows(selected);
      setResult(`Round-trip OK. ${selected.length} row(s) in spike_test.`);
    } catch (err) {
      setResult(`Round-trip FAILED: ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike SQL</h1>
      <button
        onClick={() => void runRoundTrip()}
        className="rounded bg-blue-500 px-4 py-2 text-white"
      >
        Insert + read row
      </button>
      <p data-testid="spike-sql-result">{result}</p>
      <ul className="text-sm">
        {rows.map((row) => (
          <li key={row.id}>
            id={row.id} value={row.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
