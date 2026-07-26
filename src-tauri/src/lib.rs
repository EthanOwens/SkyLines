// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // M0 spike (spec.md subtask 4): trivial migration creating a throwaway
    // table to prove tauri-plugin-sql round-trips frontend TS <-> SQLite
    // file on disk. Not the real schema (that's subtask 7).
    let spike_migrations = vec![tauri_plugin_sql::Migration {
        version: 1,
        description: "create spike_test table",
        sql: "CREATE TABLE spike_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
        kind: tauri_plugin_sql::MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:skylines-spike.db", spike_migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
