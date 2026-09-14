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
