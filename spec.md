# Skylines — Free-form canvas notes (merge note/canvas into one OneNote-style page)

## Goal

Replace the current "note" (linear Tiptap document) vs "canvas" (tldraw
drawing page) split with a single note type: every note is a free-form,
pannable canvas. Clicking anywhere on empty canvas creates a text box at
that point; typing into it uses the existing full Tiptap rich-text editor
(all formatting built in the prior spec — bold/italic/headings/lists/font/
color, the Format tab, the bubble menu). Ink/drawing tools remain available
on the same canvas (tldraw's existing toolbar). An empty text box
disappears when it loses focus. Middle-mouse-drag pans the canvas.

This is architecturally a merge, not a bolt-on: it reconciles "keep full
Tiptap formatting" with "ink and text coexist on one page" by building a
**custom tldraw shape that hosts a real Tiptap editor instance inside it**,
rather than either (a) rebuilding a bespoke canvas from scratch, or (b)
downgrading to tldraw's own plain-text shapes. tldraw's shape system
supports arbitrary React content per shape via a `ShapeUtil`, which is the
mechanism this relies on.

## Non-Goals

- **No changes to the notebook/section/sidebar hierarchy, ribbon shell,
  quick-access bar, account menu, or theme engine** built in the prior
  spec. This spec only changes what happens *inside* a single note's
  content area.
- **No multi-user real-time collaboration** on a single canvas (cursors,
  presence, etc.) — out of scope, unrelated to this request.
- **No text-box resize/rotate handle redesign beyond whatever tldraw's
  shape framework provides by default** — use the standard selection/resize
  UI tldraw already gives every shape, don't build custom resize handles.
- **No changes to the sync engine's core LWW/conflict-resolution logic**
  (`lib/sync/push.ts`/`pull.ts`/`cleanup.ts`) — the merged note's content
  keeps going through the exact same `canvasData` snapshot field and
  debounced-save path `components/canvas/CanvasEditor.tsx` already uses;
  this spec only changes what's *inside* that snapshot (shape types), not
  how it's synced.
- **Don't touch** notebook/folder CRUD, auth, `../note_taking_app`.

## Subtasks

Sequenced by dependency — the custom shape and tool come first since
everything else builds on them.

1. **`RichTextShape` — a custom tldraw shape hosting a Tiptap editor.**
   Define a tldraw `ShapeUtil` subclass (geometry: a resizable rectangular
   bounding box, like tldraw's own built-in text/note shapes) whose
   `component()` renders a `RichTextEditor`-equivalent Tiptap instance
   inside the shape's bounds, and whose `props` store that instance's
   content (Tiptap JSON), persisted as part of the shape the same way any
   other tldraw shape's props are — meaning it round-trips through
   `editor.getSnapshot()`/`loadSnapshot()` and the existing `canvasData`
   save path in `components/canvas/CanvasEditor.tsx` with no changes to
   that persistence mechanism. Register the shape with tldraw's
   `shapeUtils` config. No click-to-create interaction yet (subtask 2) —
   this subtask is just "the shape type exists, can be manually
   instantiated (e.g. via a test/spike route), renders/edits Tiptap
   content correctly, and survives a save/reload round-trip."
2. **Click-to-create tool.** A custom tldraw `StateNode`/tool (mirroring
   how tldraw's own built-in text tool works) that, on pointer-down over
   empty canvas, creates a `RichTextShape` at that point and immediately
   enters edit/focus mode on its Tiptap instance, ready for typing. Wire
   this as the default/primary interaction so clicking empty canvas "just
   works" without the user needing to explicitly select a tool first
   (check whether this should replace tldraw's default select-tool
   click-on-empty behavior, or coexist as a separate selectable tool —
   pick whichever reads more naturally given tldraw's existing toolbar
   still needs to expose ink/shape/select tools too).
3. **Empty-shape auto-delete on blur.** When a `RichTextShape`'s Tiptap
   editor loses focus (blur) and its content is empty (no text typed),
   delete the shape from the tldraw store. Verify this doesn't fire
   spuriously (e.g. a shape that already has real content, or one that's
   mid-creation, must never be deleted just because focus briefly moves
   elsewhere).
4. **Wire the existing Format tab / bubble menu to the focused shape's
   Tiptap instance.** The prior spec's `activeEditor` store field
   (`stores/appStore.ts`, set by `components/editor/RichTextEditor.tsx` on
   mount/unmount) assumed exactly one Tiptap instance per note. Now there
   can be many (one per `RichTextShape`), only one editable at a time.
   Update whichever shape currently has editing focus to be the one that
   sets `activeEditor`, and clear it when that shape loses focus (not on
   unmount, since shapes aren't mounted/unmounted the way page components
   are) — so the Format tab and bubble menu keep working exactly as before,
   now correctly targeting "whichever text box you're currently typing
   in."
5. **Verify middle-mouse-drag panning.** tldraw supports this by default;
   confirm it isn't disabled or conflicting with anything already
   customized in `components/canvas/CanvasEditor.tsx` (e.g. its own
   `editor.store.listen` autosave wiring, or the new click-to-create tool
   from subtask 2 potentially intercepting middle-clicks). Fix only if a
   real conflict is found — otherwise this subtask is verification, not
   new code.
6. **Merge note creation UI: retire the separate "New canvas" action.**
   `components/sidebar/Sidebar.tsx` and `FolderItem.tsx` currently have
   separate "New note" (Tiptap) and "New canvas" (tldraw) actions/icons.
   Collapse to one "New note" action that creates a note using the merged
   free-form-canvas editor. Retire `app/note/page.tsx` as a distinct
   full-page linear editor — all notes now route through (what is
   currently) `app/canvas/page.tsx`'s editor. Decide and implement whether
   `/note?id=...` redirects to `/canvas?id=...` for old bookmarks/links, or
   is removed outright (bias toward a redirect, cheap and avoids dead
   links from the note-history stack).
7. **Reconcile back/forward history and undo/redo with the merged model.**
   `stores/appStore.ts`'s `NoteHistoryEntry.type` (`"note" | "canvas"`,
   subtask 14 of the prior spec) and `components/topbar/TopBar.tsx`'s
   undo/redo (subtask 15, which assumed `activeEditor`/`activeCanvasEditor`
   were mutually exclusive *by route*) both need updating: with one merged
   note type, undo/redo must decide between "undo the focused text box's
   Tiptap edit" and "undo the last tldraw-level action (shape
   move/ink stroke/shape creation)" based on **actual focus state**, not
   route — building directly on subtask 4's focus-tracking. Update
   `NoteHistoryEntry`/back-forward routing accordingly now that there's
   only one destination route per note.
8. **Migrate existing linear-Tiptap notes into the merged format.** Any
   existing note with `type = "note"` and real `content` (Tiptap JSON) —
   convert it into `canvasData` containing exactly one `RichTextShape`
   (placed at a sensible default position, e.g. top-left) whose content is
   that note's original Tiptap document, then treat it as the merged type
   going forward. Run this as a one-time, idempotent migration (e.g.
   triggered lazily the first time an old-format note is opened, or as a
   startup pass over all of a user's notes — pick whichever is simpler and
   safer against partial-failure/interruption; must not lose data if
   interrupted partway through).

## Key Decisions

- **Built on a custom tldraw `ShapeUtil` hosting a real Tiptap instance**,
  not a bespoke free-form canvas and not a downgrade to tldraw's plain-text
  shapes. This is the reconciliation of two things the user wants
  simultaneously: full existing rich-text formatting fidelity, and ink/
  drawing tools coexisting on the same page. tldraw already solves pan/
  zoom/middle-mouse-drag/click-placement/selection/resize generically for
  any shape type; this spec adds one new shape type rather than
  reimplementing all of that from scratch.
- **One merged note type going forward** — the separate "canvas" note type
  (and its "New canvas" UI, its own Draw-tab-only-on-`/canvas`-route
  gating) goes away. The user was explicit that "canvas" was never meant
  to be a distinct note type, only a description of the free-form page
  behavior every note should have.
- **Existing notes are migrated, not left behind** — an old linear-Tiptap
  note becomes a canvas with one `RichTextShape` holding its original
  content, so no user data becomes inaccessible or second-class after this
  ships.
- **Undo/redo and back/forward history move from route-based to
  focus-based reasoning** — a necessary consequence of merging routes;
  built directly on the same focus-tracking subtask 4 already needs for
  the Format tab, rather than as separate new machinery.
- **Reuses the exact existing `canvasData` snapshot persistence/sync
  path** — no sync-engine or schema changes; the merged shape type is just
  new content inside a mechanism that's already proven and unchanged.

## Open Questions

- Exact undo/redo focus-detection heuristic (subtask 7) — e.g. does
  clicking away from a text box mid-edit but before any tldraw-level
  action count as "tldraw is now focused," or does undo/redo need a short
  grace period / last-known-focus memory to feel natural? Left to
  implementation-time judgment and manual testing, since this is a feel/UX
  question hard to fully resolve on paper.
- Whether `RichTextShape`'s default size/position on creation (subtask 2)
  should auto-grow with typed content (like OneNote's actual text boxes,
  which expand as you type) or stay at a fixed initial size requiring
  manual resize — auto-grow is closer to OneNote's real behavior and
  probably expected, but left as an implementation-time call informed by
  what tldraw's shape framework makes easy/idiomatic.
- Whether the one-time migration (subtask 8) should run automatically and
  silently, or surface any UI/confirmation to the user before converting
  their existing notes — leaning toward silent/automatic (consistent with
  how every other migration in this project has worked so far), but
  flagging since it's a real, irreversible-in-place data transformation
  worth a deliberate choice rather than an assumption.

## Progress
