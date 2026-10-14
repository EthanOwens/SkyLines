# Sticky note polish, working bullet lists, references to anything

Source: planning.md, 2026-10-12

## Goal

Three areas. Sticky notes get their own taskbar group and icon on Windows, keep their top bar buttons when collapsed, and show previews on the home page that update live. Bullet lists in every text editor become visible and behave like VS Code's Markdown editing. The broken "embed a sticky note" link becomes a general reference system: anything in the app (notebook, folder, note, page, canvas shape, sticky note) can be copied as a reference, pasted or picked into any text box, shown as a prefixed chip with a hover preview, and followed with a click.

## Context

- Tauri v2.11.5 (Rust, `src-tauri/`) around a Next.js static export. `@tauri-apps/api` 2.11.1. Tauri APIs are imported dynamically inside handlers and effects (no Tauri runtime during the static build); follow that pattern.
- Windows created at runtime: sticky notes via `openStickyNoteWindow` in `lib/stickyWindow.ts` (label `sticky-<id>`, `decorations: false`), image editor via `lib/imageEditorWindow.ts`. Each label pattern has a capability file in `src-tauri/capabilities/` (`default.json` = `main` only, `sticky.json`, `image-editor.json`). A window can only use the plugin/core permissions its file grants.
- Cross-window communication uses Tauri events: `emit` / `listen` from `@tauri-apps/api/event`, as in `image-editor:saved:<id>` (`components/editor/ImageEditor.tsx` emits, `StickyNoteEditor.tsx` / `RichTextShape.tsx` listen). `lib/db/events.ts` (`notifyDataChange` / `subscribeDataChange`) is in-memory per window and does not cross windows.
- Data hierarchy: Notebook → Folder (nested via `parent_id`) → Note (`/canvas?id=<noteId>`) → Page (`pages` table, `canvas_data` = tldraw snapshot JSON) → tldraw shapes. Sticky notes (`sticky_notes`) sit outside the tree. All row IDs are `crypto.randomUUID()`. Shape IDs (`shape:<nanoid>`) live inside a page's snapshot, are only unique within that page and are duplicated when a page is copied, so a shape is identified by `(pageId, shapeId)`. Types in `types/index.ts`, DB access in `lib/db/*.ts`, migrations in `src-tauri/src/lib.rs` (never edit an existing one).
- The main window's store (`stores/appStore.ts`) holds notebooks, folders and notes for all notebooks (loaded by `components/AppShell.tsx`); pages are loaded only for the open note (`getPages(noteId)` for others). Sticky and image-editor windows have no shell and no loaded store.
- Navigation: `setSelectedNotebook(id)` + `router.push("/")` shows a notebook's tree; notes open with `router.push("/canvas?id=<noteId>")`; `CanvasEditor.tsx` picks the first page on load (`setSelectedPageId`) and loads the snapshot in `handleMount`.
- Three Tiptap 3.29.2 editors each build their own extension list today: `components/editor/RichTextEditor.tsx`, `components/editor/StickyNoteEditor.tsx`, `components/canvas/RichTextShape.tsx` (a tldraw shape; also adds `Highlight`). All three add `Link.configure({ openOnClick: false })` on top of StarterKit v3, which already bundles Link with `openOnClick: true`, so two `link` extensions run.
- Tiptap's Link rejects any href whose scheme isn't http/https/ftp/mailto/tel/etc. (`isAllowedUri`), so `sticky:<id>` links set by `components/editor/LinkOrStickyDialog.tsx` have never been applied. `lib/tiptap/stickyLinkClick.ts` and the `a[href^="sticky:"]` styles in `components/editor/editor.css` have therefore never matched anything.
- Canvas text boxes (`RichTextShape.tsx`) have `pointer-events: none` on their content unless being edited, and `setEditable(false)` when not editing. The auto-return-to-text-tool logic is in `components/canvas/RichTextTool.tsx` (`requestReturnToRichText`, `clearPendingReturnToRichText`, `shapesWithSuppressedReenter`, `switchToToolExplicitly`).
- Context menus: the sidebar items share a `menuItems()` function between the "···" `DropdownMenu` and a Base UI `ContextMenu` (`components/ui/context-menu.tsx`), in `FolderItem.tsx`, `NoteItem.tsx`, `PageItem.tsx`; sticky cards have one in `components/sticky/StickyNotesHome.tsx`. The canvas uses tldraw's default context menu with no overrides. Base UI has no `asChild`; use `render`.
- Clipboard: only `writeImage` from `@tauri-apps/plugin-clipboard-manager` is used and granted. Text needs `clipboard-manager:allow-write-text` / `allow-read-text` added to the relevant capability files.
- External URLs open with `@tauri-apps/plugin-opener` (`openUrl`); `opener:default` is granted in `default.json` only.
- Verification and testing per `CLAUDE.md`. Development and the tester run on macOS, so Windows-only code (`#[cfg(windows)]`) isn't compiled by `cargo check`; if `rustup target list --installed` shows a Windows target, also run `cargo check --target <it>`.

## Decisions

- **Collapsed sticky bar:** when collapsed, the top bar shows the dot menu, Pin, Minimize and Close whether or not the window is focused. Expanded behaviour is unchanged (controls only while focused).
- **Sticky home previews** refresh live through a Tauri event emitted whenever a sticky note is created, updated or deleted, and show up to 3 lines of text.
- **Taskbar:** on Windows, sticky windows get their own taskbar group (a separate AppUserModelID, `SkyLines.StickyNotes`) and a sticky-note icon. macOS shows one Dock icon per app, so there (and on Windows too) each sticky window's title is the note's title instead of "Sticky note", which names it in the Dock's right-click list, the Window menu and Alt-Tab. The implementer makes a simple placeholder icon (`src-tauri/icons/sticky.png`) that the user can replace.
- **Bullets:** "- " (dash then space) at the start of a line starts a bullet list; a dash alone stays a dash. Enter adds a bullet at the same level; Enter on an empty nested bullet moves it out one level, and on an empty top-level bullet ends the list (stock behaviour). Tab indents and Shift+Tab outdents the bullet(s) the cursor or selection touches. Where there's nothing to indent or outdent (plain text, the first bullet of a list, Shift+Tab on a top-level bullet, a selection crossing the list's edge), Tab and Shift+Tab do nothing and focus stays in the editor. Backspace at the start of a bullet removes it (stock). The same applies to numbered and task lists.
- **Numbered lists** start from "1. " (stock) and also from "1 " (a 1 then a space, user's request after T5's first pass). Only the digit 1 triggers the short form, so lines like "3 apples" or "2024 recap" stay as text.
- **List styling:** markers by depth (disc, circle, square, then repeat) and a left indent per level, in `editor.css`, scoped to `.tiptap` and excluding task lists. Don't install `@tailwindcss/typography`; it would restyle headings and paragraphs everywhere.
- **The three editors share one extension factory** in `lib/tiptap/extensions.ts`.
- **Reference format:** the clipboard text is `skylines://<kind>/<id>` with kind `notebook`, `folder`, `note`, `page` or `sticky`, and `skylines://shape/<pageId>/<shapeId>` for a canvas shape. It reuses the app's registered deep-link scheme, though opening these from outside the app is out of scope.
- **Reference rendering:** an inline atom node (not a Link mark, which avoids URL sanitisation) shown as a chip. In-app places use "#" plus a short path ending in the item's live title (for example "#Week 3 › Lecture notes"), and sticky notes use "%" plus the title. If the user had text selected when inserting, that text becomes the chip's fixed label (after the prefix) instead of the live title. A reference whose target is gone shows its last known title struck through, with "Not found" in its preview. Web links stay normal Link marks with a small "↗" after them.
- **Inserting references:** paste a `skylines://` token into any text box and it becomes a chip. The Insert link dialog (Ctrl/Cmd+K, the bubble menu's link button and the Ribbon Format tab's link button) has a URL field, a paste-reference field, a searchable tree (notebooks › folders › notes › pages › text boxes), the sticky notes list and "Create new sticky note".
- **Copying references:** right-click › "Copy reference" on notebooks, folders, notes, pages, sticky cards (home and the sticky window's dot menu) and canvas shapes.
- **Following references:** in a canvas text box that isn't being edited, a single click on a chip or web link follows it. While editing, and in the always-editable sticky and main editors, Ctrl/Cmd+click follows it. Notebook: show it in the sidebar on the home page. Folder: same, with the folder selected and expanded. Note: open it. Page: open its note on that page. Shape: open the note on that page, then select the shape and zoom to it. Sticky: open its window. From a sticky window, in-app references bring the main window forward and navigate there. Web links open in the default browser.
- **Hover preview:** hovering a chip or web link for about 400ms shows a card with the kind, the path, the title, and up to 3 lines of text (or the first image if there's no text). For web links it shows the full URL.
- The ID uniqueness rule means a copied page's shapes keep their IDs. A shape reference always includes its page, so it still resolves to the original page.

## Out of scope

- Syncing sticky notes to Firestore. References to sticky notes won't resolve on another device until sticky sync exists.
- Opening `skylines://` references from outside the app (OS deep links).
- Typing a prefix ("#", "%") to search and insert a reference inline.
- Backlinks ("what references this?") and updating references when items are copied.
- Per-window Dock icons on macOS (not possible).
- Changing the sticky note bottom bar or the image editor.

## Tasks

### T1 Collapsed sticky notes keep their top bar buttons

Status: done
Depends on: none

In `components/editor/StickyNoteTopBar.tsx`, the controls block (Pin, the `MoreVertical` dot menu, Minimize, Close) renders only when `focused && !collapsed`. Change it to render when `focused || collapsed`. The collapsed bar is already the tall `h-10` variant and fits inside the 48px collapsed window (`COLLAPSED_HEIGHT` in `StickyNoteEditor.tsx`). Keep the button group's `onDoubleClick` stopPropagation so double-clicking a button doesn't toggle collapse. Update the file's header comment to describe the new rule.

Files: `components/editor/StickyNoteTopBar.tsx`

Acceptance:
- The controls block renders when the note is collapsed, focused or not, and when it is expanded and focused.
- When expanded and unfocused, the bar still shows only the title.
- Double-clicking a button in the group doesn't collapse or restore the window.

Test steps:
1. Open a sticky note window and double-click its top bar: it collapses, and the dot menu, Pin, Minimize and Close buttons are visible.
2. Click the main window so the sticky note loses focus: the collapsed bar still shows all four buttons.
3. Click the dot menu on the collapsed note: the menu opens. Close it.
4. Double-click the bar's title: the note restores to its previous size.

### T2 Live sticky note previews on the home page

Status: done
Depends on: none

`StickyNotesHome` (`components/sticky/StickyNotesHome.tsx`) loads notes once per open, so edits made in a sticky window don't show until it's reopened. In `lib/db/stickyNotes.ts`, after `createStickyNote`, `updateStickyNote` and `deleteStickyNote` write to SQLite, emit a Tauri event `sticky-note:changed` with `{ id }` (dynamic import of `@tauri-apps/api/event`, ignore failures). In `StickyNotesHome`, while `open`, `listen` for it and re-fetch with `getStickyNotes` (also refresh `openNoteIds`), unlistening on close. Make sure a rename being typed on a card isn't overwritten by a refresh (the card's local `title` state). For previews, call `extractPlainText(note.content, 300)` (`lib/tiptap/extractText.ts`) and change the preview span's `line-clamp-2` to `line-clamp-3`.

Files: `lib/db/stickyNotes.ts`, `components/sticky/StickyNotesHome.tsx`

Acceptance:
- `createStickyNote`, `updateStickyNote` and `deleteStickyNote` emit `sticky-note:changed`.
- The home listens only while open and cleans up the listener on close and unmount.
- Card previews use up to 300 characters, clamped to 3 lines.

Test steps:
1. In the main window, open Sticky notes from the Ribbon. Create a sticky note, so its window opens alongside.
2. Type three or four lines of text into the sticky note and wait about a second: the card in the still-open home updates without closing the dialog.
3. The card shows up to 3 lines of preview text.
4. Rename the sticky note in its window and click out of the title: the card's title updates.
5. Delete the test note from its dot menu: its card disappears from the open home.

### T12 Deleted sticky note windows can be closed

Status: done
Depends on: none

Added after T2: a sticky note deleted during testing left its window open. When that window reloaded, `app/sticky/page.tsx` showed only "Sticky note not found." Sticky windows have `decorations: false`, so there was no way to close it. Three changes:
- On the not-found screen (and the no-id screen), keep a slim top bar with the app's drag behaviour (`useWindowDrag` from `hooks/useWindowDrag.ts`) and a Close button that calls `getCurrentWindow().close()`, styled like the Close button in `components/editor/StickyNoteTopBar.tsx`.
- An open sticky window closes itself when its note is deleted from anywhere. Listen for `sticky-note:changed` (`STICKY_NOTE_CHANGED_EVENT` in `lib/db/stickyNotes.ts`, from T2) for its own id, check `getStickyNoteById`, and if the note is gone, close the window without saving. Deleting from the home page's card menu therefore closes that note's window too.
- Find out why deleting from the top bar's dot menu (`handleDelete` in `StickyNoteTopBar.tsx`) can leave the window open, and fix it if the cause is in the app. The second change also catches this case, but report what you find.

Files: `app/sticky/page.tsx`, `components/editor/StickyNoteEditor.tsx` or `app/sticky/page.tsx` (listener), `components/editor/StickyNoteTopBar.tsx`

Acceptance:
- The not-found and no-id screens show a draggable bar with a working Close button.
- Deleting a sticky note from the home page closes its open window.
- Deleting from the window's own dot menu closes the window.
- A pending debounced save in a window whose note was deleted doesn't bring the note back or write to it.

Test steps:
1. Create a sticky note from the Sticky notes home so its window opens. Then delete it from its card's menu in the home: its window closes.
2. Create another, type a word, and delete it from its own dot menu: the window closes.
3. Use `webview_execute_js` in main to open a sticky window for an id that doesn't exist (for example via `openStickyNoteWindow` or by creating a `WebviewWindow` with label `sticky-<fake id>` and url `/sticky/?id=<fake id>`): it shows "Sticky note not found." under a bar with a Close button. Click Close: the window closes.
4. Check the Sticky notes home: neither test note is listed.

### T3 Sticky windows get their own taskbar group, icon and title

Status: done
Depends on: none

Add a Rust command `setup_sticky_window(label: String)` in `src-tauri/src/lib.rs` and register it in the invoke handler. It looks up the window and sets its icon from an embedded `src-tauri/icons/sticky.png` (`tauri::image::Image::from_bytes(include_bytes!(..))`; enable the `image-png` feature on `tauri` in `Cargo.toml`). Under `#[cfg(windows)]` only, it gets the window's `hwnd()` and sets `PKEY_AppUserModel_ID` to `SkyLines.StickyNotes` through `SHGetPropertyStoreForWindow`, using the `windows` crate as a Windows-only dependency with the needed Win32 features. That splits sticky notes into their own taskbar group. On other platforms that part is a no-op. Create `sticky.png` as a simple placeholder (a yellow square sticky note with a folded corner, 256×256) using whatever tooling is at hand.

In `lib/stickyWindow.ts`, pass the note's title (or "Untitled") as the window `title` (the caller fetches it with `getStickyNoteById`, or `openStickyNoteWindow` takes an optional title), and call `invoke("setup_sticky_window", { label })` after the window's `tauri://created` event. In `StickyNoteEditor.tsx`, call `getCurrentWindow().setTitle(...)` when the title is saved. Add `core:window:allow-set-title` to `sticky.json`. Also check whether `existing.setFocus()` in `openStickyNoteWindow` needs `core:window:allow-set-focus` in `default.json` (it runs from the main window) and add it if missing.

Files: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/icons/sticky.png` (new), `lib/stickyWindow.ts`, `components/editor/StickyNoteEditor.tsx`, `src-tauri/capabilities/sticky.json`, `src-tauri/capabilities/default.json`

Acceptance:
- `setup_sticky_window` is registered, sets the window icon from `sticky.png` on every platform, and sets the AppUserModelID only under `#[cfg(windows)]`.
- The `windows` crate dependency is Windows-only.
- Sticky windows open with the note's title as their window title, and the title updates on rename.
- `cargo check` passes on macOS.

Test steps:
1. Open an existing sticky note: it opens normally, with no errors in the logs about `setup_sticky_window` or set-focus.
2. Read the sticky window's title (`manage_window` / window info): it's the note's title, not "Sticky note".
3. Rename the note in its title field and click away: the window title changes to match.
4. Manual, Windows: open two sticky notes. They appear as a separate taskbar group from the main SkyLines window, with the sticky-note icon, and hovering the group lists them by title.
5. Manual, macOS: right-click the Dock icon. Each sticky window is listed by its note's title.

### T4 Shared editor extensions and visible lists

Status: done
Depends on: none

Bullet lists already work underneath (typing "- " creates one), but nothing draws them. The editors use `prose` classes from `@tailwindcss/typography`, which isn't installed, and Tailwind's preflight strips list markers and padding. Create `lib/tiptap/extensions.ts` exporting a factory (for example `createEditorExtensions({ placeholder, highlight })`) that returns the extension list the three editors build today, and switch `RichTextEditor.tsx`, `StickyNoteEditor.tsx` and `RichTextShape.tsx` to it with no behaviour change (keep the duplicate Link for now; T9 cleans it up). In `components/editor/editor.css`, style `.tiptap ul:not([data-type="taskList"])` and `.tiptap ol`: markers disc → circle → square by nesting depth and decimal for `ol`, a left padding of about 1.25em per level, and small vertical spacing between items. Check that canvas text boxes still size sensibly.

Files: `lib/tiptap/extensions.ts` (new), `components/editor/RichTextEditor.tsx`, `components/editor/StickyNoteEditor.tsx`, `components/canvas/RichTextShape.tsx`, `components/editor/editor.css`

Acceptance:
- All three editors get their extensions from `lib/tiptap/extensions.ts`; only the canvas passes the option that adds `Highlight`.
- Bullet lists show markers that change with depth, and each nesting level is indented.
- Numbered lists show numbers; task list styling is unchanged.

Test steps:
1. In a canvas text box, type "- one", Enter, "two": two bullet points with visible dots.
2. Press Tab on "two" (it has a bullet above it): it indents and its marker changes to a hollow circle.
3. Type "1. first" on a new line outside the list: a numbered list with "1." appears.
4. In a sticky note, type "- a", Enter, "b": visible bullets there too.
5. Delete the test text and close the sticky note if you created it.

### T5 Tab and Shift+Tab in lists

Status: done
Depends on: T4

Add a Tiptap extension in `lib/tiptap/listKeymap.ts` and include it in the factory. Its `addKeyboardShortcuts` handles `Tab` and `Shift-Tab` with high priority:
- Tab: if the selection is in a `listItem` or `taskItem`, run `sinkListItem` for that type.
- Shift-Tab: run `liftListItem` only if the item is nested inside another list item. For a top-level item, do nothing.
- Always return true while the editor is focused, so a failed command (first bullet, plain text, a selection crossing the list's edge) never lets the browser move focus.

The stock "- " input rule, Enter and Backspace behaviour stay as they are. Make sure the handler doesn't affect other keyboard handling, such as the Ctrl/Cmd+K handler in `editorProps.handleKeyDown` or tldraw's shortcuts when the canvas text box isn't being edited.

Files: `lib/tiptap/listKeymap.ts` (new), `lib/tiptap/extensions.ts`

Acceptance:
- Tab indents and Shift+Tab outdents the list items touched by the cursor or a selection inside one list, for bullet, numbered and task lists.
- Tab and Shift+Tab never move focus out of the editor and never insert a tab character.
- Shift+Tab on a top-level list item leaves it unchanged.
- A dash alone at the start of a line doesn't start a list; "- " does.
- "1 " at the start of a line starts a numbered list, the same as "1. "; other numbers followed by a space (for example "3 ") don't.

Test steps:
1. In a canvas text box, type "- one", Enter, "two", Enter. On the new empty bullet press Tab: it becomes a sub-bullet. Type "three".
2. Press Shift+Tab: "three" moves back to the top level.
3. Select part of "two" and "three" together and press Tab: both indent under "one".
4. Put the cursor on "one" (the first bullet) and press Tab: nothing changes and you can keep typing in the text box.
5. Press Shift+Tab on "one": nothing changes and focus stays.
6. Press Enter on an empty nested bullet: it moves out one level. Press Enter on an empty top-level bullet: the list ends.
7. On a plain line, type "-x": it stays as text.
7a. On a plain line, type "1 " then "first": a numbered list starting at 1 appears. On another plain line, type "3 apples": it stays as text.
8. Repeat steps 1–4 in a sticky note. Delete all test text and close any sticky note you created.

### T6 Fix the Insert link dialog on the canvas

Status: done
Depends on: none

On a canvas text box, the Insert link dialog (`components/editor/LinkOrStickyDialog.tsx`, rendered inside the shape at the bottom of `RichTextShape.tsx`) leaves tldraw stuck in its Select tool. React events from the portalled dialog still bubble through the shape's React tree into tldraw's canvas handlers (`useCanvasEvents` on `.tl-canvas`), so a pointerdown in the dialog captures the pointer and ends text editing. The auto-return then gets suppressed (`shapesWithSuppressedReenter` in `RichTextTool.tsx`) and nothing switches back to the text tool.

Fix:
- Stop pointer, mouse and key events from the dialog's content and backdrop propagating through the React tree, for example with a wrapper that calls `stopPropagation` on `onPointerDown`, `onPointerUp`, `onMouseDown`, `onClick` and `onKeyDown`.
- Snapshot the editor selection `{from, to}` when the dialog opens and restore it before applying.
- When the dialog closes, return the shape to editing (or at least `switchToToolExplicitly(editor, "rich-text")`) so the canvas is never left in Select.
- If the selection is empty when a URL is inserted, insert the URL as linked text at the cursor.
- Once events no longer leak, remove the `makeHandlers` mousedown workaround and use plain `onClick`.

Leave the sticky-note sections working as they do now; T11 rebuilds the dialog.

Files: `components/editor/LinkOrStickyDialog.tsx`, `components/canvas/RichTextShape.tsx`, `components/canvas/RichTextTool.tsx`

Acceptance:
- Clicking anywhere in the dialog, its backdrop, Cancel or the close button doesn't end the text box's editing session or change tldraw's current tool.
- After the dialog closes, by any route, the canvas is in the rich-text tool: clicking empty canvas creates a text box and clicking a text box edits it.
- Inserting a URL with text selected links that text; with no selection, it inserts the URL as linked text.

Test steps:
1. Create a canvas text box, type "docs", select it, press Ctrl/Cmd+K, enter `https://example.com` and press Insert link: "docs" becomes a link and the text box is still being edited.
2. Click on empty canvas: a new text box is created (not stuck in Select).
3. In a text box with the cursor at the end, press Ctrl/Cmd+K, enter `https://example.org` and insert: the URL appears as linked text.
4. Open the dialog again and click its backdrop, then reopen and press Cancel: each time, clicking an existing text box enters editing.
5. Delete the text boxes you created.

### T7 Reference chips

Status: done
Depends on: T4

Add `lib/references/`:
- `format.ts`: a `Reference` type `{ kind: "notebook" | "folder" | "note" | "page" | "shape" | "sticky", id, pageId?, shapeId? }`, with `formatReference` / `parseReference` for the `skylines://<kind>/<id>` and `skylines://shape/<pageId>/<shapeId>` tokens.
- `resolve.ts`: `resolveReference(ref)` returns `{ exists, title, path: string[], previewText, previewImage }` by reading SQLite through `lib/db/*`. A shape is found in its page's `canvasData`; its title is `extractPlainText` of a rich-text shape's content, or the shape type. It must work in sticky windows too, which have no loaded store.

Add a Tiptap inline atom node `reference` (`lib/tiptap/reference.ts`) with attrs `{ kind, id, pageId, shapeId, label, lastTitle }`. It renders a chip through a React node view: "#" plus the last one or two path segments and the title for in-app items (for example "#Week 3 › Lecture notes"), and "%" plus the title for sticky notes. It uses `label` instead of the live title when set, stores the resolved title in `lastTitle`, and shows a struck-through chip with `lastTitle` when `exists` is false. It parses and serializes HTML via a `span[data-reference]`. Add a paste rule or `handlePaste`: plain text that is exactly one `skylines://` token (trimmed) becomes a `reference` node at the cursor, replacing any selection and using the selected text as `label`. Add it to the factory. Style the chip in `editor.css` (rounded, subtle background, theme colours) and replace the dead `a[href^="sticky:"]` chip styles. Clicking and hovering come in T9 and T10.

Files: `lib/references/format.ts` (new), `lib/references/resolve.ts` (new), `lib/tiptap/reference.ts` (new), `lib/tiptap/extensions.ts`, `components/editor/editor.css`

Acceptance:
- `parseReference(formatReference(r))` round-trips every kind, and `parseReference` returns null for anything else.
- Pasting exactly one token into any of the three editors inserts a chip; pasting other text behaves as before.
- Chips show "#" or "%" per kind with the live title or the fixed label, and a missing target renders struck through.
- The node survives a save and reload (it's part of the stored Tiptap JSON).

Test steps:
1. Create a note and page for testing. Find its note ID (from the URL `id=` or via `webview_execute_js`) and put `skylines://note/<id>` on the clipboard.
2. Paste it into a canvas text box: a "#…" chip with that note's title appears.
3. Rename the note in the sidebar: the chip's title updates (after re-render or reload).
4. Paste `skylines://sticky/<id>` for a test sticky note into another text box: a "%<title>" chip appears.
5. Paste `skylines://note/00000000-0000-0000-0000-000000000000`: a struck-through chip appears.
6. Reload the note: all chips are still there.
7. Delete the test note, text boxes and sticky note.

### T8 Copy reference from right-click menus

Status: done
Depends on: T7

Add a "Copy reference" item that writes the item's `formatReference` token to the OS clipboard with `writeText` from `@tauri-apps/plugin-clipboard-manager`. Add `clipboard-manager:allow-write-text` and `allow-read-text` to `default.json` and `sticky.json`. Put it:
- in the `menuItems()` of notebooks (wherever notebook items have a menu; add one following the `NoteItem` pattern if they don't), `FolderItem`, `NoteItem` and `PageItem`;
- in the sticky card menu in `StickyNotesHome.tsx` and the dot menu in `StickyNoteTopBar.tsx`;
- in tldraw's context menu for shapes, via `overrides` / `components.ContextMenu` with `DefaultContextMenuContent` in `components/canvas/CanvasEditor.tsx`, when exactly one shape is selected. It uses the current `selectedPageId` and the shape's ID.

Show brief confirmation (a toast if the app has one, otherwise the item's label changes to "Copied" for a moment, like the image editor's copy flash).

Files: `components/sidebar/FolderItem.tsx`, `components/sidebar/NoteItem.tsx`, `components/sidebar/PageItem.tsx`, the notebook list component, `components/sticky/StickyNotesHome.tsx`, `components/editor/StickyNoteTopBar.tsx`, `components/canvas/CanvasEditor.tsx`, `src-tauri/capabilities/default.json`, `src-tauri/capabilities/sticky.json`

Acceptance:
- Every listed menu has "Copy reference", and it puts the correct token on the clipboard.
- The canvas item appears only when exactly one shape is selected and includes the page ID.
- Pasting the copied token into a text box produces the matching chip (T7).

Test steps:
1. Right-click a test note in the sidebar › Copy reference, then paste into a canvas text box: a "#<note>" chip appears.
2. Right-click a page in the page sidebar › Copy reference and paste: a page chip appears.
3. Right-click a canvas text box (not editing) › Copy reference and paste into another text box: a chip with the first text box's text appears.
4. In Sticky notes, right-click a test sticky card › Copy reference and paste: a "%" chip appears.
5. Delete everything you created.

### T13 Reference chip cursor and double-click selection

Status: done
Depends on: T7

Added after T8 (user report). Two problems with the reference chip (`lib/tiptap/reference.ts`, `components/editor/ReferenceChip.tsx`, `.reference-chip` styles in `components/editor/editor.css`), in canvas text boxes and sticky notes:
- When a chip is the first thing on a line, double-clicking it doesn't select it. With text before it on the line, a double-click selects that text. Double-clicking a chip anywhere should select the whole chip (a `NodeSelection` on it), and a single click should behave as it does now. Don't add click-to-follow; that's T9.
- When a chip is the first thing on a line, the text cursor before it is drawn inside the chip's shaded background, just after its left edge, instead of just before the chip. This is a WebKit caret problem with `contenteditable="false"` inline nodes at a line's start. Fix it so the cursor before a chip is drawn outside the chip at every position: line start, mid-line and line end. Also check the cursor after a chip at the end of a line. Use the usual ProseMirror approaches, such as a zero-width spacer or separator before the chip in the node view, moving the chip's padding and background onto an inner element, or a `margin`-based layout, and pick whatever works in WebKit (macOS) without changing what's stored. The stored document and the chip's appearance must stay the same.

Files: `components/editor/ReferenceChip.tsx`, `lib/tiptap/reference.ts`, `components/editor/editor.css`

Acceptance:
- Double-clicking a chip selects that chip, whether or not there is text before it on the line.
- With a chip first on a line, the cursor placed before it (click to its left, Home, or arrow keys) is drawn outside the chip's background.
- The cursor can move across a chip with the arrow keys in both directions, and Backspace/Delete next to a chip remove it.
- Stored content for chips is unchanged (same `reference` node JSON), and chips look the same as before.

Test steps:
1. In a canvas text box, paste a reference token as the only thing on a line (copy one with right-click › Copy reference on a note in the sidebar). Double-click the chip: the whole chip is selected (selection outline).
2. Press Home (or click to the left of the chip): the cursor is drawn just before the chip, not inside its shaded area. Screenshot it zoomed in.
3. Type "x " before the chip, then double-click the chip: the chip is selected, not "x".
4. With the cursor just after the chip, press Left twice: the cursor moves before the chip. Press Delete: the chip is removed. Undo.
5. Repeat steps 1–2 in a sticky note.
6. Delete the test text box/note and sticky note.

### T14 Reliable Copy reference for text boxes

Status: done
Depends on: T8

Added after T8 (user report): right-clicking a canvas text box to get Copy reference is unreliable. T8 put "Copy reference" in tldraw's context menu (`CanvasContextMenu` in `components/canvas/CanvasEditor.tsx`). It only shows when exactly one shape is selected, and in the rich-text tool selection on right-click comes from the new `Idle.onRightClick` in `components/canvas/RichTextTool.tsx`. Right-clicking a text box that is being edited goes to the text instead (`RichTextShape.tsx` stops pointer events while editing).

First, reproduce right-clicking text boxes in their different states and record what goes wrong:
- not selected
- selected
- being edited
- another shape selected
- right-clicking the text itself versus the box's padding or edge
- a right-click straight after editing ends

Then make it work every time:
- Right-clicking any part of a text box that isn't being edited always selects just that box and shows "Copy reference".
- Right-clicking inside a text box that is being edited shows a menu with "Copy reference" for that box. This can be tldraw's menu, or a small custom menu if tldraw's can't open there. The editor's own selection and focus must stay as they are.

Also add a "Copy reference" button (a link icon, with "Copy reference" as its tooltip) to the text box's formatting bubble menu in `RichTextShape.tsx`. That gives a way that doesn't depend on right-click at all. It copies `skylines://shape/<pageId>/<shapeId>` for the box being edited, via `copyReference` in `lib/references/copy.ts`, and confirms with tldraw's toast like the context menu does.

Report the causes you found.

Files: `components/canvas/CanvasEditor.tsx`, `components/canvas/RichTextTool.tsx`, `components/canvas/RichTextShape.tsx`, `lib/references/copy.ts`

Acceptance:
- Right-clicking a non-editing text box, anywhere on it, selects only that box and shows "Copy reference", whatever was selected before.
- Right-clicking inside a text box being edited shows "Copy reference" for that box without ending editing or losing the text selection.
- The bubble menu has a Copy reference button that copies the box's shape reference and shows a confirmation.
- tldraw's other context menu behaviour (other shapes, multiple shapes, empty canvas) is unchanged.

Test steps:
1. Create two text boxes A and B with text. Select B. Right-click A on its text: only A is selected and the menu shows Copy reference. Use it and paste into B: a chip for A appears.
2. Right-click A near its edge or padding (not on text): same result.
3. Click into A to edit it, then right-click its text: a menu with Copy reference appears, A stays in editing, and the text selection is kept. Copy and paste into B: a chip for A appears.
4. While editing A, select some text so the bubble menu appears, and click its Copy reference button: a confirmation shows, and pasting into B gives a chip for A.
5. Finish editing A, then immediately right-click it: Copy reference shows.
6. Right-click empty canvas and a non-text shape: menus behave as before.
7. Delete the test text boxes and note.

### T9 Following references and web links

Status: todo
Depends on: T7

Add `lib/references/navigate.ts`, `followReference(ref)`, which runs in the main window:
- notebook: `setSelectedNotebook`, `router.push("/")`
- folder: the same, plus select and expand the folder
- note: `/canvas?id=`
- page: `/canvas?id=<noteId>&page=<pageId>`
- shape: like page, plus `&shape=<shapeId>`
- sticky: `openStickyNoteWindow`

In `CanvasEditor.tsx`, read the `page` and `shape` query params: select that page instead of the first one, and after `loadSnapshot` in `handleMount`, `select` the shape and zoom to its bounds (respecting `applyPageCameraConstraints`). From a sticky window, emit a Tauri event `reference:follow` with the token; the main window listens for it in `AppShell`, shows and focuses itself (expose the existing `show_main_window` as a command, or use window permissions), then calls `followReference`. A missing target shows a brief "Not found" message instead of navigating.

Click handling:
- In a canvas text box that isn't being edited, give reference chips and links `pointer-events: auto` and follow them on a plain click, stopping tldraw from receiving that pointerdown.
- While editing, and in the sticky and main editors, follow on Ctrl/Cmd+click.
- Replace `lib/tiptap/stickyLinkClick.ts` with this.

Web links: remove the duplicate Link by configuring the one bundled in StarterKit (`StarterKit.configure({ link: { openOnClick: false, ... } })`) in the factory, open http(s)/mailto links with the opener plugin's `openUrl` under the same click rules, add `opener:default` to `sticky.json`, and add a small "↗" after web links in `editor.css`.

Files: `lib/references/navigate.ts` (new), `lib/tiptap/reference.ts`, `lib/tiptap/extensions.ts`, `lib/tiptap/stickyLinkClick.ts` (remove), `components/canvas/CanvasEditor.tsx`, `components/canvas/RichTextShape.tsx`, `components/AppShell.tsx`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/sticky.json`, `components/editor/editor.css`

Acceptance:
- Each kind navigates as described, and a shape reference ends with that shape selected and in view on its page.
- In a non-editing canvas text box a plain click follows; while editing it takes Ctrl/Cmd+click. Clicks elsewhere on the text box behave as before.
- Following an in-app reference from a sticky window brings the main window forward and navigates it.
- Only one `link` extension is registered, web links open in the default browser, and they show "↗".

Test steps:
1. Create test note A with two pages. On page 2, make a text box "target", and copy its reference. In note B, paste it into a text box and click away so it isn't being edited.
2. Click the chip: note A opens on page 2 with "target" selected and in view.
3. In note B, enter the text box and plain-click the chip: the cursor/selection moves and nothing navigates. Ctrl/Cmd+click it: it navigates.
4. Paste a sticky note reference into a text box and click it (not editing): that sticky note's window opens.
5. In a sticky note, paste note A's reference and Ctrl/Cmd+click it: the main window comes forward showing note A.
6. Click a web link chip "↗" outside editing: the default browser opens (check the logs for the opener call, since the browser itself is out of reach).
7. Delete the test notes, text boxes and sticky note.

### T10 Hover previews

Status: todo
Depends on: T9

Show a preview card when the pointer rests about 400ms on a reference chip or web link, in all three editors and in non-editing canvas text boxes (chips are hoverable there after T9). Use Base UI's `PreviewCard` from `@base-ui/react` (add a wrapper in `components/ui/preview-card.tsx` following `tooltip.tsx`), or a single floating card driven by the node view if that's simpler inside tldraw. Content, from `resolveReference`: a kind label (Notebook, Folder, Note, Page, Text box, Sticky note), the path, the title in bold, and up to 3 lines of `previewText` (or `previewImage` as a thumbnail if there's no text). For a missing target it shows "Not found". For web links it shows the full URL. Resolve lazily on open and cache per card. The card mustn't steal focus or end text editing.

Files: `components/ui/preview-card.tsx` (new), `lib/tiptap/reference.ts`, `components/canvas/RichTextShape.tsx`, `components/editor/editor.css`

Acceptance:
- Hovering a chip or web link for about 400ms shows the card, and moving away hides it.
- The card shows kind, path, title and up to 3 lines of preview (or an image), "Not found" for missing targets, and the URL for web links.
- Showing the card doesn't change focus, selection or the tldraw tool.

Test steps:
1. In a test note, paste a reference to a text box that contains several lines, and click away.
2. Hover the chip: after a moment a card shows "Text box", the note › page path, and the first lines of its text.
3. Hover a web link: the card shows its URL.
4. Hover a reference to a deleted item: the card says "Not found".
5. While editing a text box, hover a chip, then keep typing: text still goes into the text box.
6. Clean up.

### T15 References to images

Status: todo
Depends on: T9, T10

Added after T8 (user request). There are two kinds of pasted image:
- **Canvas image shapes.** Pasting an image onto the canvas while not editing goes through tldraw's default paste and makes an `image` shape with an asset record in the page snapshot. These can already be copied as a `shape` reference (T8), but `resolveReference` (`lib/references/resolve.ts`) titles them with the raw shape type and gives no `previewImage`.
- **Images inside text.** Images pasted into a text box or sticky note while editing, or inserted with the Ribbon's image button (`Ribbon.tsx`, `setImage`), are Tiptap `image` nodes with a base64 `src` and no id, so they can't be referenced.

Make both work:
1. **Canvas image shapes.** For a `shape` reference to an `image` shape, resolve the title as "Image" (or the asset's `name` if it has a meaningful one), and set `previewImage` from the asset's `src` (look up the shape's `props.assetId` in the snapshot's asset records). The chip, hover card (T10) and following (T9, select and zoom) then work as for other shapes.
2. **Images inside text.**
   - **Ids:** give the Tiptap image node a stable `id` attribute, kept in the HTML as `data-image-id`, through the shared factory (`lib/tiptap/extensions.ts`, by extending `Image`). An `appendTransaction` plugin assigns `crypto.randomUUID()` to any image node without one, including existing images the next time that editor changes. A pasted image whose id already exists in the same document gets a new one.
   - **Reference kind:** add a reference kind `image` to `lib/references/format.ts`: `skylines://image/shape/<pageId>/<shapeId>/<imageId>` for an image in a canvas text box, and `skylines://image/sticky/<stickyId>/<imageId>` for one in a sticky note. Keep `parseReference` strict and update the round-trip check.
   - **Resolving:** `resolveReference` finds the image inside its container's content. Title "Image", path = the container's path plus its title, `previewImage` = the image `src`. If the image is gone, `exists` is false.
   - **Chip prefix:** "#" when the container is in the notebook, "%" when it's a sticky note.
   - **Following** (`lib/references/navigate.ts`): follow the container (open the note on its page and select and zoom to the text box, or open the sticky window), then scroll the image into view and briefly highlight it.
   - **Copying:** right-clicking an image inside a text box or sticky note while editing shows a small menu with "Copy reference". Also add a Copy reference button to the bubble menu when an image node is selected. Both use `copyReference` (`lib/references/copy.ts`) and confirm like T8/T14 do.
3. **Picker.** If T11 is already done, list images under their text box in its tree. Otherwise T11 picks this up.

Files: `lib/references/format.ts`, `lib/references/resolve.ts`, `lib/references/navigate.ts`, `lib/tiptap/extensions.ts`, `lib/tiptap/imageId.ts` (new), `components/editor/ReferenceChip.tsx`, `components/canvas/RichTextShape.tsx`, `components/editor/StickyNoteEditor.tsx`

Acceptance:
- A reference to a canvas image shape shows a chip titled "Image" (or the asset name), its hover card shows the picture, and following it selects and zooms to the image.
- Every image node inside text has a unique `id`, assigned automatically, and stored in the content.
- Images inside canvas text boxes and sticky notes can be copied as `image` references from a right-click menu and from the bubble menu. Pasting one gives a chip, hovering shows the picture, and clicking opens the container and scrolls to and highlights the image.
- `parseReference(formatReference(r))` round-trips both `image` forms, and malformed image tokens return null.
- A deleted image's chip shows as missing.

Test steps:
1. Paste an image onto empty canvas (not editing) so it becomes an image shape. Right-click it › Copy reference, and paste into a text box: a chip "#… › Image" appears. Hover it: the card shows the picture. Click it from another page: you land on the image, selected.
2. Edit a text box, paste an image into its text, right-click the image › Copy reference. Paste into another text box: a chip appears. Hover it: the picture shows.
3. Click that chip (not editing): the note opens on that page, the text box is selected, and the image is scrolled into view and highlighted.
4. Select the image in the text so the bubble menu shows its Copy reference button. Use it and paste: the same chip.
5. In a sticky note, paste an image and copy its reference. Paste it into a canvas text box: a "%… › Image" chip. Click it: the sticky window opens with the image in view.
6. Delete the image from the text box: its chip shows as missing.
7. Delete all test notes, text boxes, images and the sticky note.

### T11 Insert link dialog: tree, paste box and references

Status: todo
Depends on: T6, T7

Rebuild `LinkOrStickyDialog.tsx` (rename it to `InsertLinkDialog.tsx`) on top of T6's event and selection handling. Sections:
1. URL field: Insert link, as today.
2. "Paste a reference" field: accepts a `skylines://` token and inserts it as a chip on Enter or a button press. Invalid input shows an inline error.
3. A searchable tree, in a new read-only component (for example `components/editor/ReferencePicker.tsx`; don't reuse the sidebar's `FolderTree`, which is tied to routing, drag and menus). It shows notebooks › folders › notes › pages › text boxes, built from the store's notebooks, folders and notes. It lazy-loads pages with `getPages(noteId)` and text boxes from each page's `canvasData` when expanded, uses the `FolderTree.tsx` sort and filter, and uses `components/ui/collapsible.tsx`. Search filters by title across loaded items. Picking any row inserts that reference.
4. Sticky notes: the existing list with search and the preview toggle, inserting `sticky` references.
5. Create new sticky note: create it, open its window, insert its reference.

Inserting a reference replaces the saved selection with a `reference` node, using the selected text as `label` if there was any. Point the Ribbon Format tab's link action (`components/ribbon/Ribbon.tsx`, which uses `window.prompt` today) at this dialog, for example through a store flag that the active editor (`activeEditor`) listens to. Remove the dialog's dead `sticky:` href code.

Files: `components/editor/InsertLinkDialog.tsx` (renamed), `components/editor/ReferencePicker.tsx` (new), `components/editor/RichTextEditor.tsx`, `components/canvas/RichTextShape.tsx`, `components/ribbon/Ribbon.tsx`, `stores/appStore.ts`

Acceptance:
- The dialog has the URL field, the paste-reference field, the tree, the sticky list and Create new sticky note, and each inserts the right thing at the saved selection.
- The tree lazy-loads pages and text boxes, and search filters it.
- The Ribbon's link button opens this dialog for the active editor; `window.prompt` is gone.
- After any insert or cancel on the canvas, the canvas is still in the text tool (T6 still holds).

Test steps:
1. Create a test note with a page containing a text box "alpha". In another text box, press Ctrl/Cmd+K.
2. In the tree, expand down to the "alpha" text box and pick it: a chip for it is inserted and the dialog closes.
3. Reopen the dialog, type "alpha" in the search: the matching row shows.
4. Copy a note's reference from the sidebar, open the dialog and paste it into the reference field: a chip is inserted.
5. Type "nonsense" into the reference field and submit: an inline error shows and nothing is inserted.
6. Select some text, open the dialog from the Ribbon's Format tab link button and pick a note: the chip shows the selected text as its label.
7. Use Create new sticky note: a sticky window opens and a "%Untitled" chip is inserted. Close that window.
8. Click empty canvas: a new text box is created. Delete everything you created.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Collapsed sticky notes keep their top bar buttons
- [x] T2 Live sticky note previews on the home page
- [x] T12 Deleted sticky note windows can be closed
- [x] T3 Sticky windows get their own taskbar group, icon and title
- [x] T4 Shared editor extensions and visible lists
- [x] T5 Tab and Shift+Tab in lists
- [x] T6 Fix the Insert link dialog on the canvas
- [x] T7 Reference chips
- [x] T8 Copy reference from right-click menus
- [x] T13 Reference chip cursor and double-click selection
- [x] T14 Reliable Copy reference for text boxes
