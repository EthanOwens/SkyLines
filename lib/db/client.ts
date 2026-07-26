import Database from "@tauri-apps/plugin-sql";

// Shared local SQLite connection (spec.md subtask 9). The Rust side
// registers migrations against "sqlite:skylines.db" (see
// src-tauri/src/lib.rs) - this must load the same URL so we get the
// `folders`/`notes`/`sync_meta` schema from that migration.
//
// Database.load() is memoized per-URL by the plugin itself, but we still
// keep a module-level singleton promise here so every caller in lib/db/*
// awaits the *same* in-flight load rather than re-invoking the Tauri IPC
// command on every single query.
const DB_URL = "sqlite:skylines.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
