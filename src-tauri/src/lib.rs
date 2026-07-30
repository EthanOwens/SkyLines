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
                // does nothing further. `dragDropEnabled` is set on the
                // window in tauri.conf.json so these events actually fire.
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
