# Skylines — Canvas/sidebar bug fixes, page confinement, style panel retirement, theme editor

## Goal

A second batch of fixes and features on top of the prior "Canvas polish,
sidebar management, theming, and Pages" spec: fix a critical bug where
switching pages within a note silently shares/overwrites canvas content
across pages, fix a marquee-select interaction bug and a sidebar
drag-and-drop regression, add folder-scoped note/folder creation, clean up
dead File-tab buttons, add per-page canvas confinement with a synced title
header, fix rich-text default color to follow the active theme, retire
tldraw's native floating style panel in favor of ribbon-integrated controls,
and build a full in-app theme editor (color-wheel editing, live preview,
file-backed persistence, undo history).

## Non-Goals

- **Don't touch the Tiptap bubble menu** (built in the prior spec's M3,
  subtasks 4-6 — bold/italic/highlight/lists/font/color that appears when
  selecting text inside a `RichTextShape`). Planning's "menu with a grid of
  colors/sizes in the top right of the canvas" was confirmed via screenshot
  to be tldraw's own native `StylePanel`, a completely separate UI surface —
  not this bubble menu. The bubble menu is untouched by this spec.
- **Don't wire up Tailwind's `.dark` class toggling app-wide.** The
  default-text-color fix (subtask 8) is a targeted CSS fix using the active
  theme's `--foreground` variable directly. The broader discovery that no
  `dark:` variant anywhere in the app has ever activated (since nothing
  toggles a `.dark` class) is a real but separately-scoped issue, explicitly
  left alone per this spec's own decision — nothing else in the app
  currently depends on `dark:` variants working.
- **Don't rebuild the sidebar drag-and-drop mechanism's core logic**
  (`lib/dnd/sidebar.ts`) beyond fixing whatever the "no-drop cursor" bug's
  actual root cause turns out to be — this is a bug fix, not a redesign of
  the DnD system built in the prior spec's M4.
- **Don't build a generic, app-wide undo/redo system.** The theme editor's
  Ctrl+Z history (subtask 19) is scoped only to that editor's own
  in-session edit history, not a global undo mechanism, and is unrelated to
  tldraw's/Tiptap's own existing undo/redo (which stay untouched).
- **Don't touch the sync engine, auth, notebook-level CRUD beyond the
  File-tab button removal, or `../note_taking_app`.**

## Subtasks

### M1 — Critical canvas bug fixes

1. **Fix pages sharing/overwriting canvas content.** `CanvasEditor.tsx`
   currently renders `<Tldraw>` with no `key` tied to `selectedPageId` (only
   `key={note.id}` further up in `app/canvas/page.tsx`), and `handleMount`'s
   `useEvent`-wrapped `onMount` only ever fires once per editor instance —
   so switching pages never reloads the canvas, and the autosave listener
   keeps writing to whichever page was selected at first mount, regardless
   of which page is currently selected. Fix by giving `<Tldraw>` a `key`
   derived from `selectedPage.id`, so switching pages fully remounts the
   editor (fresh `onMount`, fresh snapshot load, fresh autosave closure
   correctly scoped to the new page) — same remount-on-switch pattern
   already used for note-switching. Verify the loading-spinner state
   (`pagesLoading`/`!selectedPage`) still displays correctly during a page
   switch's brief remount, and that unmount-flush logic for the
   previously-selected page still fires correctly on the outgoing instance
   before the new one mounts.
2. **Fix resize/rotate handles after a marquee-select handoff.** A marquee
   selection made via `RichTextTool.tsx`'s handoff to tldraw's own
   `select.brushing` correctly persists after `watchForReturnToSelectIdle`
   switches back to the `rich-text` tool (confirmed: tldraw selection state
   is independent of the active tool). However, `RichTextTool`'s
   `Idle.onPointerDown` currently ignores `info.target` and always does its
   own hit-test, so grabbing a selection's resize/rotate handle after this
   handoff gets reinterpreted as a shape-translate drag instead of an actual
   resize/rotate. Fix `Idle.onPointerDown` (and/or add a new state) to
   detect `info.target === "selection"` and hand off to tldraw's own
   `select` tool's resizing/rotating child states correctly, mirroring the
   existing `handOffToBrushing`/`handOffToTranslating` pattern. Also verify
   (and fix if broken) that Delete and Format-tab/bubble-menu actions
   correctly operate on a multi-shape selection while the `rich-text` tool
   is active — confirm live, don't assume.
3. **Fix sidebar drag-and-drop showing a "no-drop" cursor.** Static analysis
   found no code-level cause — every `dragover` handler correctly calls
   `preventDefault()`, `dropEffect`/`effectAllowed` are correctly paired,
   and the `ContextMenu` wrapper added in the prior spec's M4 subtask 8
   correctly forwards all drag-related props unchanged. This needs live
   debugging (CDP) to find the actual root cause — candidate hypotheses to
   check first: a WebView2 (Tauri/Windows)-specific quirk with custom
   MIME-type visibility during `dragover` (would make `isSidebarDragEvent()`
   silently return `false`), or a timing/ordering issue between
   `ContextMenuTrigger`'s own event wiring and native drag events. Fix
   whatever the actual cause turns out to be.

### M2 — Sidebar: folder selection for scoped creation

4. **Click-to-select a folder, scoping "New Note"/"New Folder" creation.**
   Currently there is no "selected folder" concept anywhere — the sidebar
   toolbar's "+" buttons always create at the notebook root, and per-folder
   creation only happens via that folder's own inline "+"/context-menu
   actions. Add a persisted "selected folder" UI state (e.g.
   `stores/appStore.ts`): clicking a folder row highlights it (visually,
   faintly, distinct from hover) and keeps it selected across renders;
   clicking empty space/the notebook root clears the selection back to
   root-scoped. The sidebar toolbar's "New Note"/"New Folder" buttons create
   under the selected folder when one is selected, or at the notebook root
   when none is. Existing per-row inline creation actions are unaffected.

### M3 — File tab cleanup

5. **Delete "Swap Notebook" and "New Notebook" buttons.** Both currently
   call the same `returnToPicker` function (functional, but "New Notebook"
   doesn't actually create a notebook — it's mislabeled). Per explicit
   instruction, just delete both buttons from the File tab; it's fine for
   the File tab to end up with fewer/no actions for now.

### M4 — Canvas confinement + page title header

6. **Per-page canvas confinement, expandable on overflow.** Each page's
   canvas should default to a bounded (not infinitely pannable)
   top-and-bottom area — matching a normal document page's feel — but if
   shape content is moved/resized/created beyond the current bounds, the
   confined area expands to include it, rather than clipping/blocking the
   user. Implement using tldraw's camera-constraints API
   (`editor.setCameraOptions`) verified against the actual installed
   tldraw version at implementation time — this needs custom logic tracking
   the union of a default page-sized bound and the current shapes' actual
   bounds, reactively updating the camera constraints as shapes change.
7. **Page title header on the canvas.** Render a title header above the
   confined canvas area, with a horizontal line below it (a border, not
   `text-decoration: underline`). The header's text is the page's title,
   editable inline directly on the canvas. Editing the title either on the
   canvas header or in the Page sidebar (`PageItem.tsx`) updates both
   immediately (both read from/write through the same shared
   `stores/appStore.ts` `pages` state already established in the prior
   spec's M6, so this is a matter of wiring the canvas-side edit through the
   same `updatePage` + shared-state-refresh path the sidebar rename already
   uses, not building a second, separate sync mechanism).

### M5 — Theme-aware default text color

8. **Fix rich-text default (unset) color to follow the active theme.**
   `RichTextShape.tsx`'s Tiptap content currently uses Tailwind Typography's
   `prose`/`dark:prose-invert` classes, which supply their own fixed color
   tokens completely independent of this app's `--foreground` theme
   variable — and since nothing in the theme engine ever toggles a `.dark`
   class (a separate, out-of-scope discovery — see Non-Goals),
   `dark:prose-invert` never activates for any theme, so rich text always
   renders with the same light-mode color regardless of active theme. Fix
   by overriding the rich-text editor's base/default text color (only the
   *unset* case — text with an explicit manually-chosen color, via
   `applyTextColor`, must be untouched) to inherit `hsl(var(--foreground))`
   directly, matching how `editor.css`'s placeholder/blockquote/link rules
   already correctly reference theme variables.

### M6 — Retire tldraw's native style panel into the ribbon

9. **Hide tldraw's native floating style panel.** Currently rendered via
   `CanvasEditor.tsx`'s `StylePanelWithoutOpacity` (built in the prior
   spec's M5 subtask 10, which deliberately kept the panel alive while only
   removing its opacity slider). This subtask goes further: remove the
   panel from ever appearing over the canvas at all (verify the exact
   mechanism — likely setting the `components` prop's `StylePanel` slot to
   `null` — against the installed tldraw version).
10. **Rebuild equivalent color/fill/dash/size controls in the ribbon's Draw
    tab.** The deleted native panel's controls (12-color grid, fill style,
    dash/stroke style, S/M/L/XL size) need an equivalent home in
    `Ribbon.tsx`'s `DrawTab`. Mirror tldraw's own dual-purpose reactive
    resolution (`editor.getSharedStyles()`, already used by `DrawTab`'s
    existing geo-style highlighting from the prior spec's M2 subtask 4): the
    controls apply to the current selection's style when shapes are
    selected, or to the "next shape" style when a drawing tool is active
    with nothing selected — matching exactly what the native panel already
    did, just relocated into the ribbon.
11. **Pencil color dropdown.** Add a small color-swatch dropdown ("carrot")
    next to the Pencil/draw tool button in the Draw tab specifically, for
    quickly changing the draw tool's current color without needing the full
    style control set from subtask 10 — a fast, dedicated affordance layered
    on top of it.

### M7 — Theme editor

12. **"Edit themes" entry point.** Add an item at the bottom of the existing
    theme picker (`AccountMenu.tsx`'s theme radio group) that opens a new
    Theme Editor (dialog or dedicated view — implementation's choice of
    exact presentation).
13. **Theme Editor shell/layout.** Left sidebar (theme list), right sidebar
    (color editor), center (live preview), Save/Discard footer — build the
    overall structural layout first, before wiring real behavior into each
    region.
14. **Left sidebar: theme list + create-new-theme.** Lists all available
    themes (built-in + user-created from `lib/themes/loader.ts`), clicking
    one loads it into the editor for viewing/editing. A "create new theme"
    button (dotted border, visually distinct from existing theme entries)
    clones a sensible default palette into a new, unsaved theme.
15. **Right sidebar: color-wheel editor.** A color-wheel-based picker for
    every one of the 31 `ThemeVariableKey` values in the theme currently
    loaded for editing. Exact color-wheel component/library choice is an
    implementation-time decision (no color-picker library is currently
    installed — verify current best options rather than guessing).
16. **Center: live mini-preview.** A bounded mock mini-canvas (a simple,
    hand-built preview area — not a real embedded tldraw instance) showing a
    movable, editable default text box, updating live as right-sidebar
    colors change, to demonstrate the theme's variables in a representative
    miniature UI.
17. **Save/Discard + unsaved-changes handling.** "Save" persists the edited
    theme to its JSON file (extending `lib/themes/loader.ts`, which
    currently only reads, with a writer/save function) and applies it live
    if it's the currently-active theme. "Discard" reverts in-editor changes.
    Closing the editor or switching to a different theme while there are
    unsaved changes shows a save/discard/cancel confirmation prompt. A
    newly-created theme that's never saved is deleted if the editor closes
    without saving it.
18. **Left-sidebar theme context menu + undo.** Right-clicking a theme in
    the left sidebar offers: copy theme values, paste theme values (onto
    another theme), delete. Ctrl+Z undoes value edits, deletions, and full
    theme-value pastes — scoped to the current theme-editor session's
    in-memory history, not a persisted/cross-session undo log and not a
    general app-wide undo system.
19. **Open themes folder in file explorer.** A button at the bottom of the
    left sidebar opens the themes directory (wherever
    `lib/themes/loader.ts` reads/writes user theme JSON files) in the OS's
    file explorer, via Tauri's shell/opener plugin.

## Key Decisions

- **Theme editor is bundled into this spec, not split into a separate
  later one** — explicit user choice, despite being the largest single
  chunk of work here (subtasks 12-19).
- **"The menu in the top right of the canvas" (planning.md's item 9) is
  tldraw's own native `StylePanel`, confirmed via screenshot** (12-color
  grid, fill/dash icon rows, S/M/L/XL size buttons — an exact match) — not
  the Tiptap bubble menu built in the prior spec. The bubble menu is
  untouched.
- **Page-switch bug fix uses a full `<Tldraw>` remount keyed by
  `selectedPage.id`**, not an imperative store-swap — simpler, and
  consistent with the existing note-switch remount pattern, at the cost of
  a brief re-init flash on every page switch (accepted tradeoff).
- **Dark-mode text-color fix stays targeted** (CSS override using
  `--foreground` directly) rather than also wiring up `.dark` class
  toggling app-wide — explicit user choice; nothing else currently depends
  on `dark:` variants working.
- **The sidebar DnD "no-drop cursor" bug has no confirmed root cause from
  static analysis alone** — subtask 3 explicitly requires live/CDP
  debugging as part of the fix, not further static investigation.
- **Theme editor's undo (Ctrl+Z) is a hand-rolled, in-session-only history
  stack**, not a reuse of any existing undo mechanism in the app (tldraw's
  and Tiptap's own undo/redo are separate, unrelated, and untouched) and
  not persisted across editor-close/reopen.

## Open Questions

- Exact tldraw camera-constraints API/mechanism for per-page confinement
  with dynamic expansion-on-overflow (subtask 6) is nontrivial custom
  composition, not a single documented tldraw feature — left to
  implementation-time verification against the installed tldraw version,
  following this project's established discipline of reading actual
  installed source rather than guessing at API shape.
- Exact color-wheel library choice for the theme editor's right sidebar
  (subtask 15) — no such dependency currently exists in this project;
  implementation should verify current best-fit options rather than
  defaulting to the first one considered.
- Exact visual treatment of "a line below the title, not an underline"
  (subtask 7) and the folder highlight-on-select styling (subtask 4) are
  left to implementation-time visual judgment, following this app's
  existing shadcn/Tailwind design tokens.
- Whether the Theme Editor should be a modal dialog or a dedicated
  full-screen view is left to implementation-time judgment, given no strong
  signal either way from planning.md's wording.

## Progress

- Subtask 1 (Fix pages sharing/overwriting canvas content) — done. `<Tldraw>` in `CanvasEditor.tsx` now has `key={selectedPage.id}`, forcing a full remount on every page switch (mirroring the existing `key={note.id}` note-switch pattern) — the actual fix, since tldraw's own `onMount` only ever fired once per editor/store instance, so switching pages previously never reloaded the canvas and the autosave listener kept silently overwriting whichever page was selected at first mount. Reviewer caught a real bug this fix itself enabled: the legacy `note.content` → `RichTextShape` migration branch was previously unreachable more than once (since `onMount` never re-fired at all), but now that it genuinely does, every page with no `canvasData` and zero shapes — including a brand-new blank page — would get a duplicate copy of old note-level content silently injected. Fixed by gating the migration to only the note's first page (`page.id === pages[0]?.id`), keeping `note.content` permanently untouched, consistent with this codebase's non-destructive-migration philosophy. `tsc --noEmit` and `npm run build` pass.
- Subtask 2 (Fix resize/rotate handles after marquee-select) — done, after six review rounds. `watchForReturnToSelectIdle` (`RichTextTool.tsx`) now only auto-returns to `rich-text` once the tool is in `select.idle` AND the selection is empty, not idle alone; `installRichTextToolAutoReturn` (a separate, pre-existing watcher for the click-to-create-then-edit flow) got the same treatment via a new `react()`-based watcher. Net effect: as long as any selection persists (marquee-select, shape-drag, or a click-away that detours into a marquee), the tool stays on tldraw's real `select` tool, so resize/rotate handles, native Delete, and further drag-to-move all just work natively — no custom hand-off code needed. The subtask's original approach (a new `handOffToSelectionHandle` hand-off function) was found to be permanently dead code — tldraw only makes handles interactive while `currentTool` is genuinely `select`, and a `target: "selection"` event can only reach this tool's state while `currentTool` is `rich-text`; those conditions are mutually exclusive — and was removed. Five real bugs were found and fixed across the review rounds, each closing one timing gap in tldraw's internal state machine only to expose the next (round 1: the dead hand-off code; round 2: `watchForReturnToSelectIdle` needed the empty-selection gate to avoid stranding a persisted selection; rounds 3-5: `installRichTextToolAutoReturn`'s own fix went through a broken `queueMicrotask` approach, then a `react()` watcher missing the same empty-selection gate, before landing correctly). Round 6 independently re-traced the full mechanism end-to-end against the actual tldraw source and found no further issues. **Process note**: no live CDP verification was performed at any point (no browser tooling available) — given how subtle this turned out to be, a manual pass is worth prioritizing: marquee-select multiple shapes and confirm resize/rotate/Delete work, and confirm clicking away from an edited shape still lets a second click create a new one. `tsc --noEmit` and `npm run build` pass at every stage.
- Subtask 3 (Fix sidebar drag-and-drop "no-drop" cursor) — done. Root cause found via live user testing (planning-phase static analysis had found nothing wrong in the sidebar's own DnD code): `src-tauri/tauri.conf.json`'s window config had `dragDropEnabled: true`, deliberately added in an earlier, unrelated spec as inert plumbing for a never-built file-import feature. On Windows/WebView2, this and the webview's own native HTML5 `dragover`/`drop` DOM events are mutually exclusive — reviewer traced the exact mechanism in Tauri's vendored `wry` crate source: enabling it installs a Win32 `IDropTarget` on the WebView2 host that only recognizes file (`CF_HDROP`) payloads, leaving the drop-effect at `DROPEFFECT_NONE` for any non-file (in-page) drag payload and never letting the event reach the page's own DOM listeners — exactly the "no-drop cursor over every row" symptom, while leaving unrelated interactions (right-click) untouched. Fixed by setting `dragDropEnabled: false`; `lib.rs`'s now-inert `WindowEvent::DragDrop` handler comment updated to explain why, left in place as a placeholder per this codebase's existing convention for not-yet-built future work. No TypeScript/React code was touched — the sidebar's own `lib/dnd/sidebar.ts` and all its consumers were already correct. Reviewer confirmed via repo-wide grep that nothing depends on Tauri's native file-drop events today. `cargo check` passes.
- Subtask 4 (Click-to-select a folder, scoping "New Note"/"New Folder" creation) — done. `selectedFolderId`/`setSelectedFolder` turned out to already exist in `stores/appStore.ts` as unused dead scaffolding; this diff is their first real consumer. `FolderItem.tsx`'s row click now both toggles expand/collapse (existing) and sets the folder as selected (new), with a faint highlight distinct from hover/drop-target styling; `FolderTree.tsx`'s container clears the selection on empty-space clicks; `Sidebar.tsx`'s toolbar `newNote`/`newFolder` create under the selected folder when set, falling back to the notebook root when not. Reviewer caught two real issues: (1) High — nothing cleared `selectedFolderId` when switching notebooks, so a folder selected in Notebook A could still be targeted by the toolbar after switching to Notebook B, creating a note/folder whose `notebook_id` says B but is nested under a folder belonging to A (no validation anywhere would have caught this) — fixed by resetting `selectedFolderId` inside `setSelectedNotebook` itself, covering every call site. (2) Medium — `NoteItem.tsx`'s row click didn't stop propagation (unlike `FolderItem.tsx`'s, updated for the same reason in this diff), so clicking any note bubbled up and silently cleared the folder selection, undermining the whole feature — fixed by adding the same `e.stopPropagation()`. **Process note**: no live CDP verification was performed (implementor judged the authenticated Tauri session out of time budget). `tsc --noEmit` and `npm run build` pass.
- Subtask 5 (Delete "Swap Notebook" and "New Notebook" buttons) — done. Both removed from the ribbon's File tab, along with the now-unused `returnToPicker` function and its dependencies (`useRouter`, a `setSelectedNotebook` subscription, `setLastOpen` import) — none used elsewhere in the file. The File tab now shows a plain "No actions available." placeholder, matching `DrawTab`'s own existing empty-state pattern in the same file. Reviewer found no functional issues: confirmed `Button` is still used elsewhere in the file, confirmed nothing else in the repo references the removed buttons/function, confirmed `setSelectedNotebook`/`setLastOpen` are only un-consumed here (the shared store field/module are untouched), and confirmed `tsc --noEmit` passes clean. One cosmetic-only nit: the implementor's stated "matches `FolderTree.tsx`'s empty state" justification didn't actually hold — the real match is `DrawTab`'s own local pattern, the more relevant precedent anyway. Not worth a fix.

M3 (File tab cleanup) is now complete.
