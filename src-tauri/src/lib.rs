// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // M2 (spec.md subtask 7): real local storage schema, mirroring
    // SPEC_iter1.md Part 2 "Local storage layer" exactly. This is
    // migration version 1 of the real app; the M0 spike migration/db
    // (spec.md subtask 4, `skylines-spike.db` / `spike_test`) was a
    // throwaway artifact and has been replaced, not carried forward.
    let migrations = vec![
        tauri_plugin_sql::Migration {
        version: 1,
        description: "create folders, notes, sync_meta tables and indexes",
        sql: "
            CREATE TABLE folders (
              id          TEXT PRIMARY KEY,
              name        TEXT NOT NULL,
              parent_id   TEXT REFERENCES folders(id),
              user_id     TEXT NOT NULL,
              order_index INTEGER NOT NULL DEFAULT 0,
              created_at  INTEGER NOT NULL,
              updated_at  INTEGER NOT NULL,
              deleted_at  INTEGER,
              dirty       INTEGER NOT NULL DEFAULT 1,
              synced_at   INTEGER
            );

            CREATE TABLE notes (
              id          TEXT PRIMARY KEY,
              title       TEXT NOT NULL DEFAULT 'Untitled',
              type        TEXT NOT NULL CHECK (type IN ('note','canvas')),
              folder_id   TEXT REFERENCES folders(id),
              user_id     TEXT NOT NULL,
              content     TEXT,
              canvas_data TEXT,
              created_at  INTEGER NOT NULL,
              updated_at  INTEGER NOT NULL,
              deleted_at  INTEGER,
              dirty       INTEGER NOT NULL DEFAULT 1,
              synced_at   INTEGER
            );

            CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);

            CREATE INDEX idx_notes_folder     ON notes(folder_id);
            CREATE INDEX idx_notes_user_dirty ON notes(user_id, dirty);
            CREATE INDEX idx_folders_parent   ON folders(parent_id);
        ",
        kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // M3 (spec.md subtask 12): pull-side sync needs somewhere to snapshot
        // the "losing" version of a row when a pull discovers both the local
        // row (dirty) and the remote Firestore doc were touched since the
        // last sync (see SPEC_iter1.md Part 2 "Sync engine"). Additive-only -
        // migration 1 above is left byte-for-byte untouched (tauri-plugin-sql
        // checksums each migration's SQL string and refuses to run ANY
        // migration if an earlier one's checksum no longer matches what's
        // recorded in `_sqlx_migrations` - even a pure reindent of migration
        // 1 breaks every existing v1 database) so it upgrades cleanly by
        // applying this as a second step.
        tauri_plugin_sql::Migration {
            version: 2,
            description: "create sync_conflicts table",
            sql: "
                CREATE TABLE sync_conflicts (
                  id          TEXT PRIMARY KEY,
                  table_name  TEXT NOT NULL,
                  row_id      TEXT NOT NULL,
                  losing_data TEXT NOT NULL,
                  created_at  INTEGER NOT NULL
                );

                CREATE INDEX idx_sync_conflicts_row ON sync_conflicts(table_name, row_id);
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:skylines.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
