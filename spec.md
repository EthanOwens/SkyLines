# Canvas edge, sticky note window fixes, clearer theme editor

Source: planning.md, 2026-10-09

## Goal

Fix three rough edges. Remove the white frame around the note canvas. Make sticky note windows draggable by their top bar, and make double-click restore a collapsed note again. Make the theme editor self-explanatory: plain-language names with short descriptions, a preview element for every setting, and highlighting of where a setting is used when you hover it.

## Context

- Tauri v2 app (Rust in `src-tauri/`) around a Next.js static export. Pop-out windows are created at runtime: sticky notes by `lib/stickyWindow.ts` (label `sticky-<id>`, `decorations: false`) and the image editor by `lib/imageEditorWindow.ts` (label `image-editor-<id>`). Each label pattern has its own capability file in `src-tauri/capabilities/` (`sticky.json`, `image-editor.json`); `default.json` covers only `main`. A window can only call Tauri commands its capability grants.
- Tauri APIs (`@tauri-apps/api/window` etc.) are imported dynamically inside handlers and effects, because no Tauri runtime exists during the static export build. Follow that pattern.
- Installed Tauri is 2.11.5. In its injected drag script, a bare `data-tauri-drag-region` only drags when the clicked element itself carries the attribute, and on double-click it calls `internal_toggle_maximize` (a no-op here, since these windows aren't maximizable).
- tldraw always runs in its light theme in this app (themes are applied as inline CSS variables on `<html>`; nothing toggles `.dark`). `app/globals.css` already rebinds tldraw's `--tl-color-background` to the app's `--background` under `.canvas-editor-container .tl-container.tl-theme__light/dark`.
- Theme variable keys (`lib/themes/types.ts`) are CSS variable names stored in users' theme files on disk. Never rename a key; only change what the editor displays.

## Decisions

- Canvas: remove only tldraw's focus outline. The themed line under the page title stays, and tldraw's other light-only colors are left alone.
- Window dragging is handled by the app instead of `data-tauri-drag-region`: a native drag starts only once the mouse has moved a few pixels while held down. A click or double-click without movement never starts a drag, so double-click to collapse/restore keeps working on macOS, where a native drag swallows the mouse-up.
- The image editor's title bar has the same drag bug and gets the same fix.
- Sticky windows also get `core:window:allow-minimize`, which the existing Minimize button needs and currently lacks.
- Sticky windows get `acceptFirstMouse: true`, so the first click on an unfocused note reaches the page instead of only focusing the window.
- Theme editor names use the plain-language set below, each with a one-line description. Hovering (or focusing) a setting outlines the preview elements that use it.
- `sidebar-primary` isn't used anywhere in the app outside the preview. It keeps its row, with a description saying so.

## Out of scope

- Mapping tldraw's other light-only colors (menus, panels, dividers) to the app theme.
- Removing the border under the canvas page title.
- Renaming theme variable keys or changing saved theme files.
- Changes to the sticky note bottom bar or the image editor's tools.

## Tasks

### T1 Remove the white focus outline around the canvas

Status: done
Depends on: none

tldraw adds `.tl-container__focused` whenever the canvas has focus, and tldraw.css draws `outline: 1px solid var(--tl-color-low)` on it. `--tl-color-low` comes from tldraw's light theme (near-white), so in dark app themes the canvas gets a white frame. In `app/globals.css`, next to the existing `--tl-color-background` rule, add a rule scoped under `.canvas-editor-container` that removes the outline from the focused container. Use at least three classes in the selector so it outranks tldraw's single-class rule regardless of import order, as the existing rule does.

Files: `app/globals.css`

Acceptance:
- A rule in `app/globals.css` scoped to `.canvas-editor-container` sets `outline: none` on `.tl-container.tl-container__focused`.
- No other tldraw variables or app borders change.

Test steps:
1. With a dark theme active (Dark or Gruvbox in the account menu), open any canvas note and click on the canvas.
2. No white or light 1px frame appears around the canvas area; the canvas edge blends into the background.
3. Click into the page title input, then back onto the canvas: nothing appears or disappears at the canvas edge.

### T2 Drag pop-out windows by their title bars

Status: todo
Depends on: none

Dragging a sticky note's top bar doesn't move the window, for two reasons: `src-tauri/capabilities/sticky.json` lacks `core:window:allow-start-dragging`, and the bar's bare `data-tauri-drag-region` only reacts when the click lands on the bar element itself, while the title span and buttons cover most of it. The image editor's header (`components/editor/ImageEditor.tsx`, the row with `data-tauri-drag-region`) has the same two problems.

Add a small shared hook (for example `hooks/useWindowDrag.ts`) that returns mouse handlers for a title bar. On a primary-button mousedown whose target isn't interactive (button, input, link, `[role=button]`, or inside one), record the point. On mousemove with the button still held and more than about 4px of movement, call `getCurrentWindow().startDragging()` once (dynamic import), then stop tracking. Stop tracking on mouseup. Use it on the root of `components/editor/StickyNoteTopBar.tsx` and on the image editor header, and remove `data-tauri-drag-region` from both, so Tauri's own drag script no longer handles them.

Add `core:window:allow-start-dragging` to `sticky.json` and `image-editor.json`, and `core:window:allow-minimize` to `sticky.json`.

Files: `hooks/useWindowDrag.ts` (new), `components/editor/StickyNoteTopBar.tsx`, `components/editor/ImageEditor.tsx`, `src-tauri/capabilities/sticky.json`, `src-tauri/capabilities/image-editor.json`

Acceptance:
- `sticky.json` grants `core:window:allow-start-dragging` and `core:window:allow-minimize`; `image-editor.json` grants `core:window:allow-start-dragging`.
- Neither title bar uses `data-tauri-drag-region`.
- Both title bars use the shared hook. A mousedown on a button or input never starts a drag, and a click or double-click without movement never calls `startDragging`.
- The sticky top bar's existing `onDoubleClick` (collapse toggle) and its buttons (Pin, menu, Minimize, Close) still work.

Test steps:
1. Open a sticky note window. Press on the title text in its top bar and drag: the window follows the mouse.
2. Drag from empty space in the top bar: the window moves.
3. Click Pin, the menu button and Minimize: each does its job and the window doesn't move.
4. Double-click the top bar without moving the mouse: the note collapses, as before.
5. Open an image in the image editor (double-click an image in a note) and drag its header by the title: the window moves; Save and Close still work.

### T3 Double-click restores a collapsed sticky note

Status: todo
Depends on: T2

Double-clicking a sticky note's top bar collapses the window to `COLLAPSED_HEIGHT`, but double-clicking again doesn't restore it. In `components/editor/StickyNoteEditor.tsx`, `toggleCollapsed` saves the current size into `originalSizeRef` and calls `setSize`, and the `onResized` listener records user resizes into `originalSizeRef` unless `collapsedRef.current` is true. But `collapsedRef` is only updated in an effect after React commits, so the collapse resize event can arrive first and overwrite `originalSizeRef` with the collapsed size. Restoring then "restores" to 48px.

Set `collapsedRef.current` synchronously inside `toggleCollapsed`: true before shrinking, and on restore keep it true until the restore `setSize` has resolved, then false. Also have the `onResized` listener ignore any size whose logical height is at or below `COLLAPSED_HEIGHT`. In `lib/stickyWindow.ts`, add `acceptFirstMouse: true` to the `WebviewWindow` options so a double-click on an unfocused note isn't half-swallowed by window activation.

Files: `components/editor/StickyNoteEditor.tsx`, `lib/stickyWindow.ts`

Acceptance:
- `toggleCollapsed` sets `collapsedRef.current` itself before each `setSize` call, and clears it only after the restore `setSize` completes.
- The `onResized` listener never stores a height at or below `COLLAPSED_HEIGHT` in `originalSizeRef`.
- `openStickyNoteWindow` passes `acceptFirstMouse: true`.

Test steps:
1. Open a sticky note and resize it to something distinctive (for example noticeably taller than default).
2. Double-click the top bar: the window collapses to just the top bar.
3. Double-click the top bar again: the window returns to the exact size from step 1, and the editor and bottom bar are visible.
4. Collapse it again, click on another window so the note loses focus, then double-click the collapsed note's bar: it restores.
5. Repeat collapse and restore three times: the size is the same every time.

### T4 Plain-language names and descriptions in the theme editor

Status: todo
Depends on: none

`components/theme/ThemeEditor.tsx` builds row labels with `labelForKey` (kebab-case to Title Case) and groups them in `THEME_VARIABLE_GROUPS`. Replace `labelForKey` with an explicit map from each listed key to a display name and a one-line description, rename the groups, and show the description under each row's name, in small muted text. Rows are rendered by `components/theme/ThemeColorField.tsx` (color keys) and inline in ThemeEditor (the `radius` row); give ThemeColorField a `description` prop. Keep the `keys` arrays and their order unchanged.

Names and descriptions:

| Group | Key | Name | Description |
|---|---|---|---|
| Page | background | Background | Main background behind notes and the canvas |
| Page | foreground | Text | Default text color |
| Cards & text boxes | card | Card background | Background of cards, such as sticky note previews |
| Cards & text boxes | card-foreground | Card text | Text on cards |
| Accent | primary | Accent color | Buttons, selected items and other highlights |
| Borders | border | Border | Borders and dividing lines |
| Corners | radius | Corner rounding | How rounded corners are |
| Sidebar | sidebar | Sidebar background | Background of the sidebars |
| Sidebar | sidebar-foreground | Sidebar text | Text in the sidebars |
| Sidebar | sidebar-primary | Sidebar highlight | Shown in the preview; not used by the app yet |
| Sidebar | sidebar-accent | Sidebar hover | Hovered and selected items in the sidebars |
| Sidebar | sidebar-border | Sidebar border | Edges and dividers in the sidebars |

Files: `components/theme/ThemeEditor.tsx`, `components/theme/ThemeColorField.tsx`

Acceptance:
- `labelForKey` no longer exists; every key in `THEME_VARIABLE_GROUPS` has a name and description from the table above, and the word "Foreground" appears nowhere in the editor UI.
- Group headers read Page, Cards & text boxes, Accent, Borders, Corners, Sidebar.
- The `keys` arrays (and so the saved theme format) are unchanged.

Test steps:
1. Open the account menu and choose "Edit themes...".
2. The right sidebar shows the groups and names from the table, each with its description underneath; no setting is called "Foreground".
3. Change a color (for example Text) and save: the theme saves and applies as before.

### T5 Preview elements for Text and Sidebar text

Status: todo
Depends on: none

In `components/theme/ThemePreview.tsx`, two settings have no visible effect. `foreground` is set as the root's `color`, but every text-bearing child overrides it, so no text uses it. `sidebar-foreground` is set on the mock sidebar strip, which contains only two colored bars and no text. Add a short line of plain text directly on the preview background (for example "Notes look like this") that inherits `var(--foreground)`. In the mock sidebar strip, add small text labels (for example a heading and item names next to or on the existing bars) colored with `var(--sidebar-foreground)`, without changing what the existing bars demonstrate (`sidebar-primary`, `sidebar-accent`). Keep using `var(--...)` directly; Tailwind color utilities resolve against `:root`, not this scoped preview.

Files: `components/theme/ThemePreview.tsx`

Acceptance:
- Some visible preview text uses `var(--foreground)` and isn't covered by a child color override.
- The sidebar strip shows text colored by `var(--sidebar-foreground)`.
- Every key listed in `THEME_VARIABLE_GROUPS` now has at least one visible preview element.

Test steps:
1. Open the theme editor.
2. Change Text (foreground) to a bright color such as red: a line of text on the preview background turns red.
3. Change Sidebar text to a bright color: the text in the preview's sidebar strip changes; the sidebar bars keep their own colors.

### T6 Hovering a setting highlights it in the preview

Status: todo
Depends on: T4, T5

Add `hoveredKey` state (`ThemeVariableKey | null`) to `ThemeEditor.tsx`. Set it on mouse enter and focus of each setting row (the root div in `ThemeColorField.tsx` and the `radius` row's wrapper in ThemeEditor), and clear it on leave and blur. Keep it set while that row's color picker popup is open, so the highlight doesn't flicker as the mouse moves into the popup. Pass `hoveredKey` to `ThemePreview`, which maps each key to the elements that use it and draws a clear highlight on them. The preview root has `overflow-hidden` and some elements sit flush at its edges, so use an inset ring or a negative outline offset, which won't be clipped.

Key to element mapping (from the current preview): background, foreground, border and radius map to the preview root (foreground also to the T5 text line); card to the mock card and the text box; card-foreground to the card's text and the text box input; primary to the text box's drag handle; sidebar and sidebar-border to the sidebar strip; sidebar-foreground to the T5 sidebar text; sidebar-primary and sidebar-accent to their bars.

Files: `components/theme/ThemeEditor.tsx`, `components/theme/ThemeColorField.tsx`, `components/theme/ThemePreview.tsx`

Acceptance:
- `ThemePreview` accepts an optional `hoveredKey` and highlights exactly the elements mapped to that key, with nothing highlighted when it's null.
- Every key in `THEME_VARIABLE_GROUPS` maps to at least one element.
- Hover and keyboard focus on a row both set the highlight; leaving or blurring clears it, except while that row's picker popup is open.
- Highlights aren't clipped at the preview's edges.

Test steps:
1. Open the theme editor and hover "Card background": the mock card and the movable text box are outlined in the preview, and nothing else.
2. Hover "Sidebar text": only the sidebar strip's text is outlined.
3. Hover "Accent color": the text box's handle bar is outlined.
4. Move the mouse off the settings list: no highlight remains.
5. Open the color picker on "Text" and move into the picker: the Text highlight stays until the picker closes.

## Progress

<!-- /dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Remove the white focus outline around the canvas
