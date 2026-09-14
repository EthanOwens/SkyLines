use tauri_plugin_deep_link::DeepLinkExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// M6 (spec.md subtask 23): tray icon + native application menu. Desktop-only
// (see the `#[cfg(desktop)]` call site in `run()` below) since there is no
// system tray or native menu bar concept on mobile.
//
// There is no reference implementation to port here - `../note_taking_app`
// is a pure Next.js web app with no Tauri/native code at all - so this is
// deliberately minimal: a "Show Skylines" / "Quit" tray menu, and a File /
// Edit native menu. No app-specific actions (e.g. "New Note") are wired up,
// since there's no real authenticated app shell yet for them to hook into
// (see spec.md's note on this subtask's scope).
//
// Close-to-tray: the native close button (X) on the main window is
// intercepted so it hides the window instead of destroying it (Tauri's
// default behavior when the last window closes is to exit the whole app).
// Without that, the tray's "Show Skylines" item would have nothing left to
// show once the window was closed. The tray's "Quit" item (and File > Quit,
// same handler) is the actual way to terminate the app now.
#[cfg(desktop)]
fn setup_tray_and_menu(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{DragDropEvent, Manager, WindowEvent};

    // --- System tray ---------------------------------------------------
    let show_item = MenuItem::with_id(app, "show", "Show Skylines", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::new()
        // Reuse the app's own icon (from src-tauri/icons/, wired up via
        // tauri.conf.json's `bundle.icon`) rather than shipping a second
        // tray-specific asset.
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
            // Standard tray behavior: left-click shows/focuses the main
            // window. Right-click opens the context menu built above
            // (that's handled natively by the OS/tray-icon crate and
            // doesn't need to be wired up here).
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

    // --- Native application menu ---------------------------------------
    // On Windows (unlike macOS) this attaches as the traditional top-of-
    // window menu bar via the native SetMenu API, applied per-window
    // rather than as a single global menu bar.
    let file_menu = SubmenuBuilder::new(app, "File").item(&quit_item).build()?;

    // Predefined items so OS-level Undo/Redo/Cut/Copy/Paste/Select All
    // keep working for the rich text editor and canvas.
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

    // Close-to-tray: intercept the native close button so it hides the
    // window instead of destroying it (Tauri's default behavior when the
    // last window closes is to exit the whole app). Without this, the
    // tray's "Show Skylines" item can never be clicked to bring anything
    // back once the window is closed - the process would already be gone.
    // The tray's "Quit" item (and the File > Quit menu item, same handler)
    // is now the actual way to terminate the app.
    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
                // M6 (spec.md subtask 25): drag-and-drop plumbing only - no
                // attachment/file-import feature exists yet for a dropped
                // file to feed into (see spec.md's note on this subtask's
                // scope), so this just logs what the OS handed the window
                // (`tauri://drag-enter` / `-over` / `-drop` / `-leave` on
                // the JS side, all funneled into this single
                // `WindowEvent::DragDrop` variant on the Rust side) and
                // does nothing further.
                //
                // Currently INERT (M1, spec.md subtask 3): `dragDropEnabled`
                // is now `false` in tauri.conf.json, so this handler never
                // fires - no OS-level `WindowEvent::DragDrop` events are
                // delivered at all. This was flipped off because Tauri's
                // native OS-level window drag-drop and the webview's own
                // native HTML5 `dragover`/`drop` DOM events are mutually
                // exclusive on Windows/WebView2: leaving it `true` was
                // silently breaking the sidebar's HTML5 drag-and-drop
                // (lib/dnd/sidebar.ts and friends), which is the feature
                // that's actually built and in use today. Left in place
                // (rather than deleted) as a placeholder for if/when a real
                // file-import feature re-enables `dragDropEnabled` - at
                // which point the sidebar's HTML5 DnD would need to be
                // reconciled with this native path instead.
                //
                // Deliberately using `writeln!` to a raw stderr handle
                // instead of println!/eprintln! - see the global shortcut
                // registration failure handler below for why those macros
                // are unsafe to call from a release build with no attached
                // console.
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
        // M1 (spec.md subtask 1): notebooks are a real new entity - a
        // OneNote-style Notebook -> Section(folder) -> Note hierarchy sits
        // above the existing folders/notes tables, not a reinterpretation of
        // folders. Additive-only, same as migration 2's comment explains:
        // migrations 1 and 2's SQL strings are left byte-for-byte untouched
        // (tauri-plugin-sql checksums each migration and refuses to run any
        // migration at all if an earlier one's checksum no longer matches
        // what's recorded in `_sqlx_migrations`), so this applies cleanly as
        // a third step on top of either a fresh database or one that
        // already has real `folders`/`notes` rows from before this feature
        // existed.
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
        // spec.md subtask 7 ("Sidebar rework"): a note with no folder
        // currently has no way to know which notebook it belongs to (the
        // `notes` table only has `folder_id`, and folder_id can be NULL for
        // a root-level note) - the sidebar rework needs to scope notes to
        // "the currently open notebook" even when they have no folder, so
        // notes need a real `notebook_id` column of their own, mirroring
        // migration 3's exact approach for `folders.notebook_id` above
        // (additive-only, migrations 1-3's SQL strings stay byte-for-byte
        // untouched - tauri-plugin-sql checksums each migration and refuses
        // to run ANY migration if an earlier one's checksum no longer
        // matches what's recorded in `_sqlx_migrations`).
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
        // spec.md subtask 7 (M4, "Sidebar drag-and-drop"): sidebar reordering
        // needs a persisted sibling-order field for notes the same way
        // `folders.order_index`/`notebooks.order_index` already have one -
        // confirmed genuinely missing (notes.ts's `getNotes` only ever
        // ordered by `updated_at DESC`, and no `order`/`orderIndex` field
        // exists anywhere on the `notes` table or the `Note` type). Unlike
        // migrations 3/4's `notebook_id` backfills, a real constant
        // `DEFAULT 0` is sensible here (SQLite's `ALTER TABLE ... ADD
        // COLUMN` allows a `NOT NULL` column with a literal constant
        // default), so this is a plain single-statement additive migration
        // with no backfill UPDATE needed.
        tauri_plugin_sql::Migration {
            version: 5,
            description: "add notes.order_index",
            sql: "
                ALTER TABLE notes ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
            ",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // M6 (spec.md subtask 13): Pages are a real new entity - a Note
        // ("notesheet") becomes a lightweight container that groups one or
        // more Pages, each an independent canvas (its own `RichTextShape`s,
        // ink, etc.) - the actual editable content moves down one level,
        // from Note to Page. This mirrors the `notes` table's exact
        // sync-bookkeeping column shape (id, title, user_id, order_index,
        // content, canvas_data, created_at, updated_at, deleted_at, dirty,
        // synced_at), swapping `folder_id`/`type` for a single required
        // `note_id` FK (a page always belongs to a note, unlike a note's
        // nullable `folder_id`). `user_id` is kept (not dropped in favor of
        // joining through `notes`) so that subtask 14/15's data-access and
        // Firestore-pull code can filter/query pages with the exact same
        // flat `WHERE user_id = $1` / `where("userId", "==", userId)`
        // pattern already used for notebooks/folders/notes - Firestore has
        // no server-side joins, so this column is required, not optional.
        // Both `content` and `canvas_data`
        // are kept (rather than just `canvas_data`) to mirror `notes`'
        // exact shape per spec.md's literal wording for the `Page` type -
        // `notes.content`/`notes.canvas_data` are themselves left in place,
        // untouched, consistent with this migration list's established
        // non-destructive precedent (migrations 1-5 above never drop or
        // repurpose a column). No backfill is needed here: subtask 14's
        // atomic "new note always gets a default first page" and subtask
        // 18's migration-of-existing-content into a page are separate,
        // later subtasks - this migration only creates the empty table.
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
    ];

    // M5 (spec.md subtask 21): Google sign-in uses a system-browser +
    // deep-link flow instead of signInWithPopup/signInWithRedirect, since
    // Google's OAuth policy blocks sign-in attempts from embedded/
    // non-standard webviews (both signInWithPopup and signInWithRedirect
    // run inside the app's own WebView2 instance, which that policy
    // targets) - only the OS's actual default browser is trusted. See
    // lib/auth/googleOAuth.ts for the full flow and required external
    // (Google Cloud Console) configuration.
    //
    // tauri-plugin-single-instance must be registered first (per its docs)
    // so that when the system browser hands the `skylines://auth-callback`
    // URL back to Windows, and Windows spawns a *second* app process with
    // that URL as a CLI argument (deep-link plugin docs: "On Windows and
    // Linux the OS will spawn a new instance of your app with the URL as a
    // CLI argument"), this plugin intercepts that second launch, forwards
    // its argv to the already-running instance via the `deep-link` feature
    // flag below (which re-emits it as the deep-link plugin's
    // `deep-link://new-url` event - see tauri-plugin-single-instance's
    // Default::callback impl), and exits - instead of opening a duplicate
    // window.
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // No-op: the `deep-link` feature on this plugin (enabled in
            // Cargo.toml) already forwards argv into the deep-link plugin
            // before this callback runs, which is all app/login/page.tsx's
            // `onOpenUrl` listener needs.
        }));

        // M6 (spec.md subtask 24): global shortcut plugin. Desktop-only -
        // the crate itself is compiled to nothing on Android/iOS
        // (`#![cfg(not(any(target_os = "android", target_os = "ios")))]`
        // in tauri-plugin-global-shortcut's own lib.rs), but this is still
        // wrapped in `#[cfg(desktop)]` to match the guarding pattern used
        // for tray/menu/single-instance elsewhere in this file. Only the
        // handler is wired up here; the actual shortcut is registered (and
        // any registration failure handled non-fatally) down in `.setup()`
        // below, so a collision with another app's shortcut can't abort
        // this plugin's own `setup` step and take the whole app down with
        // it via the `.expect(...)` at the bottom of `run()`.
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

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:skylines.db", migrations)
                .build(),
        )
        .setup(|app| {
            // The `skylines://` scheme is declared in tauri.conf.json's
            // `plugins.deep-link.desktop.schemes`, which registers it with
            // the OS at install time for packaged (NSIS/MSI) builds. That
            // doesn't happen for `cargo run`/`tauri dev` debug builds on
            // Windows, so register it at runtime here too (matches
            // tauri-plugin-deep-link's own example app).
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            // M6 (spec.md subtask 23): system tray + native application menu.
            // Both are desktop-only concepts (there is no tray or native menu
            // bar on Android/iOS), so this is gated the same way as the
            // tauri_plugin_single_instance registration above.
            #[cfg(desktop)]
            setup_tray_and_menu(app)?;

            // M6 (spec.md subtask 24): register the "show/focus Skylines"
            // global shortcut. Mirrors the tray icon's "Show Skylines"
            // item/left-click behavior - a common "summon the app"
            // background hotkey pattern for note-taking/quick-capture apps
            // (Notion, Obsidian, etc). No other app-specific global
            // shortcuts are registered - there's no reliable way to, say,
            // quick-capture a note from outside the sidebar's own UI yet.
            //
            // Keybinding: Ctrl+Alt+S (Cmd+Option+S on macOS, via the
            // cross-platform "CmdOrCtrl" alias - see global-hotkey's
            // hotkey.rs parser). Chosen to be low-collision: plain
            // Ctrl+<letter> combos (Ctrl+N, Ctrl+O, ...) are heavily
            // reserved by browsers/OSes/IDEs, but two-modifier Ctrl+Alt (or
            // Cmd+Option) chords are rarely bound by other applications.
            // "S" is mnemonic for Skylines.
            #[cfg(desktop)]
            {
                use std::io::Write;
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                const SHOW_WINDOW_SHORTCUT: &str = "CmdOrCtrl+Alt+S";
                if let Err(err) = app.global_shortcut().register(SHOW_WINDOW_SHORTCUT) {
                    // Non-fatal: the combo may already be claimed by another
                    // application on the user's system. Unlike the tray/menu
                    // setup above (core UX, fails loudly via `?`), a global
                    // shortcut collision is a low-stakes, plausible-in-
                    // normal-use failure mode that shouldn't take down the
                    // whole app's startup.
                    //
                    // Deliberately NOT using eprintln!/println! here: those macros
                    // panic if the write fails (library/std/src/io/stdio.rs's
                    // print_to helper), and in a release build (main.rs sets
                    // windows_subsystem = "windows" for non-debug builds) there is
                    // no console attached unless the app was launched from one -
                    // GetStdHandle returns NULL, the write fails, and eprintln!
                    // would panic and crash the whole app on exactly the collision
                    // this handler exists to survive. writeln! on a raw Stderr
                    // handle returns a Result instead of panicking, so a failed
                    // write here is itself silently and safely ignored.
                    let _ = writeln!(
                        std::io::stderr(),
                        "failed to register global shortcut {SHOW_WINDOW_SHORTCUT}: {err}"
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
