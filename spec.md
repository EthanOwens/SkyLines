# Sticky note polish, theme editor trim, link dialog fixes, image editor

## Goal

Second round of sticky-note polish plus a handful of other fixes, driven by
planning.md's latest 5 items:

1. Sticky note windows lose their native OS titlebar; the existing colored
   top bar becomes the real title bar / drag handle.
2. Rework focus/blur behavior: double-clicking the top bar is what now
   triggers the "collapse to just the title bar" resize (previously this
   happened automatically on blur). Losing focus without double-clicking no
   longer resizes the window — instead the bottom formatting bar fades out
   and the top bar becomes slimmer, while the window itself stays full size.
3. Sticky notes home page: right-click a preview card for rename/delete/
   favorite; small favorited/opened badges on each card; favorited notes
   get their own row(s) at the top.
4. Theme editor: trim the editable field list down to only the CSS
   variables `ThemePreview.tsx`'s mini preview actually renders, group them
   under collapsible sections, and make `radius` friendlier to edit than a
   raw text field.
5. Fix the "insert link" dialog not being closable, give it a real Ctrl+K
   keybinding, and turn its existing-sticky-notes list into toggleable
   rows/mini-previews (same toggle also added to the sticky notes home
   page).
6. A pop-out image editor: double-click any image anywhere in the app to
   open it in an editor with draw (+undo), shapes, censor (black/blur),
   text, erase, and crop tools; Ctrl+C copies the edited image to the
   clipboard with a save-flash; edits are also written back into the
   note/page the image came from.

## Non-goals

- Not touching `ScreenshotCapture.tsx`'s existing pre-save freehand-draw
  annotation flow (capturing a window, doodling before creating the note) -
  the new image editor targets images already placed in a note/page, this
  stays as-is.
- Not changing what `pinned` means (always-on-top) - "favorite" (item 3) is
  a new, separate field, not a rename or reuse of `pinned`.
- Not adding more visual regions to `ThemePreview.tsx` itself to justify
  keeping more fields - planning.md says remove what isn't shown "for now."
- Not redesigning the sticky note pop-out window's size/position logic
  beyond what items 1-2 require.
- Not building undo/redo for anything outside the image editor's own
  canvas (e.g. this doesn't touch tldraw's or Tiptap's undo stacks).

## Key decisions

- Item 6 (image editor) stays in this spec rather than becoming its own
  follow-up, per explicit choice - same as last time's "include everything"
  call for sticky notes.
- Image editor edits ARE written back into the source note/page (not
  clipboard-only) - Ctrl+C to clipboard is an additional action, not the
  only way to keep a change.
- "Insert link can't be exited" has no confirmed root cause from static
  reading (the dialog's close button/Cancel/Escape/backdrop-dismiss all
  looked structurally normal in `LinkOrStickyDialog.tsx`) - scoped as a
  reproduce-and-fix subtask rather than a guessed patch.
- Favorited/opened get two distinct icons on preview cards, not one
  combined indicator, since a note can be both at once.
- "Opened" state is derived by checking for a live `sticky-<id>` labeled
  window (`getAllWindows`/`getByLabel`), not a separate DB flag - clicking
  an "opened" badge focuses that window instead of creating a duplicate
  (this already partly happens via `openStickyNoteWindow`'s reuse logic).
- Clipboard image support uses `@tauri-apps/plugin-clipboard-manager`
  (its `writeImage` API), a new dependency - not currently installed.
- Theme editor field trim: keep only `background`, `foreground`, `card`,
  `card-foreground`, `sidebar`, `sidebar-foreground`, `sidebar-border`,
  `sidebar-primary`, `sidebar-accent`, `primary`, `border`, `radius`
  (the only vars `ThemePreview.tsx` actually uses); drop `muted`,
  `muted-foreground`, `popover`, `popover-foreground`,
  `primary-foreground`, `secondary`, `secondary-foreground`, `accent`,
  `accent-foreground`, `destructive`, `input`, `ring`,
  `sidebar-primary-foreground`, `sidebar-accent-foreground`.

## Open questions

- None blocking - remaining ambiguity in item 5/6 (exact dialog bug cause,
  exact censor/erase tool implementation) is intentionally left for the
  implementor/reviewer to resolve during the loop rather than guessed here.

## Subtasks

1. **Frameless sticky note window + native drag region.** In
   `lib/stickyWindow.ts`, create sticky windows with `decorations: false`.
   In `StickyNoteTopBar.tsx`, mark the top bar's root div
   `data-tauri-drag-region` so dragging it moves the OS window, while
   excluding the actual buttons (pin/menu/exit) from the drag region so
   they stay clickable. Title text stays visible; no other chrome changes.

2. **Add a `favorite` field to sticky notes.** New sqlite migration
   (version 8) adding a `favorite` column to `sticky_notes` (mirrors how
   `pinned` was added), plus `types/index.ts`'s `StickyNote` interface and
   `lib/db/stickyNotes.ts`'s CRUD/sync functions (`updateStickyNote` support,
   remote upsert mapping). Distinct from `pinned` (always-on-top) - do not
   touch `pinned`'s existing behavior.

3. **Rework focus/blur: manual collapse via double-click, passive blur via
   fade/slim (no resize).** In `StickyNoteEditor.tsx`/`StickyNoteTopBar.tsx`:
   double-clicking the top bar triggers the exact resize-to-
   `COLLAPSED_HEIGHT` behavior that currently happens automatically on
   blur (toggle: double-click again, or focus, restores
   `originalSizeRef`'s size). Losing focus without a manual collapse no
   longer calls `win.setSize` at all - instead `StickyNoteBottomBar` fades
   out (opacity/height transition, not unmount) and the top bar shrinks in
   height/padding while keeping the title readable. Regaining focus
   reverses both. A manually-collapsed note that then loses window focus
   should stay collapsed (collapse state and focus state are independent).

4. **Right-click context menu on sticky note preview cards.** In
   `StickyNotesHome.tsx`, add a context menu (reuse the existing
   `components/ui/dropdown-menu.tsx` primitives, triggered via
   `onContextMenu` + a controlled open position, or a proper
   `ContextMenu` primitive if one already exists in `components/ui`) with
   Rename (inline edit of `title`), Delete (reuse existing delete logic),
   and Favorite/Unfavorite (toggles the new `favorite` field).

5. **Favorited/opened badges + favorited rows on the home page.** In
   `StickyNotesHome.tsx`: query which sticky notes currently have a live
   `sticky-<id>` window open (Tauri `getAllWindows()`, filter by label
   prefix) each time the dialog opens; render two small distinct icons in
   each card's bottom-right corner (favorite star, "currently open"
   indicator) when applicable. Clicking the "opened" badge focuses that
   window (`Window.setFocus`) instead of just calling
   `openStickyNoteWindow` again (though that already reuses the window,
   per existing logic - confirm/align). Split the grid into a "Favorites"
   section (one or more rows, only rendered when at least one note is
   favorited) above the regular grid.

6. **Trim theme editor fields to what the mini preview shows.** In
   `ThemeEditor.tsx`'s `THEME_VARIABLE_GROUPS`, remove every key not in
   the kept list from "Key decisions" above, and drop now-empty groups
   entirely (e.g. "Popover", "Destructive" if nothing remains). Don't
   touch `lib/themes/types.ts`/`builtin.ts`/`app/globals.css` - these
   variables still exist and are still applied, just not editable from
   this trimmed list.

7. **Collapsible sections + friendlier radius control in theme editor.**
   Wrap each remaining `THEME_VARIABLE_GROUPS` section in a
   collapsible/accordion (reuse an existing primitive if
   `components/ui` has one, otherwise a small local disclosure component
   matching this app's existing style) defaulting to expanded. Replace the
   raw `radius` text/number input with a friendlier control - a slider
   with a live numeric readout is the natural fit given `ThemePreview.tsx`
   already live-updates as `draftVariables` change.

8. **Investigate and fix: insert-link dialog can't be exited.** Reproduce
   with `LinkOrStickyDialog.tsx` opened from both `RichTextEditor.tsx`
   (full-page notes) and `RichTextShape.tsx` (canvas shape) and find the
   actual cause (candidates worth checking first: tldraw's own keyboard/
   pointer handling intercepting Escape or outside-clicks when the dialog
   is opened from a canvas shape; `onOpenChange` never actually reaching
   the parent's `setLinkDialogOpen`; some effect re-forcing `open` back to
   true). Fix whatever's actually wrong; don't guess-patch without
   reproducing.

9. **Real Ctrl+K keybinding for the link dialog.** Currently nothing binds
   Ctrl+K anywhere - the dialog only opens via a toolbar button. Add a
   real keydown handler (editor-scoped, e.g. a Tiptap keyboard shortcut or
   an `editorProps.handleKeyDown`) in both `RichTextEditor.tsx` and
   `RichTextShape.tsx` that opens `LinkOrStickyDialog` the same way the
   existing toolbar button does, pre-filling `currentUrl` the same way.

10. **Toggleable rows/mini-preview for existing sticky notes, in both the
    link dialog and the home page.** In `LinkOrStickyDialog.tsx`, change
    the flat list of existing-sticky-note buttons into rows, each with a
    toggleable mini content preview (reuse `extractPlainText` for a text
    snippet; if the note's content is image-only, show a tiny thumbnail)
    alongside the title, gated by a small toggle button in the dialog
    (title-only vs. mini-preview rows). Add the same toggle to
    `StickyNotesHome.tsx`'s own grid (title-only vs. current
    preview-card view), persisting the choice isn't required unless
    trivial to add (e.g. local component state is fine).

11. **Clipboard image support.** Add `@tauri-apps/plugin-clipboard-manager`
    (npm package + Rust crate), register the plugin in `src-tauri/src/lib.rs`,
    and grant its default capability in `src-tauri/capabilities/default.json`
    (and `sticky.json`, since the image editor opens from sticky notes too -
    see subtask 12). No UI yet - just wiring, confirmed with a minimal
    smoke check that `writeImage` is callable.

12. **Image editor pop-out shell.** New window (or dialog, matching
    whichever pattern fits better given it needs to feel like a real
    pop-out per planning.md's wording - a `WebviewWindow` mirroring
    `lib/stickyWindow.ts`'s pattern is the closer fit) that opens when any
    `img` inside Tiptap-rendered content (`RichTextEditor.tsx`,
    `RichTextShape.tsx`, `StickyNoteEditor.tsx`) is double-clicked. Loads
    the image onto an editing `<canvas>` at natural resolution. No tools
    yet - just the shell, image load, and a way to close it.

13. **Undo-stack draw tool.** Freehand draw tool (reuse the pointer-
    tracking approach `ScreenshotCapture.tsx` already uses as a reference,
    but on its own layer/undo stack) with Ctrl+Z stepping back through a
    history of canvas snapshots or draw operations.

14. **Shape tool.** Click-and-drag to place basic shapes (rectangle,
    ellipse, line at minimum) onto the image, participating in the same
    undo stack as subtask 13.

15. **Censor tool.** Click-and-drag a box that applies either a solid
    black fill or a blur effect (toggle between the two) to that region,
    baked into the image, participating in the same undo stack.

16. **Text tool.** Click to place editable text onto the image (font size/
    color reasonable defaults, no need to match the full rich-text
    toolbar), baked in on commit, participating in the same undo stack.

17. **Erase and crop tools.** Erase: a hard eraser removing pixels back to
    the original loaded image in the brushed area (or transparent, if
    that reads better given images are usually opaque - implementor's
    call). Crop: click-and-drag a crop rectangle, with a confirm action
    that trims the canvas to that region. Both participate in the same
    undo stack.

18. **Save-back-to-note + Ctrl+C clipboard export with flash feedback.**
    Closing the editor (or an explicit save action) re-encodes the baked
    canvas as a data URL and updates the source `img` node's `src` in the
    original note/page's Tiptap content (persisted via that surface's
    existing save path - `updateStickyNote`, the canvas shape's own
    update, or the page note's own autosave, whichever the image came
    from). Ctrl+C while the editor is open copies the current baked image
    to the OS clipboard via subtask 11's `writeImage`, and shows a brief
    visual flash + "Copied to clipboard" text.

## Progress

1. Frameless sticky note window + native drag region — `lib/stickyWindow.ts` creates sticky windows with `decorations: false`; `StickyNoteTopBar.tsx`'s outer bar div got `data-tauri-drag-region` so it acts as the drag handle. Review flagged that removing native decorations also removed the OS minimize control with nothing replacing it — fixed by adding a Minimize button (`getCurrentWindow().minimize()`) to the top bar's button row. Remaining: possible Linux edge-resize loss under frameless+resizable (not fixed, likely out of scope — app targets Windows); drag-region/button-click interaction not manually verified in a live build.

2. Add a `favorite` field to sticky notes — new sqlite migration (version 8, `sticky_notes.favorite`), `StickyNote.favorite: boolean`, and every CRUD/sync path in `lib/db/stickyNotes.ts` (row mapping, remote upsert, create, update) mirrors `pinned` exactly, fully independent of it. Data-layer only, no UI. Reviewer found no issues.
