import Database from "@tauri-apps/plugin-sql";

// Must match the URL the Rust side registers migrations for. One shared
// promise, so concurrent callers don't each invoke a load.
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
