mod link_preview;

use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Sticky note windows are grouped separately from the main window on the
// Windows taskbar, under their own AppUserModelID and icon.
#[tauri::command]
fn setup_sticky_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    if !label.starts_with("sticky-") {
        return Err(format!("not a sticky note window: {label}"));
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no window labelled {label}"))?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/sticky.png"))
        .map_err(|e| e.to_string())?;
    window.set_icon(icon).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    set_sticky_app_user_model_id(&window)?;

    Ok(())
}

#[cfg(windows)]
fn set_sticky_app_user_model_id(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::mem::ManuallyDrop;
    use windows::core::PWSTR;
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::{
        PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut id: Vec<u16> = "SkyLines.StickyNotes"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // ManuallyDrop because PROPVARIANT's Drop would CoTaskMemFree the string,
    // which is owned by `id` here. SetValue copies it.
    let value = ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_LPWSTR,
                Anonymous: PROPVARIANT_0_0_0 {
                    pwszVal: PWSTR(id.as_mut_ptr()),
                },
                ..Default::default()
            }),
        },
    });

    unsafe {
        let store: IPropertyStore =
            SHGetPropertyStoreForWindow(hwnd).map_err(|e| e.to_string())?;
        store
            .SetValue(&PKEY_AppUserModel_ID, &*value)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Tray icon and native menu. Closing the main window hides it to the tray
// instead of exiting, so the tray's Quit and File > Quit are the only ways out.
#[cfg(desktop)]
fn setup_tray_and_menu(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{DragDropEvent, Manager, WindowEvent};

    // System tray
    let show_item = MenuItem::with_id(app, "show", "Show Skylines", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("app icon should be configured in tauri.conf.json's bundle.icon"),
        )
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click shows the main window; the OS opens the menu on
            // right-click.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Native menu. On Windows it attaches to each window; on macOS it's the
    // global menu bar.
    let file_menu = SubmenuBuilder::new(app, "File").item(&quit_item).build()?;

    // Predefined items keep the OS undo/redo and clipboard shortcuts working in
    // the editor and canvas (on macOS, Cmd+C/V do nothing without an Edit
    // menu).
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let menu = Menu::with_items(app, &[&file_menu, &edit_menu])?;
    app.set_menu(menu)?;

    // Hide instead of close: Tauri exits when the last window closes, which
    // would leave the tray nothing to show.
    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
                // Inert while `dragDropEnabled` is false in tauri.conf.json. On
                // Windows/WebView2, native window drag-drop disables the
                // webview's HTML5 drag events, which the sidebar relies on.
                // Kept as the hook for a future file-import feature. Uses
                // writeln! for the reason given at the global shortcut handler
                // below.
                WindowEvent::DragDrop(drag_drop_event) => {
                    use std::io::Write;
                    match drag_drop_event {
                        DragDropEvent::Enter { paths, position } => {
                            let _ = writeln!(
                                std::io::stderr(),
                                "drag-drop: enter {paths:?} at {position:?}"
                            );
                        }
                        DragDropEvent::Over { position } => {
                            let _ =
                                writeln!(std::io::stderr(), "drag-drop: over {position:?}");
                        }
                        DragDropEvent::Drop { paths, position } => {
                            let _ = writeln!(
                                std::io::stderr(),
                                "drag-drop: drop {paths:?} at {position:?}"
                            );
                        }
                        DragDropEvent::Leave => {
                            let _ = writeln!(std::io::stderr(), "drag-drop: leave");
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        });
    }

    Ok(())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Lets a pop-out window hand off to the main window, for example when a
// reference followed in a sticky note opens a note.
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    #[cfg(desktop)]
    show_main_window(&app);
    #[cfg(not(desktop))]
    let _ = app;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // tauri-plugin-sql checksums every migration. Never edit one that has
    // shipped, not even its whitespace or the comments inside its SQL: add a
    // new version.
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
        // Stores the losing side of a sync conflict.
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
        // Notebook > section (folder) > note hierarchy. Backfills a default "My
        // Notebook" for every user who already has folders.
        tauri_plugin_sql::Migration {
            version: 3,
            description: "create notebooks table, add folders.notebook_id, backfill existing folders",
            sql: "
                -- notebooks mirrors folders' shape (id, name, user_id,
                -- order_index, created_at, updated_at, deleted_at, dirty,
                -- synced_at) exactly, but has no parent_id - notebooks are
                -- top-level and don't nest.
                CREATE TABLE notebooks (
                  id          TEXT PRIMARY KEY,
                  name        TEXT NOT NULL,
                  user_id     TEXT NOT NULL,
                  order_index INTEGER NOT NULL DEFAULT 0,
                  created_at  INTEGER NOT NULL,
                  updated_at  INTEGER NOT NULL,
                  deleted_at  INTEGER,
                  dirty       INTEGER NOT NULL DEFAULT 1,
                  synced_at   INTEGER
                );

                -- `notebook_id` is deliberately added WITHOUT a `NOT NULL`
                -- constraint here. SQLite's `ALTER TABLE ... ADD COLUMN`
                -- flatly refuses to add a `NOT NULL` column to a table that
                -- already has rows unless a constant `DEFAULT` is supplied,
                -- and even a `DEFAULT` wouldn't help here (there is no
                -- single sensible default notebook id - it's per-user, and
                -- a literal constant can't express that). SQLite also has
                -- no `ALTER TABLE ... ALTER COLUMN`, so a `NOT NULL`
                -- constraint could never be retrofitted onto this column
                -- afterwards without the full create-new-table / copy-rows /
                -- drop-old / rename-new dance - not worth that added risk
                -- and complexity for a single-column constraint. Every
                -- existing folders row IS backfilled to a real notebook by
                -- the UPDATE below, so in practice no row is left with a
                -- NULL notebook_id once this migration finishes, and
                -- `createFolder` going forward is expected to always supply
                -- one - but the column stays nullable at the schema level,
                -- with `notebook_id IS NOT NULL` enforced at the
                -- application layer instead (lib/db/folders.ts, spec.md
                -- subtask 2), not by the database.
                ALTER TABLE folders ADD COLUMN notebook_id TEXT REFERENCES notebooks(id);

                -- Backfill: create one default \"My Notebook\" per distinct
                -- user_id already present in folders, so pre-existing local
                -- databases (which predate the notebooks feature) don't get
                -- silently orphaned data. Ids need to be UUID-shaped like
                -- the client-generated ones lib/db/folders.ts's
                -- createFolder makes via crypto.randomUUID() - but this
                -- runs as pure SQL inside a migration script with no JS
                -- runtime available, so SQLite's built-in
                -- randomblob()/hex() functions build an equivalent-looking
                -- (not RFC 4122 version/variant-bit-strict, but
                -- collision-safe in practice - randomblob() is backed by
                -- SQLite's own strong PRNG) 8-4-4-4-12 hex id instead, one
                -- freshly generated per output row since these are scalar
                -- functions evaluated per-row, not once for the whole
                -- statement. Timestamps use unixepoch() * 1000 to land in
                -- the same millisecond-Unix-timestamp units
                -- created_at/updated_at use everywhere else (Date.now() on
                -- the JS side) - unixepoch() alone returns whole seconds.
                INSERT INTO notebooks (id, name, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
                SELECT
                  lower(
                    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
                    hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
                    hex(randomblob(6))
                  ),
                  'My Notebook',
                  user_id,
                  0,
                  unixepoch() * 1000,
                  unixepoch() * 1000,
                  NULL,
                  1,
                  NULL
                FROM (SELECT DISTINCT user_id FROM folders);

                -- This backfill is a real content change (notebook_id) to
                -- rows that may already be synced (dirty = 0), so it must
                -- re-dirty the row the same way every other folder mutation
                -- in lib/db/folders.ts does (createFolder, updateFolder,
                -- deleteFolder, upsertFolderFromRemote), since
                -- getDirtyFolders() - the only thing lib/sync/push.ts
                -- consults - filters on dirty = 1. Without this, a folder
                -- row that was already synced before this migration ran
                -- would never have its new notebook_id pushed to Firestore
                -- once a later notebook-sync subtask starts sending it.
                UPDATE folders
                SET notebook_id = (
                  SELECT n.id FROM notebooks n
                  WHERE n.user_id = folders.user_id AND n.name = 'My Notebook'
                  LIMIT 1
                ),
                  dirty = 1,
                  updated_at = unixepoch() * 1000
                WHERE notebook_id IS NULL;

                CREATE INDEX idx_folders_notebook ON folders(notebook_id);
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Gives notes their own notebook_id so notes without a folder can be
        // scoped to a notebook.
        tauri_plugin_sql::Migration {
            version: 4,
            description: "add notes.notebook_id, backfill existing notes",
            sql: "
                -- Same reasoning as migration 3's `folders.notebook_id`
                -- column: no `NOT NULL` constraint here, since SQLite's
                -- `ALTER TABLE ... ADD COLUMN` can't add a `NOT NULL`
                -- column with no usable constant `DEFAULT` to a table that
                -- already has rows, and there is no single sensible default
                -- notebook id (it's per-user). Every existing notes row IS
                -- backfilled to a real notebook by the UPDATE below, and
                -- `createNote` going forward is expected to always supply
                -- one - but the column stays nullable at the schema level,
                -- with `notebook_id IS NOT NULL` enforced at the
                -- application layer instead (lib/db/notes.ts), not by the
                -- database.
                ALTER TABLE notes ADD COLUMN notebook_id TEXT REFERENCES notebooks(id);

                -- Migration 3's \"My Notebook\" backfill only ran `FROM
                -- (SELECT DISTINCT user_id FROM folders)`, so any user who
                -- has notes but zero folders (a normal case - notes.folder_id
                -- is nullable, root-level notes have always been allowed)
                -- never got a \"My Notebook\" row created for them. The
                -- COALESCE backfill below depends on that row existing as
                -- its fallback for folder-less notes, so without this,
                -- those notes' notebook_id would stay NULL forever
                -- (migrations run once, never re-applied) and the notes
                -- would become permanently invisible to the
                -- notebook-scoped FolderTree. Fixing this forward here
                -- (rather than editing migration 3's SQL in place) avoids
                -- any risk of changing an already-applied migration's
                -- checksum, which tauri-plugin-sql would reject on upgrade.
                INSERT INTO notebooks (id, name, user_id, order_index, created_at, updated_at, deleted_at, dirty, synced_at)
                SELECT
                  lower(
                    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
                    hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
                    hex(randomblob(6))
                  ),
                  'My Notebook',
                  missing.user_id,
                  0,
                  unixepoch() * 1000,
                  unixepoch() * 1000,
                  NULL,
                  1,
                  NULL
                FROM (
                  SELECT DISTINCT user_id FROM notes
                  WHERE user_id NOT IN (SELECT user_id FROM notebooks WHERE name = 'My Notebook')
                ) AS missing;

                -- Backfill: for every existing note, derive notebook_id from
                -- its folder's notebook_id when it has one (folder_id ->
                -- folders.notebook_id). Notes with no folder (folder_id IS
                -- NULL) fall back to that user's default \"My Notebook\",
                -- the exact same lookup migration 3 used for its own
                -- folder backfill - now guaranteed to exist for every
                -- note-owning user thanks to the INSERT above.
                UPDATE notes
                SET notebook_id = COALESCE(
                  (SELECT f.notebook_id FROM folders f WHERE f.id = notes.folder_id),
                  (SELECT n.id FROM notebooks n WHERE n.user_id = notes.user_id AND n.name = 'My Notebook' LIMIT 1)
                ),
                  dirty = 1,
                  updated_at = unixepoch() * 1000
                WHERE notebook_id IS NULL;

                -- This backfill is a real content change (notebook_id) to
                -- rows that may already be synced (dirty = 0), so it must
                -- re-dirty the row the same way migration 3's folder
                -- backfill did, since getDirtyNotes() - the only thing
                -- lib/sync/push.ts consults - filters on dirty = 1. Without
                -- this, a note row that was already synced before this
                -- migration ran would never have its new notebook_id pushed
                -- to Firestore once the notes push/pull code starts sending
                -- it (see the UPDATE above, which already sets dirty = 1 /
                -- updated_at alongside notebook_id in one statement).
                CREATE INDEX idx_notes_notebook ON notes(notebook_id);
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Persisted sibling order for notes in the sidebar.
        tauri_plugin_sql::Migration {
            version: 5,
            description: "add notes.order_index",
            sql: "
                ALTER TABLE notes ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Each note groups one or more pages, and each page is its own canvas.
        // Pages keep user_id because Firestore queries can't join through
        // notes.
        tauri_plugin_sql::Migration {
            version: 6,
            description: "create pages table",
            sql: "
                CREATE TABLE pages (
                  id          TEXT PRIMARY KEY,
                  note_id     TEXT NOT NULL REFERENCES notes(id),
                  title       TEXT NOT NULL DEFAULT 'Untitled',
                  user_id     TEXT NOT NULL,
                  order_index INTEGER NOT NULL DEFAULT 0,
                  content     TEXT,
                  canvas_data TEXT,
                  created_at  INTEGER NOT NULL,
                  updated_at  INTEGER NOT NULL,
                  deleted_at  INTEGER,
                  dirty       INTEGER NOT NULL DEFAULT 1,
                  synced_at   INTEGER
                );

                CREATE INDEX idx_pages_note       ON pages(note_id);
                CREATE INDEX idx_pages_user_dirty ON pages(user_id, dirty);
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Sticky notes live outside the folder tree. A NULL top_bar_color means
        // "use the theme's --primary".
        tauri_plugin_sql::Migration {
            version: 7,
            description: "create sticky_notes table",
            sql: "
                CREATE TABLE sticky_notes (
                  id             TEXT PRIMARY KEY,
                  user_id        TEXT NOT NULL,
                  title          TEXT NOT NULL DEFAULT 'Untitled',
                  content        TEXT,
                  top_bar_color  TEXT,
                  pinned         INTEGER NOT NULL DEFAULT 0,
                  created_at     INTEGER NOT NULL,
                  updated_at     INTEGER NOT NULL,
                  deleted_at     INTEGER,
                  dirty          INTEGER NOT NULL DEFAULT 1,
                  synced_at      INTEGER
                );

                CREATE INDEX idx_sticky_notes_user_dirty ON sticky_notes(user_id, dirty);
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // favorite is independent of pinned (pinned means always on top).
        tauri_plugin_sql::Migration {
            version: 8,
            description: "add sticky_notes.favorite",
            sql: "
                ALTER TABLE sticky_notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    // Google sign-in finishes in the system browser and returns through a
    // skylines:// deep link, because Google blocks OAuth inside embedded
    // webviews (see lib/auth/googleOAuth.ts).
    //
    // single-instance must be registered first: on Windows and Linux the OS
    // delivers a deep link by starting a second process, which this plugin
    // forwards to the running instance before exiting.
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // Empty on purpose: the plugin's deep-link feature already forwards
            // argv to the deep-link plugin.
        }));

        // Only the handler is set up here. The shortcut itself is registered in
        // setup(), so a collision with another app's shortcut can't fail
        // startup.
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        show_main_window(app);
                    }
                })
                .build(),
        );
    }

    // Lets the Tauri MCP server inspect and drive the app for automated testing.
    // Debug builds only, and bound to localhost: the plugin's default of 0.0.0.0
    // would let anything on the network run JavaScript in the app.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:skylines.db", migrations)
                .build(),
        )
        .setup(|app| {
            // Installers register skylines:// with the OS. Dev builds on
            // Windows, and all Linux builds, register it at runtime instead.
            // macOS only picks it up from an installed .app bundle.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            #[cfg(desktop)]
            setup_tray_and_menu(app)?;

            // Shortcut that brings the app forward: Ctrl+Alt+S, or Cmd+Option+S
            // on macOS.
            #[cfg(desktop)]
            {
                use std::io::Write;
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                const SHOW_WINDOW_SHORTCUT: &str = "CmdOrCtrl+Alt+S";
                if let Err(err) = app.global_shortcut().register(SHOW_WINDOW_SHORTCUT) {
                    // Non-fatal: another app may already own the shortcut.
                    // writeln! rather than eprintln!, because Windows release
                    // builds have no console and eprintln! panics when the
                    // write fails.
                    let _ = writeln!(
                        std::io::stderr(),
                        "failed to register global shortcut {SHOW_WINDOW_SHORTCUT}: {err}"
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, setup_sticky_window, focus_main_window, link_preview::fetch_page_head, link_preview::fetch_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
