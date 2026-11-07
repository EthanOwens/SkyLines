# Color-coded notes, synced settings and bug fixes

Source: planning.md, 2026-11-05

## Goal

Add a Settings dialog (opened from the account menu) with synced preferences, and use it to drive color-coding of notes and pages in the sidebar: each new note or page gets a palette color, shown as a left bookend, a faded highlight or both. The palette is part of the theme. Alongside, fix three bugs: relaunching a tray-hidden app does nothing, sticky notes never sync, and pages can fail to restore on a fresh database.

## Context

- **Shape of the app.** Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`. SQL migrations in `src-tauri/src/lib.rs` are checksummed and never edited. The latest is version 8 (`sticky_notes.favorite`); add new versions after it.
- **Terminology.** The code says "note" (`Note`, type `"note" | "canvas"`) and "page" (`Page`). The planning file's "notesheet" means a note. Every note has at least one page, created with it in `createNote`.
- **Sidebar rows.** `components/sidebar/NoteItem.tsx` and `PageItem.tsx` render one row each: a `div` with `group flex items-center gap-1.5 rounded-md ...`, background `bg-sidebar-accent` when active and `hover:bg-sidebar-accent` on hover (Tailwind classes, so an inline background would hide them). `menuItems()` in each is shared by the `···` dropdown and the right-click menu. `NoteItem` is also rendered by `FolderItem.tsx` and `FolderTree.tsx`. `PageItem` is rendered by `PageSidebar.tsx`.
- **Data layer.** `lib/db/notes.ts` and `lib/db/pages.ts` hold `rowToNote`/`rowToPage`, `createNote`/`createPage`, `updateNote`/`updatePage` (set `updated_at` and `dirty = 1`) and `upsertNoteFromRemote`/`upsertPageFromRemote`. The upserts use positional `$n` params in the column list, the VALUES list and `ON CONFLICT DO UPDATE SET`: all must change together, or pull silently breaks. `createNote` inserts the note and its first page with hardcoded column lists in one BEGIN/COMMIT string. Types are in `types/index.ts`; `StickyNote.topBarColor` is the precedent for a nullable color string.
- **Creation call sites.** Notes: `hooks/useCreateNote.ts`, `components/sidebar/FolderItem.tsx` (~L151), `lib/clipboard/sidebarClipboard.ts` (`duplicateNote`). Pages: `components/canvas/CanvasEditor.tsx` (~L202), `components/sidebar/PageSidebar.tsx` (~L65), `lib/clipboard/sidebarClipboard.ts` (`duplicatePage`).
- **Sync.** `lib/sync/push.ts` (`noteToFirestoreDoc`, `pageToFirestoreDoc`, `pushRows`, `pushDirtyRows`) and `lib/sync/pull.ts` (`toRemoteNoteData`, `toRemotePageData`, five independent `onSnapshot` listeners with one promise queue each, `applyDecision`, `startPullSync`). `lib/sync/engine.ts` runs push with backoff. Writes use `setDoc(..., {merge: true})`; last write wins by `updatedAt`.
- **Firestore rules** (`firestore.rules`) have no per-field validation. A generic `match /{collection}/{id}` checks that the collection is in an allowed list and that `userId` equals the signed-in uid. A new collection needs adding to that list, and the user deploys rules manually. Agents never deploy.
- **Themes.** Tailwind v4 CSS variables in `app/globals.css` (`@theme inline` maps `--color-*` to `--*`; `:root` and `.dark` define values). `lib/themes/types.ts` defines `ThemeVariableKey`/`THEME_VARIABLE_KEYS` (27 keys; `isTheme()` rejects unknown keys). `lib/themes/builtin.ts` has `LIGHT_THEME` and `DARK_THEME`, which must stay identical to the `globals.css` blocks. `lib/themes/apply.ts` sets inline styles on `<html>`. The editor is `components/theme/ThemeEditor.tsx` with `ThemeColorField.tsx`. User theme files simply lack new keys and fall through to `globals.css`.
- **Account menu.** `components/topbar/AccountMenu.tsx` is a `DropdownMenu` (email, sync status, Theme submenu with "Edit themes...", "Copy bug report", "Open logs folder", "Sign out", version). It owns dialog state beside the menu, as `ThemeEditor` does (`themeEditorOpen`). It is mounted by `TopBar` and, on the notebook picker, by `AppLayout`.
- **Existing preferences** are per-device localStorage modules in `lib/` (`quickAccessPrefs.ts`, `lastOpen.ts`, `themes/selection.ts`). The new settings are different: they sync.
- **No sync tests exist** in the root project; the only test file is `functions/src/resetCode.test.ts`. Sync tasks are verified by type checks, builds and reading, plus the tester where something is observable.

## Decisions

- **Settings UI**: a dialog opened from a new "Settings" item in the account menu (above "Copy bug report"), not a route. It works on the picker and with a notebook open, needs no `AppLayout` changes and avoids the `/` last-note restore bounce. The existing Theme submenu and "Edit themes..." stay where they are.
- **Settings sync** (user's choice): settings sync across devices. One row per user.
  - SQLite table `user_settings` (migration), keyed by `user_id`, with columns for the three settings, `updated_at`, `dirty` and `synced_at`.
  - Firestore collection `userSettings`, doc id = uid, with a `userId` field for the rules.
  - Whole-row last-write-wins by `updated_at`, like other collections.
  - `firestore.rules` gets `userSettings` in its allowed list; the user must deploy it. Until then settings still work locally and the push error is logged.
- **Settings contents** (this round): an "Aesthetics" section only, with three toggles:
  - "Automatic color coding", default on.
  - "Color bookend", default on.
  - "Color highlight", default off.
  - Bookend and highlight are independent; both, one or neither may be on.
- **Where colors show**: note rows and page rows in the sidebar only. Folders, notebooks, reference chips/picker and sticky notes are not colored.
- **Color model** (user's choice): a note or page stores a palette slot, one of `note-1` … `note-8`, or NULL for none. Slots resolve through the theme variables `--note-1` … `--note-8`, so a theme change recolors items. Existing notes and pages stay NULL (no retroactive coloring).
- **Palette**: a theme has a note palette of 1 to 24 colors (default 8). `ThemeVariableKey`s `note-1`…`note-24` hold the resolved colors; `globals.css` and `LIGHT_THEME`/`DARK_THEME` define the default 8 (light and dark). A palette is edited with the generator in `ThemeEditor` (T5a), which stores its settings with the theme. The palette size is the number of colors the active theme defines.
- **Auto assignment** (user's choice): when "Automatic color coding" is on, a new note or page takes the slot after the most recently created sibling that has a color, wrapping from the last palette color to 1; with no colored sibling it takes `note-1`. Siblings of a note are the non-deleted notes of the same notebook; siblings of a page are the non-deleted pages of the same note. A page's color is independent of its note's.
- **Auto off** (user's choice): new items get NULL; items that already have a color keep it and still render per the display toggles. Colors can always be changed or cleared by hand.
- **Manual change**: a "Color" submenu in the note and page row menus (both the `···` dropdown and the right-click menu, via the shared `menuItems()`): eight swatches plus "None".
- **Duplicates** (copy/paste of a note or page) keep the original's color. A duplicated note's first page keeps the color of its source page.
- **Display rules**: bookend is a narrow bar on the row's left edge; highlight is a faded tint over the whole row. The tint must not hide the active or hover state. Rows with no color render as today.
- **Sticky-note sync fix**: the repo's rules and push mapping have no mismatch and `stickyNotes` has been in the rules since the first commit, so the likely cause is deployed rules or an earlier collection throwing. The code fix is to isolate each collection's push so one thrown error doesn't starve the others, and to record the error code where it reaches the log file. Confirming and deploying rules is the user's manual step.
- **Pull ordering fix**: use a combination of (a) parents-first ordering across collections (notebooks, then folders, then notes, then pages), (b) a per-change try/catch so one failure doesn't drop the rest of a batch, (c) in-memory deferral and retry of changes that fail with an FK error, and (d) parents-first sorting of folders within a snapshot. FKs stay enforced.
- **Relaunch fix**: the single-instance callback calls `show_main_window(app)`.

## Out of scope

- Syncing the theme selection or the Theme submenu, or moving them into Settings.
- Coloring folders, notebooks, references or sticky notes.
- Retroactively coloring existing notes and pages.
- A free-form hex color per note or page.
- Deploying Firestore rules or Cloud Functions, and checking the Firebase console. Those are manual steps for the user.
- Cross-window live propagation of theme or settings changes to open sticky or image-editor windows.

## Tasks

### T1 Relaunching the app shows the hidden window

Status: done
Depends on: none
Tester: no. A second launch and the tray are outside the tester's reach.

In `src-tauri/src/lib.rs` (~L527) the `tauri_plugin_single_instance::init` callback is empty. Make it call `show_main_window(app)` (defined at ~L180, `#[cfg(desktop)]`, already used by the tray and the global shortcut). The closure is already inside the `#[cfg(desktop)]` block, so no extra gating is needed.

Files: `src-tauri/src/lib.rs`

Acceptance:
- The single-instance callback calls `show_main_window` with the app handle and no longer has an empty body.
- `(cd src-tauri && cargo check)` passes.

Test steps (manual):
1. Run the app, close the window so it hides to the tray, then launch SkyLines again from the Start menu or desktop. The existing window reappears and no second instance stays running.

### T2 Sticky notes (and every collection) push independently

Status: done
Depends on: none
Tester: no. Reproducing needs a failing Firestore, which the tester can't create safely.

In `lib/sync/push.ts`, `pushDirtyRows` pushes folders, notes, notebooks, pages and stickyNotes sequentially, and `pushRows` rethrows any error that isn't `invalid-argument`, aborting the whole pass. Change it so each collection's push runs in its own try/catch: a thrown error in one collection is recorded and the remaining collections still push. After all collections have run, the pass still reports failure (so `lib/sync/engine.ts` schedules its backoff retry), and the first error is rethrown or returned. Make sure the Firestore error `code` and message are written somewhere that reaches the Tauri log file, not only the webview console: find how other frontend code gets into the log file (the `tauri-plugin-log` usage or console attach) and follow it; add that to the `engine.ts` push-failure log at ~L213. Add one line to the README's Firebase section: if sticky notes stay dirty with a `permission-denied` error, publish `firestore.rules` (`npx firebase-tools deploy --only firestore:rules --project <project id>`), a manual step.

Files: `lib/sync/push.ts`, `lib/sync/engine.ts`, `README.md`

Acceptance:
- An error thrown while pushing one collection does not prevent later collections from being pushed in the same pass.
- A pass where any collection threw still ends in the engine's error/backoff path, and the error code and message are logged through a path that reaches the log file.
- `invalid-argument` and `too-big` handling is unchanged.
- The README mentions publishing `firestore.rules` for a `permission-denied` on sticky notes. No code runs a deploy.

Test steps (manual):
1. With deployed rules lacking `stickyNotes` (or a deliberately failing collection), edit a note and a sticky note. The note syncs; the sticky push error code appears in the logs folder.
2. After publishing `firestore.rules`, the dirty sticky notes sync on the next pass.

### T3 Pull applies parents before children and survives orphans

Status: done
Depends on: T2
Tester: no. Reproducing needs a fresh database and a race, which can't be set up safely in the shared test account.

In `lib/sync/pull.ts`, fix the FK failures ("FOREIGN KEY constraint failed" when a page arrives before its note, a note before its folder or notebook, a child folder before its parent):
- **Gate.** Each collection's apply waits for its parents' first snapshot to finish applying: notebooks, then folders, then notes, then pages. Sticky notes are independent. A per-collection "ready" promise resolved after the first snapshot's queue drains is enough; make sure a listener restart resets the gates and that a listener that errors still releases them.
- **Per-change isolation.** In each `subscribeXPull`, wrap each change in its own try/catch so one failing change doesn't drop the rest of the batch. Non-FK errors still go to the existing `console.error` and `onApplyError` path.
- **Deferral.** A change that fails with an FK error is held in an in-memory pending list and retried after the next successful apply in any parent collection and after the batch drains. Retries are bounded so a permanently orphaned doc (parent never arrives) cannot loop; it stays pending until the listener restarts and is not reported as an error.
- **Folders.** Within one snapshot, apply folders parents-first (sort by `parentId` depth, or defer on FK as above).

Keep the change small and local to `pull.ts`; don't disable foreign keys.

Files: `lib/sync/pull.ts` (and `lib/sync/engine.ts` only if the listener-restart hook needs it)

Acceptance:
- Pages, notes and folders arriving ahead of their parents are applied once the parent is applied, with no "FOREIGN KEY constraint failed" error surfacing and no restart needed.
- A failure on one change in a snapshot does not stop the remaining changes in that snapshot from being applied.
- Retries are bounded, and a restart of the pull listeners resets the gate and pending state.
- Existing behaviour for dirty local rows (`decidePull` returns skip) is unchanged.

Test steps (manual):
1. On a fresh database (new local profile or deleted app data) signed in to an account with notes and pages, launch the app. All notebooks, notes and pages appear on the first launch and the log has no FK errors.

### T4 Notes and pages can store a color

Status: done
Depends on: T3
Tester: no. There is no UI yet; T8 and T9 exercise it end to end.

Add a nullable `color` (palette slot string, NULL = none) to notes and pages, through the whole data path:
- **Migration.** In `src-tauri/src/lib.rs` add the next version (9) with `ALTER TABLE notes ADD COLUMN color TEXT` and `ALTER TABLE pages ADD COLUMN color TEXT`, following the v5/v8 style. Don't edit existing migrations.
- **Types and rows.** Add `color: string | null` to `Note` and `Page` in `types/index.ts` and to `NoteRow`/`PageRow` and `rowToNote`/`rowToPage`.
- **Writes.** Add `color` to `updateNote` and `updatePage`'s accepted fields. Extend `createNote` and `createPage` with an optional color parameter (default null); `createNote`'s optional color applies to the note, and an optional first-page color parameter (default null) applies to its first page. Keep the BEGIN/COMMIT string and its numbered params consistent.
- **Remote.** Add `color` to `RemoteNoteData`/`RemotePageData` and to `upsertNoteFromRemote`/`upsertPageFromRemote`: the column list, VALUES count, `ON CONFLICT DO UPDATE SET` and params array together.
- **Sync.** Add `color` to `noteToFirestoreDoc` and `pageToFirestoreDoc` in `push.ts`, and `color: (data.color as string | null) ?? null` to `toRemoteNoteData` and `toRemotePageData` in `pull.ts`.
- **Conflict snapshots.** Check `lib/sync/cleanup.ts` and `lib/db/syncConflicts.ts` and make sure a color column doesn't break them.
- **Slot type.** Add a shared module `lib/colors/noteColors.ts` exporting `NOTE_COLOR_SLOTS` (`note-1`…`note-8`), an `isNoteColorSlot` guard and `noteColorVar(slot)` returning `var(--note-N)`. A stored value that isn't a valid slot is treated as no color by readers.

Files: `src-tauri/src/lib.rs`, `types/index.ts`, `lib/db/notes.ts`, `lib/db/pages.ts`, `lib/sync/push.ts`, `lib/sync/pull.ts`, `lib/sync/cleanup.ts`, `lib/db/syncConflicts.ts`, new `lib/colors/noteColors.ts`

Acceptance:
- Migration 9 exists, adds both columns, and no existing migration changed.
- `Note.color` and `Page.color` round-trip through create, update, push and pull; an old remote doc without the field reads as null.
- Every upsert's column list, VALUES count, SET clause and params agree.
- All verification commands pass.

Test steps:
1. After the app reloads (the new migration runs), existing notes and pages open and sync normally; `webview_execute_js` against the SQL plugin shows a `color` column on both tables, all NULL.

### T5 The theme has an 8-color note palette

Status: done
Depends on: none
Tester: yes. The CSS variables and editor fields are observable in the DOM and computed styles.

Add `note-1`…`note-8` to `ThemeVariableKey` and `THEME_VARIABLE_KEYS` in `lib/themes/types.ts`, define light and dark default values in `app/globals.css` (`:root` and `.dark`, as `--note-N`) and mirror them in `LIGHT_THEME` and `DARK_THEME` in `lib/themes/builtin.ts`, which must stay identical to the CSS. Use eight distinguishable oklch hues of similar lightness, readable as a thin bar and as a faded tint over `--sidebar` in both modes. Expose the eight values in `ThemeEditor` as a "Note colors" group using `ThemeColorField`, and in `ThemePreview` if it fits without redesign. Existing user theme files lacking the keys must still load (`isTheme()` accepts missing keys) and fall through to the CSS defaults.

Files: `lib/themes/types.ts`, `lib/themes/builtin.ts`, `app/globals.css`, `components/theme/ThemeEditor.tsx` (and `ThemePreview.tsx` if used)

Acceptance:
- `getComputedStyle(document.documentElement).getPropertyValue("--note-1")` through `--note-8` are non-empty in both light and dark.
- `LIGHT_THEME`/`DARK_THEME` and the `globals.css` blocks agree for the new keys.
- The theme editor shows eight editable note-color fields, and editing one changes the variable live.
- An existing saved user theme without these keys still loads and applies.

Test steps:
1. Read `--note-1`…`--note-8` from `document.documentElement` in the main window. All are non-empty.
2. Open the account menu → Theme → Edit themes. A "Note colors" group with eight fields shows. Don't save anything; close the dialog and discard changes.
3. Switch the theme between System/Light/Dark if available without changing saved themes, and check the variables stay non-empty. Restore the original selection.

### T5a The theme editor has a note palette generator

Status: done
Depends on: T5
Tester: yes. The editor controls and the resulting CSS variables are observable in the DOM.

Replace the eight plain "Note colors" fields that T5 added to `ThemeEditor` with a palette generator, and let a palette have 1 to 24 colors. The approved design (from the mockups in the planning chat) is:

- **Swatch strip** at the top: one box per color, filling the full width. Clicking a box opens a popover with a color wheel (hue by angle, saturation by radius, at full brightness), an inline editable hex box and a Copy button. Choosing a color there overrides that one color (marked with a small dot on the box). Dragging that color's hue line, or "Reset to hue" in the popover, removes the override.
- **Hue bar** directly below, the same width as the strip, showing the hue spectrum with one thin line per color. Dragging a line changes only that color's hue (0 to 360).
- **Global bar** directly below that, much smaller (about 14px high), same width: a thin gradient rail between the first and last color's hues, a column at each end (start and end, thin and slightly thicker than the hue lines, filled with that end's color) and a circle in the middle filled with the middle hue's color. Dragging an end column changes that end's hue and respaces all colors evenly between start and end. Dragging the circle moves all hues together, clamped to 0 to 360.
- **Colors** control: a small number input with up/down arrows, 1 to 24. Changing it respaces the colors evenly between the current start and end and drops overrides on removed colors.
- **Start and end readout** on the same line: a color chip and "start #hex" / "end #hex", where the hex is a small inline editable field (looks like text, dotted underline on hover). Typing a valid hex moves that end to the hex's hue (oklch hue) and respaces; the displayed text is normalized on blur.
- **Lightness and Chroma**: each a slider followed by a small inline editable number (Lightness 0.30 to 0.95, Chroma 0 to 0.40, step 0.01, up/down arrow keys nudge). These two are global for the palette.
- **Reset** button (small, right of the Colors line): restores 8 colors, hues 25 to 340, lightness 0.66, chroma 0.16, no overrides.
- Generated colors are `oklch(L C H)`; a hand-picked override is a fixed hex and ignores lightness and chroma.

Theme data: the theme stores the resolved colors as `note-1`…`note-N` (extend `ThemeVariableKey`/`THEME_VARIABLE_KEYS` to `note-24`; `isTheme()` must still accept missing keys) plus the generator settings (count, per-color hues, lightness, chroma, overrides) so reopening the editor restores the generator exactly. A theme with colors but no stored settings opens with the colors as overrides on a default generator. `globals.css` and `LIGHT_THEME`/`DARK_THEME` keep the default 8; keys beyond the theme's count are left unset. Live editing updates the CSS variables as the other fields do; no change is saved until the user saves the theme.

Add to `lib/colors/noteColors.ts`: `getNotePaletteSize()` (the number of consecutive non-empty `--note-N` variables on the document root, starting from 1; at least 1 is not assumed, 0 means no palette) and widen `isNoteColorSlot`/`NOTE_COLOR_SLOTS` handling so any `note-N` with N from 1 to 24 is a valid stored slot. A slot above the palette size resolves to no color. Update T5's group in `ThemeEditor` (remove the eight plain fields) and `LIGHT_THEME`/`DARK_THEME` only as needed.

Files: `components/theme/ThemeEditor.tsx` (and new components under `components/theme/` for the generator and popover), `lib/themes/types.ts`, `lib/themes/apply.ts` (if needed), `lib/colors/noteColors.ts`, `app/globals.css` (only if needed)

Acceptance:
- The theme editor shows the generator in place of the eight plain fields, with the controls above.
- Editing any control changes the matching `--note-N` variables live; reducing or raising the count adds or removes variables.
- Dragging a hue line changes only that color; dragging an end column respaces between the ends; dragging the circle shifts all.
- Typing a hex in start or end moves that end's hue; overriding one color through the wheel or hex box changes only that color.
- Reset restores the defaults. Saving and reopening a theme restores the generator settings, overrides and count.
- Themes without generator settings and themes without `note-*` keys still load and apply.
- `getNotePaletteSize()` returns the palette's color count, and slots above it resolve to no color.
- All verification commands pass.

Test steps:
1. Open the account menu, Theme, Edit themes. The generator shows with 8 colors, start `#e3645e` and end `#d066b1` (approximately), Lightness 0.66 and Chroma 0.16. Don't save anything; discard changes at the end.
2. Set Colors to 5 and then 12. `--note-1`…`--note-5` then `--note-1`…`--note-12` are non-empty on `document.documentElement`, and `getNotePaletteSize()` matches.
3. Click a swatch, type a hex such as `#3366cc`: only that color changes and shows the override dot; "Reset to hue" removes it.
4. Edit the start hex: the colors respace between the new start and the end. Press Reset: the defaults return.
5. Manual: dragging the hue lines, the end columns and the center circle, and how the bars line up with the strip, can't be simulated reliably; check by hand.

### T6 Synced user settings store

Status: done
Depends on: T4
Tester: no. There is no UI until T7; T7's tester covers the store end to end.

Build the settings data path so a single per-user row syncs:
- **Migration.** Next version (10) in `src-tauri/src/lib.rs` creating `user_settings` (`user_id TEXT PRIMARY KEY`, `auto_color INTEGER NOT NULL DEFAULT 1`, `color_bookend INTEGER NOT NULL DEFAULT 1`, `color_highlight INTEGER NOT NULL DEFAULT 0`, `updated_at INTEGER`, `dirty INTEGER NOT NULL DEFAULT 0`, `synced_at INTEGER`), following the timestamp conventions of the other tables. No row exists until the user first changes something or one is pulled; readers use the defaults.
- **DB layer.** New `lib/db/userSettings.ts`: `getUserSettings(userId)` (returns defaults when no row), `updateUserSettings(userId, partial)` (upserts, bumps `updated_at`, sets `dirty = 1`), `getDirtyUserSettings`, `markUserSettingsSynced` and `upsertUserSettingsFromRemote` (consistent column lists), plus the `UserSettings` type in `types/index.ts`.
- **Sync.** Push: add a `userSettings` collection to `push.ts`, doc id = `userId`, fields the three settings plus `userId`, `updatedAt`. Pull: a sixth listener in `pull.ts` for `userSettings` (independent of the parent gate) filtered by `userId == uid` like the others, applying through `decidePull` and `upsertUserSettingsFromRemote`. Follow how an existing simple collection (stickyNotes) is wired, including error isolation from T2/T3. Check `lib/sync/cleanup.ts` for anything that should include the new table.
- **Rules.** Add `userSettings` to the allowed collections in `firestore.rules`. The user must publish it; note this in the README Firebase section.
- **Store/hook.** A zustand slice or a `hooks/useUserSettings.ts` that loads the signed-in user's settings, exposes them and a setter that writes through `updateUserSettings` and triggers a push (as other data hooks do via `useSyncEngine`), and updates when a pull applies a change. It resets when the user changes (follow `resetForUser()` in `stores/appStore.ts`) so one account never shows another's settings.

Files: `src-tauri/src/lib.rs`, `types/index.ts`, new `lib/db/userSettings.ts`, `lib/sync/push.ts`, `lib/sync/pull.ts`, `lib/sync/engine.ts`/`hooks/useSyncEngine.ts` (as needed), `stores/appStore.ts` or new `hooks/useUserSettings.ts`, `firestore.rules`, `README.md`

Acceptance:
- Migration 10 exists and no existing migration changed.
- With no row, readers get defaults: auto on, bookend on, highlight off.
- Updating a setting stores it locally, marks it dirty and pushes it to `userSettings/{uid}`; a remote change updates the local row and the in-memory settings.
- Settings never leak between accounts after switching users.
- `firestore.rules` allows `userSettings` under the same `userId` check as other collections.
- All verification commands pass.

Test steps:
1. After reload, `webview_execute_js` confirms the `user_settings` table exists and the settings hook returns the defaults for `dev@skylines.local`.

### T7 Settings dialog with an Aesthetics section

Status: done
Depends on: T6
Tester: yes. The dialog, toggles and their persistence are observable in the DOM.

Add a "Settings" item to `components/topbar/AccountMenu.tsx`, above "Copy bug report", that opens a new `components/settings/SettingsDialog.tsx` (use `components/ui/dialog.tsx`; hold the open state in `AccountMenu` beside the menu, as `themeEditorOpen` does). The dialog has an "Aesthetics" section with three switches bound to the settings from T6:
- "Automatic color coding" (new notes and pages get a color automatically).
- "Color bookend" (a bar on the left of the note or page name).
- "Color highlight" (a faded tint over the whole name card).

Use the existing UI components for toggles (add a switch component only if none exists, following `components/ui/` conventions). Short helper text under each switch. Works on the notebook picker and with a notebook open.

Files: `components/topbar/AccountMenu.tsx`, new `components/settings/SettingsDialog.tsx`, `components/ui/switch.tsx` (only if missing)

Acceptance:
- The account menu has a "Settings" item that opens the dialog on the picker and inside a notebook.
- The dialog shows an "Aesthetics" heading and the three switches with defaults on, on, off for an account with no stored settings.
- Toggling a switch updates the store immediately and survives closing and reopening the dialog and reloading the window.
- No existing account-menu item changed.

Test steps:
1. Signed in as `dev@skylines.local`. Open the account menu and click "Settings". The dialog opens with "Aesthetics" and three switches: automatic on, bookend on, highlight off (if the account already has other values, note them and restore them at the end).
2. Turn "Color highlight" on and "Color bookend" off. Close and reopen the dialog: the switches keep those values. Reload the window and reopen: still the same.
3. Restore the original values of all three switches and close the dialog.

### T8 New notes and pages get a color automatically

Status: done
Depends on: T4, T5a, T6
Tester: yes. The new rows' `color` values are readable from SQLite or a DOM attribute.

Add a shared helper in `lib/colors/noteColors.ts` (or a sibling `lib/colors/autoColor.ts`): given the settings and the siblings' colors (ordered by creation), it returns the slot for a new item per Decisions (next after the most recent colored sibling, wrapping from the last palette color to `note-1`, `note-1` when none, null when automatic coloring is off), using `getNotePaletteSize()` from T5a. Add a function that reads the current settings and the right siblings from SQLite (non-deleted notes of the notebook for a note; non-deleted pages of the note for a page), and use it at every creation site:
- Notes: `hooks/useCreateNote.ts` and `components/sidebar/FolderItem.tsx`. A new note's first page also gets a color (the page rule, computed against an empty page list, so `note-1` when automatic coloring is on).
- Pages: `components/sidebar/PageSidebar.tsx` and `components/canvas/CanvasEditor.tsx` (~L202).
- Duplicates in `lib/clipboard/sidebarClipboard.ts`: `duplicateNote` and `duplicatePage` copy the source's color instead (ignoring the auto setting), the duplicated note's first page keeping its source page's color.

Files: `lib/colors/noteColors.ts` (or new `lib/colors/autoColor.ts`), `hooks/useCreateNote.ts`, `components/sidebar/FolderItem.tsx`, `components/sidebar/PageSidebar.tsx`, `components/canvas/CanvasEditor.tsx`, `lib/clipboard/sidebarClipboard.ts`

Acceptance:
- With automatic coloring on, creating notes in a notebook yields consecutive slots `note-1`, `note-2`, … wrapping after the last palette color (`note-8` with the default palette); the same holds for pages within a note.
- With it off, new notes and pages get no color.
- Duplicating a note or page keeps the source's color in both modes.
- Existing notes and pages are not recolored. All verification commands pass.

Test steps:
1. Signed in as `dev@skylines.local` with "Automatic color coding" on. Create a new note (sidebar "New note"). Read its row from SQLite via `webview_execute_js`: its `color` is the slot after the notebook's most recent colored note, or `note-1` if none, and its first page has a color.
2. Add two pages with the page "+" button. Their colors are consecutive slots.
3. Turn automatic coloring off in Settings and create another note and page. Both have NULL color.
4. Delete the notes you created and restore the setting.

### T9 Color shows on rows and can be changed by hand

Status: todo
Depends on: T4, T5a, T7
Tester: yes. Row attributes and computed styles are observable; "looks right" is left to the user.

In `NoteItem.tsx` and `PageItem.tsx`, render a note's or page's color according to the settings: if it has a valid slot and "Color bookend" is on, show a narrow bar on the row's left edge (the row needs `relative`; keep the indent and layout unchanged); if "Color highlight" is on, show a faded tint (for example `color-mix(in oklab, var(--note-N) 18%, transparent)`) over the whole row. Layer the tint with a pseudo-element or background-image so the active (`bg-sidebar-accent`) and hover states still show. Both on, one on or neither all work, and a row with no color or an invalid stored slot looks as it does today. Put `data-note-color="<slot>"` on the row when it has a color so the tester can read it, and give the bar and tint elements stable `data-` hooks.

Add a "Color" submenu to `menuItems()` in each (so it appears in both the `···` dropdown and the right-click menu): one swatch per palette color (each using the slot's variable) plus "None", marking the current one, calling `updateNote`/`updatePage` with the slot or null. Choosing a color works regardless of the automatic setting.

Files: `components/sidebar/NoteItem.tsx`, `components/sidebar/PageItem.tsx`, possibly a shared `components/sidebar/ColorMenu.tsx`

Acceptance:
- With bookend on, a colored row has a left-edge bar whose color is the slot's CSS variable; with highlight on it has a tint; with both on it has both; with both off it has neither.
- The active and hover backgrounds are still visible on colored rows.
- Rows without a color are unchanged.
- The "Color" submenu is in both the dropdown and right-click menus of notes and pages; choosing a swatch sets the row's `data-note-color` and persists it (and marks it dirty for sync); "None" clears it.
- All verification commands pass.

Test steps:
1. Signed in as `dev@skylines.local`; note the Settings toggle values and restore them at the end. Create a note with automatic coloring on. Its sidebar row has `data-note-color` and, with bookend on, a bar element.
2. In Settings turn highlight on: the same row also has the tint element; turn bookend off: the bar is gone; turn both off: neither shows.
3. Use the row's `···` → Color to pick a different swatch: `data-note-color` changes. Pick "None": the attribute is gone.
4. Repeat 3 on a page row in the page sidebar.
5. Delete the notes you created and restore the settings.
6. Manual: judge that the bar and tint look right in light and dark, and with the row active and hovered.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Relaunching the app shows the hidden window
- [x] T2 Sticky notes (and every collection) push independently
- [x] T3 Pull applies parents before children and survives orphans
- [x] T4 Notes and pages can store a color
- [x] T5 The theme has an 8-color note palette
- [x] T5a The theme editor has a note palette generator
- [x] T6 Synced user settings store
- [x] T7 Settings dialog with an Aesthetics section
- [x] T8 New notes and pages get a color automatically
