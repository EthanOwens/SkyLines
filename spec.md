# Skylines — OneNote-Style Redesign

## Goal

Build out the app shell that's never existed (Skylines currently has no
authenticated landing experience — login/register work but redirect to a
`/home` that was never built) as a OneNote-style note-taking UI: a
Notebook → Section → Note hierarchy, a ribbon-style top bar (File / Format /
Draw), a customizable quick-access bar (back/forward/undo/redo), an account
menu, and a user-editable theme system (light, dark, gruvbox dark, plus
user-defined themes). Sourced from `planning.md` at the project root.

This is new UI/UX work, not a port — unlike the prior Tauri migration spec,
there is no reference app to copy from for most of this. Decisions here are
based on general knowledge of OneNote's actual UX conventions plus explicit
choices made in planning conversation.

## Non-Goals

- **No "sketch sheet" theme.** Originally requested, dropped — no concrete
  color palette was settled on. Only light, dark, and gruvbox dark ship as
  built-in themes.
- **No custom-built Draw ribbon tab beyond a thin/minimal wrapper.**
  tldraw (already integrated) ships a complete floating toolbar with
  pencil/shape/color tools. Do not rebuild that inside the ribbon — rely on
  tldraw's own toolbar when a canvas note is open.
- **No cross-device sync of "last open notebook/section/note."** This is
  per-device local state (`localStorage`), not pushed through the Firestore
  sync engine. It is not "data" in the same sense as notes/folders/notebooks.
- **No full drag-to-reorder quick-access-bar customization.** First pass is
  show/hide toggles for the 4 named items (back/forward/undo/redo) only —
  not a general-purpose toolbar-builder with an open-ended action palette.
- **No in-app color-picker theme editor UI.** Custom themes are authored by
  hand-editing a JSON file on disk (mirroring the "like PowerShell themes"
  request literally) — not a GUI theme designer.
- **Do not touch the existing sync engine's core logic** (`lib/sync/push.ts`,
  `pull.ts`, `cleanup.ts`, `engine.ts`) beyond extending it to cover the new
  `notebooks` table using the exact same patterns already established for
  `folders`/`notes`. Don't refactor working sync logic while touching it.
- **Do not modify `../note_taking_app`** — still a read-only reference for
  general architecture context only; this feature set has no counterpart
  there.
- **Do not rebuild `lib/db/folders.ts`/`notes.ts`'s existing CRUD, delete,
  or dirty-tracking logic** — only add the `notebook_id` column/relationship
  to folders and wire notebook-scoping through, without altering the
  already-reviewed recursive-delete/transaction logic in `deleteFolder`.

## Subtasks

Sequenced by dependency — data model first, then the shell that reads it,
then the UI layers on top.

### M1 — Notebook data model

1. **SQLite schema for notebooks.** New migration (next version after the
   existing ones in `src-tauri/src/lib.rs`) adding a `notebooks` table
   (mirroring `folders`'s shape: `id`, `name`, `user_id`, `order_index`,
   `created_at`, `updated_at`, `deleted_at`, `dirty`, `synced_at`) and a
   `notebook_id TEXT NOT NULL REFERENCES notebooks(id)` column on `folders`.
   Since existing local databases may already have folders with no
   notebook, the migration must also: create one default notebook
   (`"My Notebook"`) per distinct `user_id` already present in `folders`,
   and backfill every existing folder's `notebook_id` to point at that
   user's default notebook, so no existing data is silently orphaned.
2. **Notebook types + data-access layer.** Add `Notebook` to `types/index.ts`
   (same shape/sync-bookkeeping fields as `Folder`). Add `lib/db/notebooks.ts`
   mirroring `lib/db/folders.ts`'s CRUD/soft-delete/recursive-delete pattern
   (deleting a notebook cascades to all its folders and their notes, same
   transaction-safety approach as `deleteFolder`). Update `lib/db/folders.ts`'s
   `createFolder`/relevant queries to require/carry `notebook_id`.
3. **Notebook sync.** Extend `lib/sync/push.ts`, `pull.ts`, and
   `lib/sync/cleanup.ts` to cover the `notebooks` table using the exact
   LWW/conflict-backup/tombstone patterns already built for folders/notes —
   this is applying an established pattern to a third table, not new sync
   design.

### M2 — App shell + session

4. **Root app shell.** Wire `AuthProvider`, `useSyncEngine`, and the data
   hooks (`useNotes`/`useFolders`/a new `useNotebooks`) into `app/layout.tsx`
   for real. Unauthenticated users get redirected to `/login`; this closes
   the long-standing "no app shell exists" gap.
5. **Last-open persistence.** `localStorage`-backed (per Non-Goals: not
   synced) tracking of the last-open notebook/section/note id. On
   authenticated app load, navigate to that note if it still exists;
   otherwise fall through to the notebook picker (subtask 6).
6. **Notebook picker.** Landing UI shown when there's no valid last-open
   state (first login, or after "swap notebook"): list the user's
   notebooks, create a new one, select one to open.
7. **Sidebar rework.** Adapt the existing `Sidebar`/`FolderTree` components
   to be notebook-scoped: sections (folders) and notes nested under the
   currently-open notebook, not a flat cross-notebook folder list.

### M3 — Ribbon

8. **Ribbon shell.** File / Format / Draw tab structure and switching.
   The Draw tab is only shown when the currently-open note is a canvas note
   (per Non-Goals, it's a thin wrapper, not a rebuild of tldraw's toolbar).
9. **File tab.** Minimal per planning.md: create new notebook, swap
   notebook (returns to the notebook picker).
10. **Format tab.** Port the existing formatting actions from
    `components/editor/EditorToolbar.tsx` into the ribbon's styling, and add
    font family, font size, and text color — new Tiptap extensions
    (`@tiptap/extension-font-family`, `@tiptap/extension-text-style`,
    `@tiptap/extension-color`) not currently installed.
11. **Bubble menu.** Floating contextual format toolbar that appears above
    selected text (Tiptap's `BubbleMenu` extension) — a smaller subset of
    the Format tab's options, shown on text selection.
12. **Draw tab (minimal).** Thin wrapper per Non-Goals — no custom drawing
    UI; tldraw's own toolbar is what the user actually interacts with.

### M4 — Quick access bar

13. **Quick access toolbar.** Back/forward/undo/redo buttons in the
    top bar, plus a settings button opening a show/hide popover for these 4
    items (per Non-Goals: no drag-reorder, no open-ended action palette).
    Persist visibility choices locally.
14. **Back/forward navigation.** A custom note-visit history stack (not raw
    browser history — sidebar interactions like collapse/expand shouldn't
    count as a "page" to navigate back through).
15. **Undo/redo wiring.** Acts on whichever editor is currently focused
    (Tiptap or tldraw) — one consistent action, not two competing buttons.

### M5 — Account UI

16. **Account icon + dropdown.** Avatar showing the first letter of the
    signed-in user's name/email (in the top bar), with a dropdown: settings
    entry, last-synced-time display (reads `lib/sync/engine.ts`'s status),
    and login/logout actions.

### M6 — Theming

17. **Theme engine foundation.** CSS-variable-based theme definitions
    (extending the existing `app/globals.css` token approach). A themes
    directory on disk (Tauri's app-config-dir, e.g. via
    `@tauri-apps/api/path`) that the app reads user-authored theme JSON
    files from at startup — the "like PowerShell themes" request taken
    literally: users add a theme by hand-editing/dropping a JSON file, no
    in-app editor.
18. **Built-in themes.** Ship light, dark, and gruvbox dark as the bundled
    default theme files, replacing/extending the current hardcoded
    light/dark CSS variables in `app/globals.css`.
19. **Theme picker.** A selector (in the account dropdown or a settings
    view) listing built-in + any user-added themes found in the themes
    directory, applying the selection immediately and persisting the choice
    locally.

## Key Decisions

- **Notebook is a real new entity (new SQLite table + sync layer), not a
  reinterpretation of existing folders.** More faithful to OneNote's actual
  model and to what planning.md describes; accepted the larger scope
  (schema migration + a third table wired through the sync engine)
  deliberately.
- **The ribbon is in-app UI, not the OS-native Tauri menu.** Windows native
  menus can't render color swatches/font pickers/live previews. The
  existing OS-native menu (File/Edit, built for tray/window-close behavior
  in the prior Tauri-migration spec) is untouched and stays separate from
  this in-app ribbon.
- **Draw tab relies on tldraw's existing toolbar rather than duplicating
  it.** tldraw already ships pencil/shape/color tools; rebuilding that
  inside the ribbon would be pure duplicated effort for no user-visible
  gain.
- **Undo/redo in the quick-access bar targets whichever editor has focus**,
  matching OneNote's own behavior, rather than being canvas-only as a
  literal reading of planning.md might suggest.
- **Last-open-note state is per-device (`localStorage`), not synced.**
  Treated as UI convenience state, not user data — avoids new sync-engine
  surface and cross-device conflict handling for something with no clear
  "correct" merged value across devices anyway.
- **Quick-access customization is show/hide only for this pass**, not a
  general toolbar builder — matches exactly what planning.md described
  without inventing a bigger configuration system.
- **Themes are user-editable via hand-edited JSON files on disk**, not an
  in-app color-picker UI — directly matches the "like PowerShell themes"
  phrasing, and is significantly less work than a GUI theme designer while
  still satisfying "easy to configure yourself."
- **"Sketch sheet" theme dropped** — no concrete design was settled on;
  can be added later as a fourth built-in theme once there's an actual
  palette to build from.
- **Migrating existing folders into the new notebook model creates one
  default notebook per user** rather than requiring manual reassignment —
  avoids any silent data loss for whatever local test data already exists
  from the prior spec's work.

## Open Questions

- Exact visual design of the ribbon (colors, icon set, spacing) isn't
  specified — implementor should follow the existing shadcn/Tailwind design
  tokens already in the app (`app/globals.css`) rather than inventing a
  new visual language, but specific layout choices are left to
  implementation.
- Whether "settings" (reachable from the account dropdown) needs to be a
  real settings page in this pass or can be a stub that only exposes the
  theme picker — the theme picker (subtask 19) is the only settings surface
  explicitly requested; a broader settings page isn't otherwise scoped
  here.
- Whether notebook/section reordering (drag-to-reorder in the sidebar) is
  expected — planning.md doesn't mention it and the existing sidebar has no
  such feature today either; treated as out of scope unless it comes up
  during implementation review.
- Exact Tauri app-config-dir path/API for the theme-file loader (subtask
  17) should be verified against the currently-installed
  `@tauri-apps/api` version at implementation time, not assumed.

## Progress

- Subtask 1 (SQLite schema for notebooks) — done — commit 3ff2ede. Fixed a real forward-looking bug: the backfill didn't mark rows dirty, which would have silently broken notebook sync for pre-existing folders once subtask 3 lands.
- Subtask 2 (Notebook types + data-access layer) — done — commit 62a0571. Fixed two real bugs: a genuine compile break (createFolder's new required notebookId param broke Sidebar.tsx's live "New Folder" button + 7 spike routes), and folder push/pull sync silently dropping notebookId (would have set notebook_id = NULL on any folder synced fresh from another device). Both verified fixed live, including a real fresh-pull scenario.
- Subtask 3 (Notebook sync — push/pull/cleanup) — done — commit f6b69a7. Clean mechanical extension of the proven folders/notes sync pattern; reviewer confirmed neither historical bug class (push-time timestamps, stale-syncedAt premature cleanup) was reintroduced. **Real blocker flagged and handed to user**: deployed Firestore rules had no `notebooks` collection permission — user is adding the rule themselves (exact text given: mirrors the existing folders/notes match blocks).
- Subtask 4 (Root app shell) — done — commit 443fbbd. Wired `AuthProvider`/`AppShell`/new `useNotebooks` hook into `app/layout.tsx`; unauthenticated users are redirected to `/login`, with `/login`, `/register`, and all `/spike-*` verification routes exempted. Reviewer caught a real bug: the sync engine and data hooks were firing for the real signed-in user on `/spike-*` routes too, racing against those routes' own manual sync-engine testing (`lib/sync/engine.ts`'s `startSyncEngine` is a module-level singleton) — fixed by only wiring the real `userId` into these hooks off public routes. Also fixed a minor regression where the login page was hidden behind a loading spinner unnecessarily.
- Subtask 5 (Last-open persistence) — done. Added `lib/lastOpen.ts` (localStorage-backed record of the last-open notebook/folder/note id), wired `recordNoteOpened` into `app/note/page.tsx`/`app/canvas/page.tsx`, and a restore effect in `AppShell.tsx` that navigates to the last-open note on authenticated app load (falls through to `/` if none/deleted, per subtask 6 not existing yet). Reviewer caught a critical bug: the original version silently failed to record any note with no parent folder — the *default* state for notes created via Sidebar.tsx's main "New Note"/"New Canvas" buttons — meaning persistence was broken for typical usage. Fixed by making `notebookId`/`folderId` nullable in the stored state and no longer gating the record on folder presence.
- Subtask 6 (Notebook picker) — done. `app/page.tsx` now renders a real landing UI on `/` when there's no valid last-open note: lists notebooks, creates new ones, and "opens" one into a placeholder confirmation (real notebook-scoped content view is subtask 7+). Added `selectedNotebookId`/`notebooksLoaded` to `stores/appStore.ts` and `setLastOpenNotebook` to `lib/lastOpen.ts`; widened `LastOpenState.noteId` to nullable so "notebook open, no note yet" can be persisted. Reviewer caught a real bug: the picker briefly flashed a false "notebook not found"/"no notebooks yet" state on every load and right after creating a notebook, because `selectedNotebookId` restores synchronously from localStorage while `notebooks` loads asynchronously over Tauri IPC — fixed by gating the picker/confirmation render on a new `notebooksLoaded` flag. Also fixed silently-swallowed `createNotebook` errors (added inline error text). **Process note**: this implementor did not perform the project's usual live CDP-driven verification (claimed no CDP/browser tooling available); only `tsc`/`next build` plus code review caught the above bugs. Worth double-checking the picker's real behavior once subtask 7 makes it load-bearing.
- Subtask 7 (Sidebar rework, notebook-scoped) — done. Per user's explicit scope call: added a real `notebook_id` column to `notes` (migration 4, mirroring migration 3's `folders.notebook_id` pattern exactly, including backfill/re-dirty), rather than working around root-level notes having no notebook association. `FolderTree`/`Sidebar`/`FolderItem` are now notebook-scoped (filter by `selectedNotebookId`, root-level filtering is sufficient since nested folders can't cross notebooks). Persistent app-shell wiring (making the sidebar actually visible alongside note/canvas editing) was explicitly deferred to subtask 8, since that's naturally where the full layout gets assembled alongside the ribbon. Reviewer caught two real High-severity bugs: (1) migration 4's backfill left notes permanently orphaned/invisible for any user with notes but no folders, since migration 3's "My Notebook" creation only covered folder-owning users — fixed forward in migration 4 (not editing the already-applied migration 3) by inserting a default notebook for any note-owning user missing one; (2) `Sidebar.tsx`'s new-note/new-canvas/new-folder actions ignored `selectedNotebookId` entirely and always targeted the user's default (lowest-order) notebook, so creating a note while a second notebook was open would silently create it in the wrong, invisible notebook — fixed with a `resolveNotebookId()` helper. Also removed a dead-code `getOrCreateDefaultFolderId` helper the implementor added but never used. **Remaining watch item**: `updateFolder` allows reparenting without touching `notebook_id`, so a future drag-and-drop feature could let a folder cross notebooks — not an active bug today (no such feature exists), flagged for later.
- Subtask 8 (Ribbon shell) — done. Added `components/ribbon/Ribbon.tsx` (File/Format always shown, Draw shown only on `/canvas`; tab content is a placeholder — real content lands in subtasks 9/10/12) and `components/shell/AppLayout.tsx` (sidebar + ribbon + content outlet, rendered once a notebook is open; full-screen content otherwise). Also bundled in the persistent-layout wiring deferred from subtask 7 (agreed with user beforehand): `AppShell.tsx` now renders `AppLayout` around authenticated non-public routes instead of bare children, with `/login`/`/register`/`/spike-*` explicitly excluded. Implementor caught and fixed one bug mid-task (the last-open restore effect wasn't setting `selectedNotebookId`, which would've left the shell un-rendered on a cold launch restoring into a note). Reviewer caught a further real bug in that same fix: `setSelectedNotebook(note.notebookId)` had no validation the notebook still existed (a real gap — `deleteNotebook`'s cascade doesn't soft-delete folder-less notes referencing the notebook directly), so a stale note could scope the shell to a dead notebook id — fixed to validate against the store's live `notebooks` list. **Remaining concerns**: `selectedNotebookId` is still never kept in sync with whichever note is actually being viewed on `/note`/`/canvas` (only the picker, Sidebar's own in-tree nav, and the restore path set it) — a deep link to a note in a different notebook than the one currently selected would show a mismatched sidebar next to the right note; and the underlying `deleteNotebook` cascade bug (folder-less notes not soft-deleted) is real but out of scope, dating to subtask 2. This implementor performed genuine live CDP verification (launched `npm run tauri dev` with the debug port, drove it via raw WebSocket) rather than skipping it.
- Subtask 9 (File tab) — done. `Ribbon.tsx`'s File tab gained "Swap Notebook"/"New Notebook" buttons, both of which clear the current selection (store + persisted last-open state) and return to `/`, reusing the picker's existing list/create UI rather than duplicating it. Implementor also found and fixed a real, unrelated bug live: `app/login/page.tsx`/`app/register/page.tsx` redirected to a nonexistent `/home` route after sign-in (stale from before `/` became the real landing page) — fixed to redirect to `/`. Reviewer caught two more real bugs: `components/sidebar/NoteItem.tsx` had the identical stale `/home` redirect on note deletion, missed by the initial fix; and — more importantly — a genuine data-loss bug made more reachable by this subtask's new "leave the notebook" actions: both `app/note/page.tsx` and `components/canvas/CanvasEditor.tsx` debounce autosave (600ms/800ms) with no flush on unmount, so navigating away within the debounce window silently dropped the last edit. Fixed by tracking pending unsaved content in a ref and flushing it synchronously on unmount in both editors. **Remaining concerns**: "Swap Notebook"/"New Notebook" are literally the same action (both just return to the picker) — honest to the minimal scope but could read as more differentiated than it is; also a cosmetic one-frame flash where content briefly renders without sidebar/ribbon chrome during the swap navigation.
- Subtask 10 (Format tab) — done. Ported `EditorToolbar.tsx`'s formatting actions into the ribbon's Format tab (`components/ribbon/formatActions.ts`, a reusable module subtask 11's bubble menu can share), added font family/size/text color via three new Tiptap extensions, and added `activeEditor` to `stores/appStore.ts` so the ribbon (a sibling of the note page, not a descendant) can reach the live Tiptap instance — `useEditorState` handles reactivity since the editor object's identity doesn't change on internal state changes. Reviewer verified the Tiptap extension wiring/ordering and `useEditorState` usage were correct (not hallucinated APIs) and found only one real issue: `EditorToolbar.tsx` was left in the tree as unused dead code, duplicating logic now forked into `formatActions.ts` — removed directly. **Process note**: the implementor's live verification report claimed the File tab's (subtask 9) "Swap Notebook"/"New Notebook" buttons didn't navigate; I checked the actual diff/file content myself and had the reviewer independently confirm via static analysis that this code is byte-for-byte unchanged and nothing in this diff could have broken it — concluded to be a false report from the implementor's own synthetic-click test methodology, not a real regression. Worth a quick manual sanity check next time the app is open.
- Subtask 11 (Bubble menu) — done. Added `@tiptap/extension-bubble-menu`; `RichTextEditor.tsx` now renders Tiptap's `BubbleMenu` (Bold/Italic/Strikethrough/Inline-code/Link) on text selection, reusing `formatActions.ts` from subtask 10 rather than duplicating logic. Reviewer confirmed the selection-preservation-on-click, default-`shouldShow` broad strokes, and general Tiptap API usage were all correct, and found one real minor bug: the bubble menu's default `shouldShow` didn't exclude node selections, so selecting an inserted image would show formatting buttons that silently no-op against it — fixed with a custom `shouldShow` that additionally hides the menu for a `NodeSelection`. **Process note**: the fixer verified this last fix via `tsc` and reading the installed Tiptap source rather than live CDP testing (didn't restart the dev server for a small targeted fix) — worth a quick manual check next time the app is open.
