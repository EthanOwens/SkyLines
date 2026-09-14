# Skylines — Bullet formatting, theme editor cleanup, timestamps, Sticky Notes

## Goal

Verify/fix bullet-list auto-formatting across all text-editing surfaces,
clean up the theme editor's cluttered variable list, add last-edited
timestamps to canvas text boxes and pages, and build a full Sticky Notes
feature: pop-out, always-on-top mini windows embeddable into any text area
via Ctrl+K, with their own formatting chrome, a home page for browsing/
creating them, and screenshot-to-sticky-note capture.

## Non-Goals

- **Don't touch the theme editor's color-editing mechanics** (color wheel,
  Save/Discard, undo/redo, context menu, file persistence) — only which
  variables are shown and how they're grouped.
- **Don't change existing plain-URL hyperlink behavior** — Ctrl+K's new
  dialog adds sticky-note options alongside the existing URL path, it
  doesn't change how a plain URL link is parsed/rendered/clicked.
- **Don't build real-time multi-device sync for sticky notes beyond this
  app's existing local-first + debounced Firestore push pattern** — reuse
  `lib/sync/engine.ts`'s established mechanism (dirty/synced_at columns,
  `notifyDataChange`), not a new sync system.
- **Sticky notes are desktop-only for this spec.** Multi-window management
  (pop-out windows, always-on-top, focus/blur chrome) doesn't translate
  cleanly to the existing Android build target — Android behavior for
  sticky notes is explicitly out of scope; the feature can be gated to
  desktop only.
- **Screenshot capture targets Windows first.** Cross-platform screen
  capture APIs differ significantly (macOS/Linux need separate permission
  models and APIs) — only Windows needs to work for this spec; macOS/Linux
  support is a stretch goal, not a blocker.
- **Don't touch `../note_taking_app`** or any other sibling project.

## Subtasks

### M1 — Bullet-list formatting

1. **Verify and fix bullet-list auto-formatting in both existing editors.**
   Tiptap's `StarterKit` (already used by both `RichTextEditor.tsx` and
   `RichTextShape.tsx`) includes `@tiptap/extension-list`, which already
   provides: a `wrappingInputRule` that auto-converts `-`/`*`/`+` + space
   into a bullet list, `Enter` continuing the list via `splitListItem`, and
   `Tab`/`Shift-Tab` bound to `sinkListItem`/`liftListItem` for indent/
   outdent. Live-test all of this in both editors (full-page notes and
   canvas text boxes) and fix whatever's actually broken or missing (e.g.
   confirm Backspace at the start of an empty list item outdents/exits the
   list rather than just deleting a character — verify against Tiptap's
   actual default keymap rather than assuming). Do not build bullet-list
   behavior from scratch if it already works — this subtask is a
   verify-and-patch pass, not a rewrite.

### M2 — Theme editor cleanup

2. **Remove the 5 dead theme variables.** `chart-1` through `chart-5`
   (`ThemeVariableKey` in `lib/themes/types.ts`, `app/globals.css`'s
   `:root`/`.dark` blocks, `lib/themes/builtin.ts`'s palettes, and the
   corresponding `ThemeColorField` rows in `ThemeEditor.tsx`) are confirmed
   dead — a codebase-wide search found no `chart-*` Tailwind class anywhere
   in `components/`, since this app has no chart/graph feature. Remove all
   five entirely from the theme system (type union, validation array, CSS
   variable declarations, built-in palettes, and the editor's field list) —
   not just hide them in the UI.
3. **Group the theme editor's remaining color fields.** `ThemeEditor.tsx`'s
   right sidebar currently renders all 26 remaining `ThemeVariableKey`s as
   one flat list. Reorganize into labeled sections matching how they're
   actually used: Base & Text (`background`/`foreground`), Card, Popover,
   Primary/Secondary/Accent, Destructive, Border/Input/Focus Ring, Radius,
   Sidebar. Purely a presentation/grouping change — the fields, their
   editing behavior, and the underlying data model are untouched.

### M3 — Last-edited timestamps

4. **Add a per-shape last-edited timestamp to canvas text boxes.**
   `RichTextShape.tsx`'s shape props gain a new field (e.g.
   `lastEditedAt: number`), updated to `Date.now()` on every content change
   via the existing `onUpdate` handler (per explicit decision: updates live
   on every edit, not just on blur) — persisted the same way the rest of
   `shape.props` already is (part of the page's `canvasData` snapshot, no
   separate DB column needed).
5. **Render the faded short-form timestamp on each text box.** A small,
   muted, faded date+time string (short form, e.g. "Sep 5, 2:55 PM") shown
   somewhere on the shape — exact placement/visibility rules (always shown
   vs. only on hover/edit like the existing chrome) are implementation-time
   visual judgment, following this app's existing shadcn/Tailwind
   conventions.
6. **Add the long-form last-edited line under the page title.** The canvas
   page header (`CanvasEditor.tsx`) already has a border-bottom line below
   the title (from the prior spec's M4 subtask 7). Render a long-form
   date/time stamp under that line (e.g. "Wednesday, September 5, 2026
   2:55 PM") reflecting the page's own `updated_at` (already tracked in
   `lib/db/pages.ts`'s schema — no new data needed), updating live as the
   page's title or canvas content changes.

### M4 — Sticky Notes

7. **Sticky note data model + migration.** A new `sticky_notes` SQLite table
   (mirroring `lib/db/pages.ts`'s established local-first pattern: `id`,
   `user_id`, `title`, `content` as Tiptap JSON, `top_bar_color`, `pinned`,
   `created_at`/`updated_at`/`deleted_at`, `dirty`, `synced_at`), added via
   a new migration in `src-tauri/src/lib.rs` alongside the existing ones,
   plus a new `lib/db/stickyNotes.ts` CRUD module matching
   `lib/db/pages.ts`'s exact function-naming/shape conventions.
8. **Sticky note pop-out window.** A real, separate Tauri window (created
   at runtime via `@tauri-apps/api/window`'s `WebviewWindow`, not a
   pre-declared config window — each sticky note gets its own), sized to a
   9:16 aspect ratio, rendering a new dedicated route (e.g.
   `app/sticky/page.tsx` reading the note id via a query param, same
   pattern `app/canvas/page.tsx` already uses) with none of the main app's
   ribbon/sidebar chrome — just a Tiptap editor bound to that note's
   content, autosaving the same debounced way the other editors do.
9. **Sticky note top bar.** Appears on window focus, hides on blur (the
   whole window also shrinks in height while unfocused, per spec). Pin
   button (real OS-level always-on-top via Tauri's `setAlwaysOnTop`, over
   the whole desktop per explicit decision — not just this app's own
   windows), Exit button (autosave if dirty, then close the window), and a
   3-dot menu with Delete and "Change top bar color" (a color picker scoped
   to just this note; defaults to the active theme's `--primary`).
10. **Sticky note bottom bar.** Also focus/blur-gated like the top bar. A
    compact subset of `formatActions.ts`'s existing actions: bold, italic,
    underline, strikethrough, bullet list, and a checkbox/task list toggle
    (reusing Tiptap's `TaskList`/`TaskItem`, already used elsewhere in this
    app's editors) — mirrors `FormatTab`'s established
    read-state-then-render-buttons pattern, not a new formatting system.
11. **Ctrl+K dialog.** Replace the bare `window.prompt("URL", prev)` in both
    `RichTextEditor.tsx` and `RichTextShape.tsx` with a real dialog
    (`components/ui/dialog.tsx`) offering three choices: paste a URL
    (existing behavior, preserved exactly), create a new sticky note
    (creates a `sticky_notes` row, opens its pop-out window immediately,
    and embeds a reference at the cursor), or pick an existing sticky note
    from a searchable list to embed.
12. **Sticky note embed rendering.** A distinct, clickable inline mark/node
    in the Tiptap document (visually distinct from a plain hyperlink — not
    just a blue underlined link) that opens the referenced sticky note's
    pop-out window on click, reusing whatever of the existing `Link`
    extension's click-interception conventions make sense but with its own
    click behavior (open/focus a Tauri window, not navigate a URL).
13. **Nested sticky-note embedding.** Confirm a sticky note's own editor
    (subtask 8) includes the same embed extension from subtask 12, so an
    embed inside an already-open sticky note correctly opens another
    pop-out window on click — live-verify this rather than assuming it
    falls out for free.
14. **Sticky notes home page.** A new view listing all sticky notes as
    collapsed preview cards (title/first line of content, top-bar color
    swatch) — clicking a card opens that note's pop-out window (subtask 8).
15. **Ribbon entry point.** A new tab/button on the far right of the ribbon
    (alongside File/Format/Draw) that opens the home page from subtask 14.
16. **Screenshot-to-sticky-note capture.** On the home page, a "screenshot"
    action that lets the user pick an open OS window and captures it (needs
    a native Rust screen-capture dependency added to `src-tauri/Cargo.toml`
    — verify the current best-maintained cross-platform crate at
    implementation time rather than guessing, per this project's
    established discipline), shows a live preview, and lets the user
    double-click it to create a new sticky note whose content is that
    captured image, openable and drawable-on (reusing this app's existing
    tldraw-based canvas machinery for the drawing surface, unless
    implementation-time investigation finds a lighter-weight approach makes
    more sense — flagged as the single highest-risk/most likely to need a
    scope renegotiation subtask in this entire spec, given it's genuinely
    new engineering territory for this app).

## Key Decisions

- **Sticky Notes is included in this same spec**, not split into its own
  later one, despite being by far the largest single feature here (subtasks
  7-16) — explicit user choice, made after being told this upfront.
- **The bullet-list item (subtask 1) is a verify-and-fix pass, not new
  construction** — Tiptap's `StarterKit` already ships this behavior via
  `@tiptap/extension-list`, confirmed by reading the installed package
  source before writing this spec.
- **`chart-1` through `chart-5` are removed entirely from the theme
  system**, not just hidden in the editor UI — confirmed genuinely unused
  anywhere in this app's actual component code via a codebase-wide search.
- **Per-text-box timestamps update on every content change**, not just on
  blur — explicit user choice.
- **Screenshot capture is built as a real subtask now**, not deferred to a
  future spec, despite being flagged as the highest-risk/most novel piece
  of engineering in this entire spec (a genuinely new native OS-integration
  capability for this app) — explicit user choice, made after being told
  the tradeoff upfront.
- **Ctrl+K's existing bare `window.prompt("URL")` is replaced with a real
  dialog** offering URL / new sticky / existing sticky — explicit user
  choice, needed since a native `prompt()` can't offer more than one text
  input.
- **Pin makes a sticky note always-on-top over the entire desktop**
  (other applications too), not just over this app's own windows —
  explicit user choice, matching how OS-level sticky-note/widget apps
  conventionally behave.
- **Sticky notes are desktop-only; screenshot capture targets Windows
  first** — both explicit scope-limiting decisions made during planning to
  keep an already-large spec from also taking on cross-platform screen
  capture and mobile multi-window support in the same pass.

## Open Questions

- Exact visual placement/visibility rule for the per-text-box faded
  timestamp (subtask 5) — always visible vs. only on hover/edit — left to
  implementation-time visual judgment.
- Exact Rust crate for native screen capture (subtask 16) — no such
  dependency exists in this project today; implementation should verify
  current best-maintained, actively-supported options rather than
  defaulting to the first one found, per this project's established
  discipline (e.g. the theme editor's `react-colorful`/`culori` picks).
- Exact drawing-surface implementation for "draw on a captured screenshot"
  (subtask 16) — reusing the existing tldraw-based canvas machinery
  (`RichTextShape.tsx`'s sibling infrastructure) is the default assumption,
  but a lighter-weight, purpose-built drawing surface may turn out to be a
  better fit once the screenshot-capture mechanism itself is understood —
  left to implementation-time judgment.
- Whether the sticky-note embed (subtask 12) should be a Tiptap mark (like
  `Link`) or a custom node — left to implementation-time judgment based on
  which fits Tiptap's actual API better for "clickable, non-editable inline
  reference that isn't real text content."
- Whether "Delete" on a sticky note (subtask 9's 3-dot menu) should warn
  when other documents still have embeds pointing at it — not addressed by
  planning.md; left as an open question for the implementor to flag if it
  turns out to matter, rather than guessed at now.

## Progress

- Subtask 1 (Verify and fix bullet-list auto-formatting) — done, verify-only, no code changes. Confirmed by reading the installed `@tiptap/extension-list` package source that `StarterKit` (used unmodified aside from `codeBlock: false` in both `RichTextEditor.tsx` and `RichTextShape.tsx`) already provides everything the subtask asked for: a `wrappingInputRule` auto-converting `-`/`*`/`+` + space into a bullet list, `Enter`→`splitListItem`, `Tab`/`Shift-Tab`→`sinkListItem`/`liftListItem`, and `ListKeymap`'s `handleBackspace` correctly outdenting at the start of a list item rather than just deleting a character. No diff was produced, so there was nothing to commit for this subtask.
- Subtask 2 (Remove the 5 dead theme variables) — done. `chart-1` through `chart-5` removed entirely from the theme system: `lib/themes/types.ts`'s `ThemeVariableKey` union and `THEME_VARIABLE_KEYS` array, `app/globals.css`'s `:root`/`.dark` declarations and `@theme` Tailwind-token mappings, and all 4 built-in theme palettes (`LIGHT_THEME`, `DARK_THEME`, `GRUVBOX_DARK_THEME`, `OFF_WHITE_THEME`) in `lib/themes/builtin.ts`. `ThemeEditor.tsx` needed no edit since its field list is driven entirely by `THEME_VARIABLE_KEYS`. Reviewer caught one cosmetic issue (a stale variable-count comment, "26" instead of the correct "27") — fixed directly. Confirmed no remaining `chart-*` references anywhere in the codebase, and that a pre-existing user theme file with old `chart-*` keys fails `isTheme()`'s validation gracefully (rejected, not a crash) — an accepted, expected consequence of the removal. `tsc --noEmit` and `npm run build` pass.
- Subtask 3 (Group the theme editor's remaining color fields) — done. `ThemeEditor.tsx`'s right sidebar now renders the 27 `ThemeVariableKey` rows grouped into 8 labeled sections (Base & Text, Card, Popover, Primary/Secondary/Accent, Destructive, Border/Input/Focus Ring, Radius, Sidebar) via a new `THEME_VARIABLE_GROUPS` constant, instead of one flat list — purely structural, `ThemeColorField`/`handleVariableChange`/the radius input/save-undo-dirty-check logic all untouched. Reviewer found no issues: confirmed full coverage of all 27 keys with no drops/duplicates, confirmed `THEME_VARIABLE_KEYS`'s other use (in `isDraftDirty()`) is unaffected, confirmed React key uniqueness and type safety hold, and confirmed the per-group divider scoping (no divider between a group's last row and the next group's heading) is an intentional presentational change, not a bug. `tsc --noEmit` passes.
- Subtask 4 (Add a per-shape last-edited timestamp to canvas text boxes) — done. `RichTextShapeProps` gained `lastEditedAt: number`, updated to `Date.now()` atomically alongside `content` on every Tiptap edit (not just blur, per explicit decision), and set on shape creation. Data-model/plumbing only — no rendering added yet (that's subtask 5). The implementor itself caught and fixed a real backward-compatibility break: adding a new required prop to an existing tldraw shape type would reject loading any page saved before this change, since tldraw's props validator rejects a shape record missing a declared key. Fixed via tldraw's own `TLPropsMigrationSequence` mechanism (this shape type's first-ever migration), backfilling `lastEditedAt = 0` onto pre-existing records before validation runs, modeled directly on tldraw's own built-in `TLNoteShape` migrations. Reviewer did unusually deep verification given this was new territory for the codebase: confirmed the migration APIs are real and correctly re-exported by actually running the imports in Node, traced tldraw's real `createTLStore`/`Tldraw.tsx` wiring to confirm `static override migrations` on the ShapeUtil is genuinely sufficient with no other registration point needed, confirmed via git history this really is the shape's first prop addition since creation (no other unmigrated prop lurking), and diffed the migration's shape directly against tldraw's own shipped `TLNoteShape.ts` migrations. `tsc --noEmit` passes.
- Subtask 5 (Render the faded short-form timestamp on each text box) — done. A small, faded (`text-muted-foreground`, 60% opacity, 10px) last-edited timestamp now renders in the bottom-right corner of each canvas text box, formatted via `Intl.DateTimeFormat` (e.g. "Sep 5, 3:55 PM"), gated on the shape's existing `showChrome` (hover-or-editing) condition for consistency with the drag-handle bar; skips rendering entirely for the migration's `lastEditedAt === 0` legacy sentinel rather than showing a bogus 1970 date. Reviewer found no correctness issues (confirmed correct DOM/positioning-context placement, consistent `showChrome` gating with no stale-closure risk, safe `!== 0` guard, correct 12-hour AM/PM formatting verified in Node, and correct stacking/paint order) — flagged one minor cosmetic nit, not a bug: when a shape is both hovered/editing and selected simultaneously, the timestamp can visually overlap tldraw's own bottom-right resize handle in that same corner (purely cosmetic, `pointer-events: none` means no functional conflict). Left as-is pending visual review rather than guessing at a reposition. `tsc --noEmit` passes.
- Subtask 6 (Add the long-form last-edited line under the page title) — done. A secondary-styled (`text-xs text-muted-foreground`) long-form last-edited line now renders under the page title's divider, e.g. "Saturday, September 5, 2026 2:55 PM", reading `selectedPage.updatedAt`. Reviewer caught two real bugs and one cosmetic divergence, all fixed: (1) `commitTitle()`'s own store update never refreshed `updatedAt` alongside `title`, so the timestamp silently never updated after a title edit despite the DB write bumping it correctly; (2) the unmount-flush save path (separate from the debounced-timer autosave path, which the implementor had already wired correctly) had the same staleness gap — confirmed reachable: editing canvas content, switching pages before the 800ms debounce fired, then switching back later in the same session would show a stale timestamp, since nothing else re-fetches `pages` on a plain page switch; both fixed by reading fresh store state and updating just the affected page's `updatedAt` after each write resolves. (3) The initial combined-formatter approach produced "...2026 **at** 2:55 PM" (Intl's default en-US pattern inserts "at" when weekday+date+time are requested from one formatter) — fixed by formatting date and time separately and concatenating with a plain space. `tsc --noEmit` passes, format output verified directly in Node.
- Subtask 7 (Sticky note data model + migration) — done. New `sticky_notes` SQLite table (migration version 7, correctly the next sequential number) with `id`/`user_id`/`title`/`content`/`top_bar_color`/`pinned`/`created_at`/`updated_at`/`deleted_at`/`dirty`/`synced_at`, mirroring `pages`/`notes`' exact sync-bookkeeping shape — sticky notes are their own top-level entity, not scoped to a note/page. New `lib/db/stickyNotes.ts` faithfully mirrors `pages.ts`/`notes.ts`'s full function surface (CRUD plus dirty/tombstone/upsert-from-remote sync-support functions, confirmed genuine mirroring rather than scope creep by checking `pages.ts` already has this identical surface — sync-engine registration itself is a later subtask, not wired here). New `StickyNote` type in `types/index.ts`. Reviewer verified migration numbering, the `content?: object | null` optionality (matches `Page`/`Note`'s identical established pattern), the reused-placeholder SQL binding style (verified as a real existing precedent in `createNote`, not novel/unverified), the `ById`/`RowById` soft-delete-filtering distinction (matches siblings verbatim), and the `local`/`remote` `notifyDataChange` tagging convention. One reviewer nitpick (claimed the file had no function-level comments) was independently checked and found factually wrong — the file has substantial JSDoc throughout — and disregarded. `tsc --noEmit` and `cargo check` both pass. No UI or sync-engine registration touched, as scoped.
- Subtask 8 (Sticky note pop-out window) — done. New `app/sticky/page.tsx` (mirrors `app/canvas/page.tsx`'s query-param/`Suspense` pattern) + `components/editor/StickyNoteEditor.tsx` (minimal Tiptap editor, extension list copied from `RichTextEditor.tsx`, autosaving on the established 800ms debounce with unmount-flush — no formatting bars yet, that's subtasks 9/10) + `lib/stickyWindow.ts` exporting the reusable `openStickyNoteWindow(id)` helper later subtasks (Ctrl+K dialog, home page, ribbon button) will call, opening a real 360×640 (9:16) Tauri window and reusing/focusing an existing window for the same note instead of duplicating. Added a new `src-tauri/capabilities/sticky.json` scoped to a `"sticky-*"` window-label glob granting SQL permissions — the critical, easy-to-miss piece, since runtime-created Tauri windows get zero permissions by default under Tauri v2's per-window capability scoping; without this the window would open but every save/load would silently fail. Also added `core:webview:allow-create-webview-window` to the main window's capability, and a temporary "New sticky note" sidebar button purely to exercise this subtask (calls the same real helper later subtasks will use). Reviewer caught a real inefficiency: the sticky popup was booting a full second sync-engine instance plus live notes/folders/notebooks subscriptions (each `WebviewWindow` is its own JS runtime, so the existing singleton guard doesn't span windows) for state the sticky editor never reads — fixed by extending `AppShell.tsx`'s existing `publicRoute` sync-exclusion gate to also cover the sticky route. Reviewer separately verified the capability glob syntax against the generated schema, the `trailingSlash: true` pathname-normalization handling, the window-reuse API usage against installed types, and that no untrusted string reaches the window URL. One thing flagged as unverifiable (not a found bug): whether Firebase auth state is genuinely shared across separate `WebviewWindow` instances — no evidence of a problem, but couldn't be confirmed without live testing; worth checking first when the app is run. `tsc --noEmit` and `cargo check` both pass.
- Subtask 9 (Sticky note top bar) — done. New `StickyNoteTopBar.tsx` — a colored strip (defaults to the active theme's `--primary` via CSS, overridable per-note) with Pin/3-dot-menu/Exit buttons visible only while the real OS window has focus (`Window.onFocusChanged`, not a DOM event); the window physically shrinks to a 48px strip on blur and restores to its exact prior size on refocus; Pin toggles real OS-level always-on-top via `Window.setAlwaysOnTop`; Exit flushes pending saves then closes the window; 3-dot menu offers Delete and a `react-colorful` color picker. Added the missing `core:window:allow-close`/`allow-set-always-on-top`/`allow-set-size` capability grants, verified against the generated schema (`core:window:default` alone is read-only). Reviewer caught two real bugs, both fixed: (1) the top bar rendered the title from a static, never-updated prop, so editing the title below never reflected in the strip — fixed by lifting the live title state down as a prop; (2) the color picker defaulted to hardcoded black instead of the theme's actual `--primary` when no custom color was set, visually disconnected from what the strip displayed — fixed by resolving `--primary`'s live computed value to hex via `lib/themes/color.ts`'s existing `themeColorToPickerHex` helper (reused, not reimplemented). **Remaining concern, flagged not fixed**: this is the first place in the codebase nesting a real interactive widget (`react-colorful`'s picker) inside a `DropdownMenuSub`/`DropdownMenuSubContent` — the cited precedent (`AccountMenu.tsx`) turned out NOT to actually do this (its picker lives in a separate top-level dropdown), so there's no proven-safe precedent, and it couldn't be verified without live testing whether the submenu's own focus/typeahead management would swallow pointer/keyboard interaction inside the picker. Needs a manual check: open the 3-dot menu → "Change top bar color" and confirm dragging inside the color wheel works without the menu closing. `tsc --noEmit` passes.
- Subtask 10 (Sticky note bottom bar) — done. New `StickyNoteBottomBar.tsx` — bold/italic/strikethrough/bullet-list/task-list buttons (5 of the 6 requested; "underline" doesn't exist as a `formatActions.ts` action anywhere in this codebase, correctly flagged and omitted rather than invented), focus-gated like the top bar, reading live state against the sticky note's own local Tiptap instance. Refactored the window-focus-tracking effect out of `StickyNoteTopBar.tsx` and up into `StickyNoteEditor.tsx` so both bars share one Tauri `Window.onFocusChanged` listener instead of duplicating it — verified byte-for-byte identical to the original subtask-9 behavior after the move. Reviewer traced a genuine, deep bug through actual `@tiptap/react` internals: because this app's editors use Next.js's SSR-safe `immediatelyRender: false`, `editor` is `null` on first render, and `useEditorState`'s internal caching doesn't notify subscribers when the underlying editor later flips from null to real (only an actual ProseMirror transaction does) — so the bottom bar would stay invisible after opening a sticky note until the user's first click/keystroke primed the cache, no crash, just silently missing. Connected to a previously-documented instance of the exact same bug class already worked around elsewhere in the codebase (`TopBar.tsx`); fixed by mirroring that established pattern (falling back to computing the selector synchronously against the live editor when the cached snapshot is stale). Reviewer separately verified the action-id filter, that `TaskList`/`TaskItem` are genuinely registered, the top-bar refactor's fidelity, and no unintended interaction between the focus-tracking and unmount-flush effects. `tsc --noEmit` passes.
