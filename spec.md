# Multi-device sync consistency, sidebar resizing and canvas tables

Source: planning.md, 2026-11-07

## Goal

Make the app consistent when it is used on more than one computer: an open page shows edits from another device, a stale computer catches up before it acts on old data, deleted-elsewhere notes disappear, and losing versions of a conflict can be viewed and restored. Alongside, add resizable sidebars, replace the empty File ribbon tab with an Insert tab, and add spreadsheet-style tables to the canvas.

## Context

- **Shape of the app.** Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`. SQL migrations in `src-tauri/src/lib.rs` are checksummed and never edited; the latest is version 8 plus any added since (check before adding one). Notes are `type: "note" | "canvas"`; every note has pages; all notes open on `/canvas` (`app/note/page.tsx` just redirects).
- **Sync.** `lib/sync/pull.ts` (Firestore `onSnapshot` into SQLite, `decidePull` last-write-wins on `updatedAt`, dirty/conflict handling, `createGate` ordering: notebooks, folders, notes, pages), `lib/sync/push.ts`, `lib/sync/engine.ts` (status `saved | syncing | offline | error`, `startSyncEngine`), `hooks/useSyncEngine.ts` (mirrors status into `stores/appStore.ts`). `lib/db/events.ts` `notifyDataChange("local" | "remote")` is how React learns of SQLite writes; `useNotes`-style hooks refetch on it with a request-id guard.
- **Open canvas page.** `app/canvas/page.tsx` renders `PageSidebar` (`components/sidebar/PageSidebar.tsx`) and `components/canvas/CanvasEditor.tsx`. The page list lives in the store (`pages`), loaded once and only refreshed by the user's own actions. `<Tldraw key={selectedPage.id}>` remounts per page and `handleMount` loads `page.canvasData` once. Autosave is an `editor.store.listen({source: "user", scope: "document"})` handler, debounced 800 ms, that calls `updatePage` (always sets `updated_at = now`, `dirty = 1`); a pending save is flushed on unmount. `RichTextShape` writes `lastEditedAt` on every Tiptap update.
- **Backups.** `lib/db/syncConflicts.ts` stores the losing version of a conflict as a JSON blob in `sync_conflicts` (`table_name, row_id, losing_data, created_at`). `getSyncConflicts(table, row)` exists but has no callers and there is no restore code. For `conflict-remote-wins` the blob is the local row (has `dirty`, `syncedAt`); for `conflict-local-wins` it is the remote data (no such fields).
- **Settings dialog.** `components/settings/SettingsDialog.tsx` has a left sidebar with tabs Appearance and History (History always listed; shows "There is nothing to restore." when empty). History uses `hooks/useDeletedNotes.ts`, `getDeletedNotes`/`restoreNote` in `lib/db/notes.ts`, and `emptyNoteHistory` in `lib/sync/cleanup.ts`, which deletes Firestore docs immediately.
- **Layout.** `components/shell/AppLayout.tsx` places `components/sidebar/Sidebar.tsx` (`w-60`, collapsed rail `w-12`, `border-r`) then the main column with `components/ribbon/Ribbon.tsx`. `PageSidebar` (`w-52`, collapsed `w-10`, local `useState` for collapsed, no right border) is rendered by `app/canvas/page.tsx` next to the editor. No resize or panel library is installed. The window is 1200x800 with no min width. Per-device UI prefs live in small `lib/*.ts` localStorage helpers (`lib/quickAccessPrefs.ts`, `lib/lastOpen.ts`): key prefix `skylines:`, try/catch, validated parse, read after mount (static export hydration). `userSettings` is synced and wrong for per-device widths.
- **Ribbon.** `Ribbon.tsx` hard-codes `type RibbonTab = "file" | "format" | "draw"`, default `"file"`, fixed `h-24`, one-row bodies using `FormatBtn` (tooltip plus ghost icon button), `Separator` and lucide icons (the `Table` icon is available). The File tab renders only "No actions available." Format already holds "Insert image" (file input calling `activeEditor.chain().setImage`) and "Insert link" (`requestLinkDialog`). A `useEffect` returns the canvas tool to `"rich-text"` when the effective tab is not Draw. Store: `activeCanvasEditor` (tldraw `Editor`) and `activeEditor` (Tiptap, only while a text box is edited).
- **Custom shapes.** `components/canvas/RichTextShape.tsx` is the pattern: `BaseBoxShapeUtil` with `static type`, `static props` (tldraw validators), `static migrations` (a new prop on an existing shape needs a migration or the validator rejects stored records), `component()`, `indicator()`, module augmentation of `TLGlobalShapePropsMap`. Utils are registered in the module-level `shapeUtils` array in `CanvasEditor.tsx`. While editing it uses `useIsEditing`, `pointerEvents: "all"` plus `onPointerDownCapture={stopEventPropagation}`, and `pointerEvents: "none"` otherwise. Canvas data is the tldraw snapshot stored in `pages.canvas_data`; a snapshot that fails validation on `loadSnapshot` silently starts blank and the next autosave overwrites it, so props and migrations must be exact. `RichTextTool` (click to edit, auto-return to rich-text) is specific to `rich-text`.
- **Undo.** TopBar undoes in the Tiptap editor when `activeEditor` is set, else the canvas. A table must not set `activeEditor`.

## Decisions

- **Live sync of the open page:** apply a remote edit automatically when the page is idle (row clean, newer than what the editor loaded or saved, no pending local save, nothing being edited); otherwise show a "newer version available" banner with a Reload button. Never overwrite in-progress typing.
- **Catching up:** show an indicator and make the canvas read-only only while online and only until the first server snapshot settles, with a timeout (8 s) so starting offline never blocks. The default-page creation for a note with no pages waits for the same signal.
- **Backups screen:** a third Settings tab, "Backups", always listed (shows "There are no backups." when empty). Notes and pages only. Shows the last 30 days, and rows older than that are deleted when the tab loads.
- **Reconcile:** notes and pages only. Soft-delete locally (so the note appears in History) rather than hard-delete, mark the row not dirty so no push happens, never touch dirty rows.
- **Sidebar widths:** per-device, in a localStorage helper, not synced. Collapse still wins over the stored width. Double-click the handle to reset to the default width.
- **Tables:** a new custom tldraw shape `table`, hand-written, no new dependency. Core spreadsheet scope: typing in cells, arrow/Tab/Enter navigation, range selection, add/remove rows and columns, resizing, copy/paste to and from Excel (tab-separated text), formulas.
- **Insert tab:** holds Table, Insert image and Insert link (the last two move out of Format). Insert is the default tab; File is removed.
- **Ribbon tabs on non-canvas routes:** every note opens on `/canvas`, so Insert needs no route gating. Keep the existing Draw fallback logic, defaulting to Insert.

## Out of scope

- Version counters or transactional push; `serverTimestamp()` for `updatedAt`.
- A periodic whole-database snapshot.
- Backups for folders, notebooks, sticky notes or settings; hard-delete reconcile for folders and notebooks.
- Merging two edits of the same page (conflicts stay last-write-wins with a backup).
- Tables in sticky notes or the legacy text editor; searching text inside table cells; charts, multiple sheets, cell styling, merged cells, absolute references (`$A$1`).
- Moving the bug-report or sync-failure UI.

## Tasks

### T1 Adding a page can't fail silently or use stale order

Status: done
Depends on: none
Tester: no, the failure needs a second device's changes to reproduce; the code changes are checked by reading

`handleAddPage` in `components/sidebar/PageSidebar.tsx` is `try/finally` with no `catch`, so any failure in `autoColorForNewPage` or `createPage` is an unhandled rejection and `refresh()` never runs. It also computes the new order from the store's `pages`, which can be stale after a remote pull. Add a `catch` that logs with a `[PageSidebar]` prefix and shows no crash, and compute the order from a fresh `getPages` read. Do the same fresh read in the other place that calls `nextOrderValue` for pages (page paste/drop in the same file and `lib/clipboard/sidebarClipboard.ts`) only if it uses the store list.

Files: `components/sidebar/PageSidebar.tsx`, `lib/clipboard/sidebarClipboard.ts` (expected, not exhaustive)

Acceptance:
- `handleAddPage` has a `catch` that logs the error and does not rethrow; the sidebar refreshes in `finally`.
- The new page's order is derived from a `getPages` call made inside the handler, not from the store list.
- `npx tsc --noEmit` passes.

Test steps:
1. Manual: with the same note open on two devices, change the note's pages on device A, then add a page on device B. The page is added at the end, nothing crashes, and any error appears in the console log.

### T2 Opening a page without editing never changes it

Status: done
Depends on: none
Tester: yes, observable by reading the page row's `updated_at` before and after

Autosave in `CanvasEditor.tsx` writes on every user-sourced document change and on unmount, with no comparison, so a stale snapshot can later win over another device's edit. Keep a ref with the serialized snapshot last loaded or saved (set right after `loadSnapshot` in `handleMount` and after every successful `updatePage`). Before the debounced save and before the unmount flush, serialize `editor.getSnapshot()` and skip `updatePage` when it equals the ref. Do not change the existing migration saves (they already only run when something changed).

Files: `components/canvas/CanvasEditor.tsx`

Acceptance:
- Opening a page and navigating away or switching pages without editing leaves `pages.updated_at` and `dirty` unchanged.
- A real edit (typing in a text box, moving a shape) still saves within about a second and sets `dirty = 1`.
- A pending edit is still flushed when leaving the page.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Signed in as the test account, create a note, open it, type a few words, wait 2 seconds. Read its page row's `updated_at` (for example through the SQL plugin from `webview_execute_js`).
2. Switch to another note and back without touching the canvas. Read `updated_at` again: it is unchanged.
3. Type one more character, wait 2 seconds: `updated_at` is larger and the text is saved.
4. Delete the note you created.

### T3 An open page shows edits from other devices

Status: done
Depends on: T2
Tester: yes, remote edits can be simulated by writing the page row with `origin "remote"`-style update or by a second app window; the tester says which it used

Today nothing refetches pages: the store's `pages` and the live editor go stale when a remote pull changes them. In `app/canvas/page.tsx` or `CanvasEditor.tsx`, subscribe with `subscribeDataChange`, debounce, and refetch the current note's pages with a request-id guard (as `useNotes` does). Update the store `pages` (sidebar list, titles, order; if the selected page was deleted remotely, select the first remaining page). For the selected page, apply the remote content to the live editor only when all hold: the refetched row is not dirty, its `updatedAt` is greater than the last value the editor loaded or saved (track in a ref beside T2's snapshot ref), no autosave is pending, `editor.getEditingShapeId()` is null and no Tiptap editor has focus. Apply with `editor.loadSnapshot` and make sure that does not trigger autosave or `updatePage`, and update the T2 ref. When the conditions don't hold, show a banner above the canvas, "A newer version of this page is available", with a Reload button that loads it (and a dismiss). Re-evaluate when the editing state ends so a deferred update can apply. The title input resyncs from the refetched row when it is not focused.

Files: `app/canvas/page.tsx`, `components/canvas/CanvasEditor.tsx`, `components/sidebar/PageSidebar.tsx`, `stores/appStore.ts` (expected, not exhaustive)

Acceptance:
- With a page open and idle, a remote change to that page's canvas appears without leaving the page, within about two seconds of the pull.
- While a text box is being edited or a local save is pending, a remote change does not alter the canvas; the banner appears and Reload applies it.
- Applying a remote snapshot never writes `updated_at` or sets `dirty` on the page.
- Pages added or deleted remotely appear in or leave the page sidebar without a manual action.
- Switching pages and reopening notes still works; `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Create a note with text "alpha" in a text box; leave it open and idle.
2. Change the page's stored canvas data to a version with "beta" through the SQL plugin as a remote write (clean row, newer `updated_at`, then notify as remote), or edit it from a second window. The open canvas shows "beta" without navigation.
3. Click into the text box to start editing, repeat the remote change: the canvas keeps what you typed, the banner appears, Reload shows the remote text.
4. Confirm the page row's `dirty` is 0 after the idle apply.
5. Delete the note you created.

### T4 Catching-up state after launch

Status: todo
Depends on: none
Tester: no, needs a real second device's data and network conditions; the logic is checked by reading and by the build

The pull's first snapshot isn't distinguished from a cache-only or partial one and nothing exposes it, so a stale device acts on old data and `CanvasEditor` can create a duplicate default page for a note whose pages haven't arrived. In `lib/sync/pull.ts` record when the first snapshot of notebooks, folders, notes and pages has been applied and came from the server (`snapshot.metadata.fromCache === false`); expose an initial-sync state (`pending | settled`) from `lib/sync/engine.ts` with a subscribe function and mirror it into the store in `hooks/useSyncEngine.ts`, resetting it on sign-out or restart. It settles after all four first snapshots, or on a listener error, or after 8 seconds, or immediately while offline. While `pending` and online: the account-menu label in `components/topbar/AccountMenu.tsx` reads "Catching up..." and the canvas is read-only (`editor.updateInstanceState({ isReadonly: true })`, restored on settle and on unmount). `CanvasEditor`'s "note has no pages, create a default page" step waits for `settled` first and re-reads `getPages` before creating.

Files: `lib/sync/pull.ts`, `lib/sync/engine.ts`, `hooks/useSyncEngine.ts`, `stores/appStore.ts`, `components/topbar/AccountMenu.tsx`, `components/canvas/CanvasEditor.tsx`

Acceptance:
- The store exposes an initial-sync state that is `pending` after `startSyncEngine` and `settled` after the four first server snapshots, a listener error, 8 seconds, or when offline.
- The canvas is never left read-only after `settled`, after unmount, or when the app starts offline.
- The default page is not created for a note while `pending`; after `settled` it is created only if `getPages` is still empty.
- `npx tsc --noEmit`, `npm run build` pass.

Test steps:
1. Manual: sign in on a second computer that has stale data and launch. The account menu briefly shows "Catching up...", then "Synced"; the canvas accepts edits afterwards.
2. Manual: launch with the network off. The app is editable immediately and shows "Offline".

### T5 Backups tab to view and restore losing versions

Status: todo
Depends on: none
Tester: yes, conflicts can be seeded by inserting rows into `sync_conflicts` for a note the tester created

Add a "Backups" tab to `SettingsDialog.tsx`, always listed after History. In `lib/db/syncConflicts.ts` add a function listing conflicts for `notes` and `pages` from the last 30 days newest first, keeping only those whose parsed `losing_data.userId` matches the signed-in user, and a function deleting rows older than 30 days (call it when the tab loads). Add a hook beside `useDeletedNotes` that loads and refreshes them. Each row shows the item's title (or "Untitled"), "Note" or "Page", and when the conflict was recorded, with a Restore button. Restore: if the target row is missing or deleted, show "The original no longer exists" and do nothing; otherwise first record the current version of the target as a new backup (so a mistaken restore can be undone), then apply the losing version as an ordinary edit through `updateNote` (title, content, canvasData) or `updatePage` (title, canvasData), which sets a fresh `updatedAt` and `dirty`. The two stored shapes differ (local row vs remote data); read only the fields both have. The tab shows "There are no backups." when empty. Use a bordered, scrolling box like History.

Files: `components/settings/SettingsDialog.tsx`, `lib/db/syncConflicts.ts`, `hooks/useSyncConflicts.ts` (new)

Acceptance:
- The Settings sidebar lists Appearance, History and Backups; Backups always appears.
- With no conflicts the tab says "There are no backups."
- A seeded conflict row for the user's note appears with its title and a Restore button; rows for other users or older than 30 days do not.
- Restore applies the old title/content, creates a new backup of what it replaced, sets the target dirty with a newer `updated_at`, and the list refreshes.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Create a note titled "Backup test", edit it. Insert a `sync_conflicts` row for that note with `losing_data` holding an older title "Old title" and the note's user id.
2. Open Settings, Backups: a row for "Old title" appears. Click Restore: the note's title becomes "Old title" and a second row appears holding "Backup test".
3. Delete the seeded rows and the note.

### T6 Notes deleted on another device don't linger as zombies

Status: todo
Depends on: T4
Tester: no, it needs a Firestore document removed from outside the app

"Empty history" removes the Firestore doc immediately and pull ignores "removed" events, so a device that never pulled the deletion keeps the note forever. After the initial sync has settled from a server snapshot (T4), compare the id sets: for `notes` and `pages`, any local row for this user with `deleted_at IS NULL`, `dirty = 0` and `synced_at` not null whose id is absent from the server's first snapshot is soft-deleted locally (`deleted_at = now`, `dirty = 0`, so nothing is pushed and the note shows in History; its pages with it). Run once per engine start. Guardrails: do nothing if the snapshot was from cache, if the server returned no documents for the collection while local clean rows exist, if any first-snapshot apply errored, or if it would affect more than 5 rows and more than half of the user's clean local rows in that collection; log the skip with a `[sync/reconcile]` prefix. Never touch dirty rows or rows with `synced_at` null.

Files: `lib/sync/pull.ts` or a new `lib/sync/reconcile.ts`, `lib/db/notes.ts`, `lib/db/pages.ts` (expected, not exhaustive)

Acceptance:
- A clean, synced local note missing from the server's first snapshot becomes soft-deleted and appears in History; a dirty or never-synced note does not.
- No reconcile happens when the first snapshot is from cache, empty with local data present, or after an apply error; each logs why.
- No Firestore write happens during reconcile.
- `npx tsc --noEmit`, `npm run build` pass.

Test steps:
1. Manual: on computer A and B, sync a note. On B, quit the app. On A delete the note and use Empty history. Relaunch B: the note is gone from the sidebar and appears under History.

### T7 Resizable sidebars

Status: todo
Depends on: none
Tester: yes, the drag can be simulated with pointer events on the handle; native window drag is not involved

Add a vertical drag handle on the right edge of the note sidebar and of the page sidebar. Create a reusable resize handle component (pointer events with `setPointerCapture` on the handle, listeners cleaned up on `pointerup`, `pointercancel`, `lostpointercapture` and window blur; `col-resize` cursor and no text selection while dragging; never HTML5 draggable). Widths clamp to note sidebar 180 to 480 and page sidebar 140 to 360, and also so the main column keeps at least 400 px given the other sidebar. Store them in a new `lib/sidebarWidths.ts` following `lib/quickAccessPrefs.ts` (key `skylines:sidebarWidths`, validated parse, read after mount to avoid a hydration mismatch, written on drag end). Replace the fixed `w-60` and `w-52` with the stored widths only when expanded; collapsed rails keep `w-12` and `w-10` and expanding restores the stored width. Double-clicking a handle resets that sidebar to its default. The page sidebar needs its own right border so its handle is visible. Ensure long names still truncate (`min-w-0`) and the sidebar drag-and-drop targets still work.

Files: `components/sidebar/Sidebar.tsx`, `components/sidebar/PageSidebar.tsx`, `components/sidebar/ResizeHandle.tsx` (new), `lib/sidebarWidths.ts` (new)

Acceptance:
- Dragging either handle changes that sidebar's width live, within the clamps, and the width is the same after a reload.
- Double-click resets to 240 px (note) or 208 px (page).
- Collapsing and expanding keeps the stored width; the collapsed rails do not change.
- Sidebar items can still be dragged and dropped; the ribbon and canvas fill the remaining space.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Open a canvas note. Dispatch pointerdown, pointermove, pointerup on the note sidebar handle moving 100 px right; the sidebar's computed width grows by about 100 px. Drag far past the limits: it stops at 480 (and never squeezes the main area below 400).
2. Reload (`location.reload()`), re-enter the note: the widths persist.
3. Double-click each handle: widths return to 240 and 208.
4. Collapse and expand each sidebar: expanded width is the stored one.
5. Manual: judge that the handles feel right with a mouse.

### T8 Insert ribbon tab replaces File

Status: todo
Depends on: none
Tester: yes, tab contents and state are DOM-observable

In `components/ribbon/Ribbon.tsx` remove the `file` tab and its "No actions available." body, add `insert` to `RibbonTab`, make it the first tab and the default, and update the fallback logic (a selected Draw tab off the canvas falls back to Insert). The Insert body is one row built from the existing `FormatBtn` and `Separator`: "Insert image" and "Insert link" (move the existing buttons and their handlers out of the Format tab unchanged, so Format is formatting only) and a "Table" button (lucide `Table` icon) whose handler is a placeholder until T9 wires it (disabled with a tooltip "Open a canvas page" when `activeCanvasEditor` is null). Keep the Sticky notes button and the `useEffect` that returns the tool to rich-text when the tab is not Draw.

Files: `components/ribbon/Ribbon.tsx`

Acceptance:
- The ribbon tabs read Insert, Format, Draw (Draw only on the canvas route); there is no File tab.
- Insert is selected on first render and holds Insert image, Insert link and Table; the Format tab no longer has the image and link buttons.
- Insert image and Insert link behave as before.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Open a canvas note. The first tab is Insert and is selected; there is no File tab.
2. Click Format: no image or link buttons. Click Insert: image, link and Table buttons show.
3. Click a text box, then Insert link: the link dialog opens as before.

### T9 Insert a table onto the canvas

Status: todo
Depends on: T8
Tester: yes, shape creation and cell contents are observable through the editor and DOM

Add `components/canvas/TableShape.tsx` modeled on `RichTextShape.tsx`: a `TableShapeUtil extends BaseBoxShapeUtil` with `static type = "table"`, props `w`, `h`, `colWidths: number[]`, `rowHeights: number[]` and `cells: Record<string, string>` (keys like `"A1"`, values the typed text including a leading `=` for formulas), validators from tldraw's `T`, a versioned migration sequence (even if empty, to match the pattern), module augmentation of `TLGlobalShapePropsMap`, `canEdit() { true }`, an `indicator()`, and a default of 4 columns by 5 rows (column widths 100, row heights 28) with a header row of column letters and row numbers drawn as non-editable gutters. Register it in `shapeUtils` in `CanvasEditor.tsx`. The component renders a grid inside `HTMLContainer`; double-click or typing on a selected cell edits it with a plain input, Enter commits and moves down, Tab commits and moves right, Escape cancels, and commits go through `editor.updateShape` (so tldraw history undoes them, and `activeEditor` is never set). The shape follows the same pointer-events gate as rich-text (cells interactive only when editing the shape; otherwise tldraw selects and drags the whole shape) with capture-phase stopping of pointer and key events so typing, Delete and arrows don't trigger tldraw shortcuts. Wire the Insert tab's Table button to create the shape at the viewport center, select it and set it as the editing shape. Check `RichTextTool`'s `PointingShape.onPointerUp`, which calls `setEditingShape` for any editable shape, behaves for a table, and that the Draw tab effect doesn't interfere. Handle a table in `lib/references/resolve.ts` labeling and any other `type === "rich-text"` checks only to the extent they would throw on a `table` shape.

Files: `components/canvas/TableShape.tsx` (new), `components/canvas/CanvasEditor.tsx`, `components/ribbon/Ribbon.tsx`, `lib/references/resolve.ts`

Acceptance:
- Insert, Table creates a 4x5 table in the middle of the visible canvas and selects it.
- Cells can be edited with Enter, Tab and Escape behaving as described; the values survive saving, switching pages and reloading the app.
- A stored table record loads without a validation error (the canvas does not blank); undo reverts a cell edit.
- Typing in a cell does not move the shape or trigger tldraw shortcuts.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Open a canvas note, click Insert, Table: a table appears with column letters and row numbers.
2. Double-click cell A1, type "hello", press Enter, then Tab in B1 and type "x", Enter. A1 reads "hello" and B1 "x".
3. Switch to another page and back, then `location.reload()` and re-enter: the values are still there.
4. Press undo: the last cell edit is reverted.
5. Delete the note you created.

### T10 Table rows, columns, resizing, selection and clipboard

Status: todo
Depends on: T9
Tester: yes, grid state and sizes are observable; clipboard events can be dispatched as in CLAUDE.md

Extend the table: selecting a cell highlights it and arrow keys move the selection; shift-click or shift-arrow selects a rectangular range; a right-click context menu on a cell (or small buttons in the gutters) offers Insert row above/below, Insert column left/right, Delete row, Delete column (at least one row and column always remain), Clear cells; deleting or inserting rows and columns remaps `cells` keys, `colWidths` and `rowHeights` and keeps the shape's `w` and `h` in step. Drag the border of a column letter or row number gutter to resize that column or row (pointer capture, minimum 40 px wide and 20 px tall) and update `w`/`h`. Copy (Ctrl/Cmd+C) of a selection puts tab-separated text with newline-separated rows on the clipboard, cut clears it, and paste fills from the selected cell (growing the grid if the pasted block overhangs); pasting tab-separated text copied from Excel works. Delete clears the selected range. Handle the paste event on the table's DOM with the clipboard data, like the ProseMirror paste note in `CLAUDE.md`.

Files: `components/canvas/TableShape.tsx`

Acceptance:
- Arrow keys and shift-extension select single cells and rectangles; Delete clears them.
- Each row/column operation produces the expected grid, keeps the contents of the remaining cells in the right place, and never deletes the last row or column.
- Resizing a column or row by dragging its gutter border changes `colWidths`/`rowHeights`, respects the minimums and persists.
- Copy produces TSV; pasting two rows of tab-separated text into B2 fills B2:C3 and grows the grid when needed.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Insert a table; type 1, 2, 3 down column A. Select A1:A3 with shift-click; dispatch a copy event and read the clipboard data: "1\n2\n3".
2. Use the context menu: Insert column right of A; the old column B contents move to C. Delete the new column: back to the original.
3. Dispatch a paste event with "a\tb\nc\td" on B2: B2=a, C2=b, B3=c, C3=d.
4. Drag the gutter border between A and B 60 px right: column A is 160 wide (stored `colWidths[0]`).
5. Delete the note you created.

### T11 Table formulas

Status: todo
Depends on: T10
Tester: yes, computed text is observable in the DOM

Add a pure-TypeScript formula engine in `lib/tables/formula.ts`: a cell whose stored text starts with `=` is evaluated for display, with the raw text shown while editing. Support numbers, `+ - * /`, parentheses, unary minus, cell references (`A1`), ranges (`A1:B3`) and the functions SUM, AVERAGE, MIN, MAX, COUNT; references resolve recursively with cycle detection. Blank cells count as 0 in arithmetic and are skipped in ranges, text cells are 0 (and skipped in ranges). Errors display as `#ERROR!` (syntax), `#REF!` (outside the grid), `#DIV/0!`, `#CYCLE!`. Evaluate at render only and never store results. When rows or columns are inserted or deleted (T10), rewrite references in stored formulas so they keep pointing at the same cells (a reference to a deleted row or column becomes `#REF!`). Numeric results display without trailing noise (round to 10 decimal places). Add a small unit-style check of the engine that can run in the build (a script under `scripts/` invoked with `node`, or a test run by the functions suite if easier) and report its result.

Files: `lib/tables/formula.ts` (new), `components/canvas/TableShape.tsx`

Acceptance:
- `=1+2*3` shows 7; `=SUM(A1:A3)` with 1, 2, 3 above shows 6; `=AVERAGE(A1:A3)` 2; MIN, MAX and COUNT work.
- `=A1/0` shows `#DIV/0!`; a self-referencing cell shows `#CYCLE!`; `=A99` beyond the grid shows `#REF!`; `=1+` shows `#ERROR!`.
- Editing a referenced cell updates dependents; the stored cell text is the formula, not the result.
- Inserting a row above row 1 changes `=A1` to `=A2` in the shifted cell.
- `npx tsc --noEmit` and `npm run build` pass.

Test steps:
1. Insert a table; enter 1, 2, 3 in A1:A3 and `=SUM(A1:A3)` in A4: A4 shows 6. Change A2 to 5: A4 shows 9.
2. Enter `=A1/0` in B1: `#DIV/0!`. Enter `=B2` in B2: `#CYCLE!`.
3. Insert a row above row 1: the sum cell is now in A5 and still shows 9.
4. Delete the note you created.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Adding a page can't fail silently or use stale order
- [x] T2 Opening a page without editing never changes it
- [x] T3 An open page shows edits from other devices
