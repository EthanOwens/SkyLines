# Skylines — Canvas polish, sidebar management, theming, and Pages

## Goal

A broad batch of UI/UX improvements to the free-form canvas notes shipped in
the prior spec, plus two structural additions: full drag-and-drop + cut/
copy/paste sidebar management, and a new **Page** sub-entity underneath
Note — a single note ("notesheet") can now contain multiple independent
canvas pages, each with its own content, switchable via a dedicated page
sidebar (mirroring OneNote's actual Section→Page structure one level
deeper than this app currently goes).

Also included: several theming changes (a new off-white theme, removing
tldraw's built-in opacity slider, a "System" theme that follows the OS
light/dark preference), and two bug fixes (canvas background not following
the active theme; getting stuck in a tldraw drawing tool with no way back
to the click-to-create text tool).

## Non-Goals

- **Don't rebuild `RichTextShape`'s core Tiptap-hosting mechanism**
  (subtask 1 of the prior spec — the custom tldraw `ShapeUtil`, its
  pointer-event drag-vs-edit handling, empty-shape auto-delete, focus
  wiring). This spec only changes its visual styling and click-to-cursor
  behavior, not its underlying architecture.
- **Don't touch the sync engine's core LWW/conflict-resolution logic**
  (`lib/sync/push.ts`/`pull.ts`/`cleanup.ts`) — the new `pages` table gets
  wired into it using the exact same established pattern already used for
  notebooks/folders/notes, not new sync design.
- **Don't change back/forward history to track at the Page level.** See Key
  Decisions — switching pages within an open note stays a local,
  note-scoped concern, not a global navigation event. `NoteHistoryEntry`
  and the back/forward stack built in the prior spec are untouched.
- **Don't remove or repurpose `notes.content`/`notes.canvas_data`
  columns.** Once the Pages migration wraps a note's existing content into
  its first page, these columns become vestigial (same as `notes.content`
  became after the prior spec's note/canvas merge) but are left in place,
  untouched, non-destructively — matching this project's established
  migration precedent.
- **Don't touch notebook-level CRUD, auth, the ribbon's File tab, quick-access
  bar, undo/redo focus logic, or the theme engine's loader/apply
  foundation** (`lib/themes/{types,loader,apply}.ts`) beyond adding one new
  built-in theme and a "System" special case — the engine itself is already
  built and working.
- **Don't modify `../note_taking_app`.**

## Subtasks

Organized into milestones by dependency — sidebar drag-and-drop and the
context-menu/clipboard mechanism (M4) are built generically enough that the
new Page sidebar (M6) reuses them directly, so M4 comes well before M6.

### M1 — Text box visual/interaction polish

1. **`RichTextShape` visual redesign.** Transparent background by default
   (no visible fill/border when idle). On hover OR while editing: show a
   dotted border around the shape, plus a thin drag-handle bar along the
   top edge (dragging that bar moves the shape — tldraw's own shape-drag
   mechanics already handle the actual move once pointer events reach the
   canvas correctly positioned; this subtask only needs to render the bar
   and route drag gestures on it through tldraw's normal shape-translate
   behavior, not build new drag physics).
2. **Click-to-cursor, no double-click required.** Clicking directly on a
   line of text inside a `RichTextShape` should place the text cursor at
   that exact point and enter edit mode immediately — no double-click.
   Requires reworking `RichTextShape`'s `canEdit()`/edit-mode-entry (from
   the prior spec, currently keyed to tldraw's own default double-click
   only) to also enter edit mode on a single click, while a genuinely EMPTY
   area of canvas still needs the click-to-CREATE-a-new-shape behavior
   (`RichTextTool`, subtask 2 below) — these two must not conflict for a
   click that lands on an existing shape's text vs. one that lands on
   empty canvas.
3. **Click vs. click-drag distinction in `RichTextTool`.** Currently every
   pointer-down on empty canvas immediately creates a shape
   (`components/canvas/RichTextTool.tsx`'s `Idle.onPointerDown`). Rework
   so: a plain click (pointer down, minimal movement, pointer up) still
   creates a shape as today; a click-and-drag (pointer down, then real
   movement before release) instead performs a marquee/rubber-band
   selection over whatever's under the drag area (text boxes, ink strokes,
   any shape) — mirror tldraw's own Select tool's click-vs-drag state
   machine (`Idle` → a `Pointing`-style intermediate state that watches
   drag distance → transitions to either "create" or tldraw's own
   brush/marquee-select behavior) rather than inventing a new one.

### M2 — Draw tab rebuild (bug fix + real functionality)

4. **Rebuild the Draw tab into the sole tool-switcher; fix the "stuck in
   drawing mode" bug.** Currently tldraw's own native bottom toolbar
   (Select/Draw/Eraser/shapes/etc., enabled by default alongside the
   custom `rich-text` tool) is fully visible, and switching to one of
   tldraw's own tools via it has no ribbon-level way back to the
   click-to-create text tool. Hide tldraw's own native toolbar
   entirely (`<Tldraw>`'s `hideUi`/`components` override — verify the
   exact current API against the installed tldraw version). Build real
   pencil/shape/eraser buttons into the ribbon's Draw tab
   (`components/ribbon/Ribbon.tsx`) that call `editor.setCurrentTool(...)`
   for tldraw's real built-in tools. Switching to the File or Format tab
   (or a dedicated "back to text" button in the Draw tab itself) always
   returns the canvas to the `rich-text` tool. The Draw tab itself should
   only ever be reachable/relevant on a note that's open (matches existing
   Draw-tab-only-when-canvas-open gating from the prior spec, now simply
   "the canvas is always open" since notes and canvases are merged).

### M3 — Format tab & bubble menu improvements

5. **Format tab: show disabled controls instead of hiding them.**
   `components/ribbon/Ribbon.tsx`'s `FormatTab` currently renders a plain
   "No formatting available." message and hides every control when
   `activeEditor` is null. Change it to always render the full control set
   (bold/italic/headings/lists/font/color/etc.), with every control
   disabled (grayed out, non-interactive) when there's no focused text box
   to apply them to, and enabled/interactive/reflecting real state exactly
   as today once a shape is focused.
6. **Bubble menu: add font family, font size, highlight, text color,
   bullet/numbered toggles.** Currently
   `components/canvas/RichTextShape.tsx`'s bubble menu
   (`BUBBLE_MENU_ACTION_IDS`) only has bold/italic/strike/code plus a
   separate link button. Add: font family select, font size select (reuse
   `formatActions.ts`'s existing constants/logic where possible, same as
   the Format tab already does), a highlight toggle + color swatch picker
   (new `@tiptap/extension-highlight` dependency — not currently
   installed), a text color swatch picker (reuse the Format tab's existing
   color-swatch pattern), and bullet-list/numbered-list toggle buttons.
   Keep the popover reasonably compact given it renders over a small
   shape (subtask 4 of the prior spec already handles portaling it to
   `document.body` to avoid clipping — build on that, don't rebuild it).

### M4 — Sidebar drag-and-drop + context menu (cut/copy/paste)

7. **Drag-and-drop reordering in the sidebar.** Notes and folders in
   `components/sidebar/{FolderTree,FolderItem,NoteItem}.tsx` become
   draggable: reorder siblings, drag a note into a different folder, drag
   a folder into a different folder (re-parenting), matching standard
   file-explorer drag-and-drop conventions (drop indicator between items
   for reordering, drop-onto-a-folder highlight for moving inside it).
   Persist the result via the existing `updateFolder`/`updateNote`
   functions (`parentId`/`folderId`/`order` fields already exist — this is
   UI + drop-target logic, not new data-layer work, unless ordering
   persistence needs a dedicated `order` field bump you discover is
   missing).
8. **Right-click context menu with delete/rename/cut/copy/paste.** Add a
   real `onContextMenu`-triggered menu (not just the existing "···"
   dropdown-button trigger — both should keep working, this is an
   additional entry point) to `FolderItem.tsx`/`NoteItem.tsx`, with
   Delete/Rename (already exist, wire into this menu too) plus new
   Cut/Copy/Paste: a small in-app clipboard (e.g. a
   `stores/appStore.ts` field or a dedicated tiny module, holding
   `{ kind: "cut" | "copy", type: "note" | "folder", id: string }` or
   similar) that "Cut"/"Copy" populate, and a "Paste" menu item that only
   appears on a folder's (or the notebook root's) context menu when the
   clipboard is non-empty — pasting a Cut moves the item (update its
   `parentId`/`folderId`), pasting a Copy duplicates it (a real new
   row/id, recursively duplicating a folder's contents if a folder was
   copied). Build this as a genuinely reusable mechanism (not
   folder/note-specific internals baked into the UI components) since M6's
   new Page sidebar needs the identical cut/copy/paste/delete/rename
   affordances for pages.

### M5 — Theming

9. **New "Off-white" built-in theme.** Add a fourth entry to
   `lib/themes/builtin.ts`'s `BUILTIN_THEMES`, using soft, varying shades
   of gray/cream/beige (not a single flat off-white — real tonal
   variation across the palette's background/card/popover/sidebar/etc.
   slots, mirroring how `GRUVBOX_DARK_THEME` varies its own tones rather
   than reusing one color everywhere). Cover all 30 `ThemeVariableKey`s,
   same as every other built-in theme.
10. **Remove tldraw's built-in opacity slider.** tldraw's own default style
    panel (shown when a shape is selected) includes a built-in
    transparency/opacity slider — remove or hide just that control (not
    the whole style panel) via tldraw's `components`/`overrides` UI
    customization API (verify the exact current mechanism against the
    installed tldraw version's actual API surface — this needs precision,
    don't guess at a component name).
11. **Rename "Default" theme to "System"; make it follow the OS light/dark
    preference.** `components/topbar/AccountMenu.tsx`'s
    `DEFAULT_THEME_VALUE`/"Default" radio option becomes "System": instead
    of just clearing theme overrides (today's behavior), it should apply
    `LIGHT_THEME` or `DARK_THEME` (`lib/themes/builtin.ts`) based on the
    OS's current preference (`window.matchMedia("(prefers-color-scheme:
    dark)")` — no existing OS-theme-detection code exists anywhere in this
    codebase, confirmed via search, so this is new), and stay dynamically
    in sync if the OS preference changes while the app is running
    (a `matchMedia` change listener, not a one-time read at launch).
12. **Bug fix: canvas background doesn't follow the active theme.**
    tldraw's own canvas background is currently left entirely at tldraw's
    shipped default (a light/white value from `tldraw.css`, imported
    unmodified in `components/canvas/CanvasEditor.tsx`) — it never reads
    this app's own theme CSS variables, so it stays white regardless of
    which theme (including Dark/Gruvbox Dark) is active. Wire tldraw's own
    background CSS custom property to this app's `--background`/`--card`
    theme variables (verify tldraw's exact variable name/override
    mechanism against its actual shipped CSS, don't guess).

### M6 — Pages (new sub-entity under Note)

A real new structural entity: a Note ("notesheet") becomes a lightweight
container that groups one or more **Pages**, each an independent canvas
(its own `RichTextShape`s, ink, etc.) — the actual editable content moves
down one level, from Note to Page.

13. **`pages` SQLite schema + `Page` type.** A new migration (next version
    after whatever's currently latest in `src-tauri/src/lib.rs`) adding a
    `pages` table mirroring `notebooks`/`folders`/`notes`' exact
    sync-bookkeeping column shape (`id`, `note_id` FK, `title`,
    `order_index`, `canvas_data`, `created_at`, `updated_at`,
    `deleted_at`, `dirty`, `synced_at`). Add a `Page` type to
    `types/index.ts` mirroring `Note`'s shape (minus the notebook/folder
    fields, plus `noteId`).
14. **`lib/db/pages.ts` data-access layer.** CRUD + soft-delete, mirroring
    `lib/db/notes.ts`'s exact pattern (`getPages(noteId)`,
    `createPage(noteId, title?, order?)`, `updatePage`, `deletePage`,
    `getDirtyPages`, `markPageSynced`, `upsertPageFromRemote` +
    `RemotePageData` type, tombstone helpers). Update note-creation
    (`lib/db/notes.ts`'s `createNote` or its callers) so a newly-created
    note ALWAYS gets a default first page atomically — a note with zero
    pages should never be a reachable state.
15. **Pages sync (push/pull/cleanup).** Extend
    `lib/sync/{push,pull,cleanup}.ts` to cover the `pages` table using the
    exact same LWW/conflict-backup/tombstone patterns already proven for
    notebooks/folders/notes/(now) pages — a fourth application of an
    already-established pattern, not new sync design.
16. **Rewire the canvas editor to operate on a Page, not a Note.**
    `/canvas?id=...` keeps navigating by NOTE id (see Key Decisions below —
    back/forward history stays note-scoped). `CanvasEditor.tsx` gains a
    concept of "the note's pages" + "the currently selected page" (default:
    the first page, or a remembered last-open page for that note —
    session/local state, not part of the global back/forward stack) and
    renders/saves the SELECTED PAGE's `canvasData`, not the note's own.
17. **Page sidebar.** A new, dedicated sidebar (distinct from the
    notebook/folder tree sidebar) that appears once a note is open, listing
    that note's pages: an "Add Page" button at the top, a collapse button,
    and the same drag-and-drop reordering + right-click
    cut/copy/paste/rename/delete context menu built in M4 (reused, not
    reimplemented).
18. **Migrate existing notes' content into a first Page.** Any note whose
    `canvas_data`/`content` already has real data (from the prior spec's
    note/canvas merge, including its own lazy migration path) gets that
    content wrapped into a newly-created single Page the first time the
    note is opened after this ships — mirroring the prior spec's exact
    lazy-migration approach (and its hard-won idempotency lesson: the
    guard must check live state, e.g. "does this note already have any
    pages," not a possibly-stale prop, to survive React Strict Mode's
    double-mount cleanly).

## Key Decisions

- **Back/forward history stays note-scoped, not page-scoped.** Switching
  between pages within an open note is treated as local UI state (like
  OneNote itself, where clicking between pages in a section isn't a
  browser-history-style navigation event), not a new entry in the global
  `noteHistory` stack built in the prior spec. This avoids reopening that
  already-reviewed subtask and keeps `/canvas?id=...` routing by note id
  unchanged.
- **Pages are a real new entity (new table + full sync layer), not a
  reinterpretation of existing note content** — same reasoning as the
  prior spec's Notebook decision: more faithful to the actual desired
  model, and this project has a proven, repeatable pattern for adding a
  new synced entity by now (this is the fourth time).
- **The cut/copy/paste clipboard mechanism (M4) is built generically so
  M6's Page sidebar can reuse it directly** — avoids building the same
  interaction twice.
- **A new note always gets a default first page atomically** — avoids ever
  needing to handle a "note with zero pages" state anywhere in the canvas
  view or page sidebar.
- **"System" theme is dynamic**, following live OS preference changes via
  a `matchMedia` listener, not a one-time read at app launch — matches
  what a user would actually expect from an option named "System."
- **Existing `notes.content`/`notes.canvas_data` columns are left in place,
  untouched, after the Pages migration** — consistent with this project's
  established non-destructive-migration precedent from the prior spec.

## Open Questions

- Exact tldraw API for hiding the native toolbar and removing just the
  opacity slider from the style panel (subtasks 4 and 10) should be
  verified against the actually-installed tldraw version at
  implementation time, not assumed — tldraw's UI-customization surface
  (`components`/`overrides` props) has had naming/shape changes across
  versions.
- Whether "Paste" on the notebook root (not just a folder) should be
  offered for cut/copy of a top-level folder — left to implementation-time
  judgment, reasonable either way.
- Whether copying a folder should deep-copy every note (and, after M6, every
  page) inside it, including their canvas content — assumed yes (a "Copy"
  that silently produces empty folders would be surprising) but worth a
  sanity check during implementation given the potential size of a deep
  copy.
- Exact visual treatment of the drag-handle bar (subtask 1) and the
  drop-indicator/highlight styling for sidebar drag-and-drop (subtask 7)
  are left to implementation-time visual judgment, following this app's
  existing shadcn/Tailwind design tokens.

## Progress

- Subtask 1 (RichTextShape visual redesign) — done. `RichTextShape.tsx` now has fully transparent, invisible idle styling, with a dotted border + drag-handle bar appearing on hover or while editing. Hover detection uses a new `useIsHoveredShape` hook mirroring tldraw's own `useIsEditing` pattern (`editor.getHoveredShapeId()` via tldraw's reactive `useValue`), since the shape's container deliberately has `pointer-events: none` while idle and wouldn't fire DOM-level hover events. Reviewer caught one real, High-severity bug: the drag-handle bar was absolutely positioned over the top 8px of the content area, which not only visually tinted the first line of text but won pointer hit-testing for that strip even while editing, making it impossible to click-to-place the cursor or select text starting from the top of the content — fixed by switching to a flex-column layout (handle bar as a normal-flow child reserving its own space, content wrapper as `flex: 1 1 auto`) so the two no longer overlap. **Process note**: the fix was verified via `tsc`/CSS-layout reasoning rather than live re-verification — worth a manual sanity check, or folding into subtask 2's verification since it exercises the same area.
- Subtask 2 (Click-to-cursor, no double-click) — done. Half of this was already satisfied by prior work (`RichTextTool` already enters edit mode on a single click). Closed the actual gap: the cursor now lands at the exact point clicked instead of always jumping to the end of the document, via a transient one-shot `pendingEditClickPoint` store field consumed by `RichTextShape.tsx`'s edit-mode-entry effect through ProseMirror's `view.posAtCoords()`. Verified live with real ProseMirror selection positions (clicking mid-word/first-character landed the cursor exactly there, not just visual approximation). Reviewer caught one real bug via source-level tracing: the editability check only looked at the shape's own `isLocked` flag, not `editor.canEditShape()`'s full ancestor-lock check — a shape unlocked itself but inside a locked group could set a click point that then never got consumed (since `setEditingShape` silently no-ops for it), leaving it stale and ready to be wrongly reused by a much later, unrelated edit of the same shape id — fixed by gating on `editor.canEditShape()`, carefully restructured to preserve all other branch behavior exactly. Reviewer also independently verified the trickiest underlying claim (that `TLPointerEventInfo.point` is genuinely client-space, not tldraw page-space) by reading the actual tldraw source, confirming the approach holds under pan/zoom.
- Subtask 3 (Click vs. click-drag distinction in RichTextTool) — done. `RichTextTool.tsx`'s `Idle.onPointerDown` no longer acts immediately; it now routes to new `PointingCanvas`/`PointingShape` intermediate `StateNode`s that watch drag distance. A plain click still creates/edits a shape as before (that logic moved verbatim into these states' `onPointerUp`); a real drag instead hands the live gesture off to tldraw's own `select.brushing` (marquee-select) or `select.translating` (shape move) states via `editor.setCurrentTool("select")` + `getStateDescendant("select").transition(...)`, since tldraw's `exports` map blocks importing those state classes directly. A new `watchForReturnToSelectIdle` watcher switches back to the `rich-text` tool once the hand-off gesture settles into `select.idle`. Reviewer caught one real bug: the hand-off watcher's `react()` reactor was never disposed, so if the editor were torn down mid-gesture (e.g. note closed during an in-flight marquee/translate) it could leak and later fire `setCurrentTool("rich-text")` against a stale editor or hijack an unrelated later tool session — fixed by registering it via `editor.disposables.add(stop)` (matching this file's existing `installRichTextToolAutoReturn` pattern) and removing it from that set on the normal success path to avoid accumulating dead entries over a long session. Reviewer independently verified via tldraw source that the `PointingShape.hitShape` placeholder is never read before `onEnter` populates it, there's no timing race in the hand-off, no double-fire risk with `installRichTextToolAutoReturn`, and the `Idle.onPointerDown` routing table (editable rich-text / locked rich-text / unlocked other shape / locked other shape / empty canvas) is complete.
- Subtask 4 (Draw tab rebuild into sole tool-switcher; fix "stuck in drawing mode" bug) — done. `Ribbon.tsx` gained a real `DrawTab` (Select/Pencil/Eraser/Rectangle/Ellipse/Arrow/"Back to text" buttons driving `editor.setCurrentTool(...)`, with live active-tool highlighting via tldraw's reactive `useValue`) and a `useEffect` that returns the canvas to the `rich-text` tool whenever the ribbon leaves the Draw tab. `CanvasEditor.tsx`'s `<Tldraw>` now hides its own native chrome so the ribbon is the sole tool-switcher. Reviewer caught two real issues. High: the implementor's first pass used the `hideUi` prop, which suppresses tldraw's *entire* native UI including its style panel (shape color/fill/stroke-width/etc.) with no replacement anywhere in the app — fixed by switching to tldraw's granular `components` override, nulling `Toolbar`/`MenuPanel`/`ZoomMenu`/`MainMenu`/`NavigationPanel`/`HelpMenu`/`ActionsMenu`/`PageMenu`/`HelperButtons`/`QuickActions` individually while leaving `StylePanel` on tldraw's default. Medium: the tab-switch auto-return effect had no guard against interrupting an in-flight drag (translate/brush/resize/rotate, including subtask 3's hand-off gestures) — fixed by checking `getIsPointing()`/`getIsDragging()`/`isInAny(...)` and deferring the switch via a `react()` watcher (mirroring `RichTextTool.tsx`'s `watchForReturnToSelectIdle`) until the gesture settles, instead of forcing it mid-gesture. `tsc --noEmit` and `npm run build` both pass. Left unaddressed as low-severity: `setTool(id: string)` is untyped against tldraw's tool-id space, and `setTool`/`setGeoTool` don't check `editor.isDisposed`.
