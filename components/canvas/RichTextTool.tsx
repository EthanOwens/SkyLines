"use client";

// spec.md subtask 2 ("Click-to-create tool"). A custom tldraw `StateNode`
// tool that mirrors the *architecture* of tldraw's own built-in text/note
// tools (see node_modules/tldraw/src/lib/shapes/text/TextShapeTool.ts and
// node_modules/tldraw/src/lib/shapes/note/NoteShapeTool.ts for the reference
// patterns this follows: a top-level `StateNode` with an `idle` child that
// creates a shape on pointer-down and immediately starts editing it), but
// deliberately diverges from those built-ins in one important way explained
// below.
//
// DIVERGENCE FROM TLDRAW'S BUILT-IN TEXT/NOTE TOOLS - read before editing:
// tldraw's own text/note tools, after creating+editing a shape, hand control
// back to the *select* tool (via `startEditingShapeWithRichText`, which
// calls `editor.setCurrentTool('select.editing_shape', ...)`). That's right
// for tldraw's stock UX, where these are one-shot tools you explicitly
// reselect for each shape (unless "tool lock" is toggled in the toolbar).
//
// spec.md subtask 2 explicitly wants the opposite default: this tool IS the
// primary/default interaction for a freshly-opened note, and clicking empty
// canvas repeatedly must keep creating independent shapes without the user
// re-selecting a tool each time (see spec.md's verification bullet "Click on
// empty canvas a second time, elsewhere: confirm a SECOND independent shape
// is created").
//
// Getting this right needs one more piece beyond the tool itself, discovered
// via live CDP verification (not guessable from reading this tool's own code
// in isolation): tldraw's OWN framework - not this tool - automatically force
// -switches `currentTool` to `select.editing_shape` any time
// `editingShapeId` flips from null to non-null and the editor isn't already
// in `select.editing_shape` (see node_modules/tldraw/src/lib/
// defaultSideEffects.ts's `instance_page_state.afterChange` handler). That
// fires from our own `editor.setEditingShape()` call below, unconditionally,
// regardless of which tool set it - there's no flag to opt out. So right
// after creating+editing a shape, `currentTool` really is `select`, not
// `rich-text` - confirmed live: polling `editor.getCurrentToolId()`
// immediately (no intervening clicks) after a create-shape pointer-down
// showed `select`, not `rich-text`.
//
// `installRichTextToolAutoReturn` (below, wired up once per note in
// CanvasEditor.tsx) is this tool's answer to that: when a shape THIS tool
// created finishes its edit session (editingShapeId clears) as the direct
// result of the user clicking elsewhere, switch back to `rich-text` so the
// next click on empty canvas creates another shape - the same sticky-tool
// effect tldraw's own text tool gets from "tool lock" mode, reimplemented
// here because tldraw's built-in tool-lock/return-to-tool logic (also in
// defaultSideEffects.ts) is hardcoded to shape type `'text'` only, not
// generic to custom shape types. Shapes created via this tool's own
// click-to-create flow are tracked in a transient, session-scoped set (see
// below) specifically so this auto-return ONLY fires for shapes *this* tool
// just created and is now finishing its own edit session for - not for a
// shape a user explicitly double-clicked into edit mode via the Select tool,
// which must keep behaving like normal tldraw (see spec.md's verification
// bullet about the Select tool remaining genuinely independent).
//
// One more subtlety, also only found by live-testing rather than guessable
// from source: naively auto-returning any time `editingShapeId` clears AND
// `editor.isIn('select.idle')` is true is NOT enough to distinguish "user
// clicked elsewhere on the canvas to keep creating" from "user explicitly
// clicked the real Select toolbar button while still mid-edit" - both
// settle into the identical final `select.idle` state (the Select toolbar
// button's own `onSelect`, see node_modules/tldraw/src/lib/ui/hooks/
// useTools.tsx, forces an exit+enter of the `select` branch specifically so
// it works from ANY of select's sub-states, including `editing_shape`).
// Live-tested confirmation: naively checking only `isIn('select.idle')`
// caused clicking a raw `setCurrentTool('select')` call while still
// mid-edit to incorrectly bounce back to `rich-text` on the very next
// canvas click, defeating the "Select tool is genuinely independent"
// requirement. The fix is to additionally require
// `editor.inputs.getIsPointing()` - true only while this callback is firing
// as a nested side effect of a REAL, in-flight pointer_down dispatch (see
// Editor.ts's `dispatch()`, which sets `inputs.isPointing = true` before
// invoking the state chart that eventually calls `setEditingShape(null)`)
// - which is only true for "clicked elsewhere on the canvas", never for an
// out-of-band `setCurrentTool`/toolbar-button call (those never go through
// `editor.dispatch()`'s pointer-event pipeline at all).
//
// Shapes THIS tool creates via its own click-to-create flow are tracked in a
// transient, in-memory, session-scoped `Set<TLShapeId>` (`shapesCreatedByThisTool`
// below) rather than a permanent `meta` flag on the shape itself. A permanent
// flag would misfire: tldraw's OWN Select tool reaches the identical
// `editingShapeId -> null` exit path (with `inputs.isPointing` still true)
// whenever a user double-clicks an existing shape via Select to edit it and
// then clicks away - completely ordinary, unrelated to this tool's
// click-to-create flow. A shape tagged forever at creation time would cause
// `installRichTextToolAutoReturn` to hijack that later, unrelated Select-tool
// edit session and force-switch back to `rich-text`, yanking the user out of
// whatever tool they were actually using. The set is populated only when
// `PointingCanvas`'s click-create action (below) itself creates a shape, and
// the id is removed the first time the auto-return check consumes it
// (whether or not it decides to auto-return) - a one-time "was this exact
// edit session opened by the click-to-create flow" check, not a permanent
// property of the shape.
//
// One consequence of staying persistently active: unlike the stock text/note
// tools (which never check what's under the pointer - see those tools'
// `Pointing` states, which create a shape unconditionally), THIS tool does
// check what's under the pointer before creating, because with a one-shot
// tool an overlapping click-on-existing-shape is rare (you'd have to
// deliberately reselect the tool over a shape you just made), but with this
// persistently-active tool it would happen constantly - every subsequent
// click meant to edit/select an existing shape would otherwise stamp a new
// overlapping shape on top of it. So: clicking an existing `rich-text` shape
// enters edit mode on THAT shape instead of creating a duplicate (matching
// this note-taking app's overall click-to-type philosophy - click a box to
// type in it, whether it's new or existing); clicking any other shape type
// (e.g. a future ink/draw stroke) is a no-op, since drawing back into
// edit-on-click for a non-text shape wouldn't make sense.
//
// IMPORTANT, non-obvious tldraw quirk found only via live CDP testing (do
// NOT naively trust `info.target === 'shape'` here): the raw pointer_down
// dispatched by tldraw's own canvas-level DOM listener (see
// node_modules/@tldraw/editor/src/lib/hooks/useCanvasEvents.ts) ALWAYS sets
// `target: 'canvas'`, unconditionally - there is no automatic real-DOM-based
// "was a shape clicked" resolution (confirmed: RichTextShape.tsx's own
// wrapper element deliberately sets `pointer-events: none` while not
// editing, per that file's header comment, for entirely unrelated reasons -
// tldraw's shape components in general get no pointer listeners of their
// own at all, see @tldraw/editor's Shape.tsx/DefaultShapeWrapper.tsx).
// Individual tools that need "was a shape clicked" (e.g. tldraw's own
// `EditingShape` select-tool state, see its `case 'canvas'` branch) do their
// OWN geometry-based hit test and manually upgrade the target - this tool
// does the same, via the same public helper tldraw's own select tool uses
// (`getHitShapeOnCanvasPointerDown`, exported from the `tldraw` package).
// Live-tested: without this, clicking squarely on top of an existing
// rich-text shape was silently stamping a duplicate underneath it instead of
// editing it, because `info.target` was always `'canvas'`.
//
// spec.md (new spec) subtask 3 ("Click vs. click-drag distinction"). Below,
// the single `Idle.onPointerDown` that used to act immediately has been
// split into a small state machine that mirrors tldraw's OWN Select tool's
// click-vs-drag chart (`Idle` -> `PointingCanvas`/`PointingShape` -> either
// resolves as a plain click on pointer-up, or - once real drag distance is
// detected - hands off to tldraw's REAL marquee-select (`Brushing`) or
// REAL shape-translate (`Translating`) behavior; see
// node_modules/tldraw/src/lib/tools/SelectTool/childStates/{PointingCanvas,
// PointingShape,Brushing,Translating}.ts, which this directly parallels).
//
// One thing this tool does NOT do, after investigating it live: reuse the
// `Brushing`/`Translating` *classes* directly as extra child states of this
// tool. `tldraw`'s package.json declares an `"exports"` map restricted to
// `"."` and `"./tldraw.css"` only - `Brushing`/`Translating`/`PointingShape`/
// `PointingCanvas` are only reachable from `tldraw/src/lib/tools/SelectTool/
// childStates/*`, a subpath excluded from that map, so `import ... from
// 'tldraw/src/...'` is rejected by both `tsc` (moduleResolution: "bundler"
// respects "exports") and by Next.js's own bundler at build time - confirmed
// by attempting it. tldraw's own public API only exports the top-level
// `SelectTool` class itself (`export { SelectTool } from
// './lib/tools/SelectTool/SelectTool'` in tldraw's index.ts), not its
// children individually.
//
// Instead, this hands the ACTIVE GESTURE off to the REAL, already-registered
// `select` tool instance living in this same editor (tldraw always registers
// `select` alongside custom `tools`, confirmed live and via
// CanvasEditor.tsx's `tools` prop, which is merged with - not instead of -
// tldraw's default tool set): `editor.setCurrentTool('select')` makes it the
// active tool, then `.transition('brushing'|'translating', info)` (a public
// `StateNode` method) drives it straight into tldraw's OWN real brush-select
// or shape-translate state - the exact same code path tldraw's own Select
// tool uses, not a reimplementation. Confirmed via live CDP testing that this
// produces working marquee-select (real shapes end up in
// `editor.getSelectedShapeIds()`) and working shape-translate (the shape's
// x/y genuinely change by the drag delta) - see this file's git history /
// PR description for the concrete verification transcript.
//
// Since that hand-off genuinely switches `editor.getCurrentToolId()` away
// from `rich-text` (unlike `setCurrentToolIdMask`, which only changes what
// `getCurrentToolId()` *reports* while leaving the real active tool
// unchanged, and which doesn't help here since our own tool's state chart
// needs to be genuinely inert while the borrowed `select` states are
// running), `watchForReturnToSelectIdle` (below) is this tool's answer to
// getting back to `rich-text` afterward, so the sticky "always ready to
// click-to-create/edit" behavior these verification bullets depend on isn't
// broken by a marquee-select or shape-drag gesture - the same kind of
// one-shot, this-tool-scoped bookkeeping problem `installRichTextToolAutoReturn`
// already solves for the edit-session case above, solved the same way here
// for the brush/translate case: a one-shot reactive watcher (tldraw's own
// `react()`, re-exported from `@tldraw/state` all the way through `tldraw`'s
// public index) that fires exactly once, the first time `select` genuinely
// settles back into `select.idle` WITH AN EMPTY SELECTION (not idle alone -
// see `watchForReturnToSelectIdle`'s own comment below for why: staying on
// `select` for as long as a selection persists is what keeps resize/rotate
// handles, native Delete, and further drag-to-move working, since tldraw
// only wires those up while `currentTool` is genuinely `select`), then
// switches back to `rich-text` and tears itself down. One accepted UX
// consequence: after a marquee-select or shape-drag, the next click on empty
// canvas deselects (native `select`-tool behavior) rather than immediately
// creating a new shape; only the click after that (once back on `rich-text`)
// creates one.
import {
  StateNode,
  createShapeId,
  getHitShapeOnCanvasPointerDown,
  react,
  type Editor,
  type TLPointerEventInfo,
  type TLShape,
  type TLShapeId,
  type TLStateNodeConstructor,
} from "@tldraw/tldraw";
import { useAppStore } from "@/stores/appStore";
import type { RichTextShape } from "./RichTextShape";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 200;

// See this file's header comment - transient, in-memory, session-scoped
// tracking of shape ids created by this tool's own click-to-create flow, so
// `installRichTextToolAutoReturn` below can tell them apart from shapes a
// user edited via some other route (e.g. the Select tool's own
// double-click-to-edit). Deliberately NOT persisted on the shape itself
// (e.g. via `meta`) - see this file's header comment for why a permanent
// flag would misfire on later, unrelated Select-tool edit sessions of the
// same shape.
const shapesCreatedByThisTool = new Set<TLShapeId>();

// spec.md (new spec) subtask 3. Hands an in-flight canvas-pointer-down
// gesture off to the real `select` tool's real `brushing` (marquee/
// rubber-band select) state - see this file's header comment for why this
// reuses tldraw's OWN `Brushing` implementation (via the already-registered
// `select` tool instance) rather than a reimplementation, and why a plain
// `import` of the `Brushing` class itself isn't possible. `currentTool`
// stays on `select` - not `rich-text` - for as long as the resulting
// selection is non-empty (see `watchForReturnToSelectIdle`), so the marquee
// selection's resize/rotate handles, Delete, and further drag-to-move all
// work natively once this settles.
function handOffToBrushing(editor: Editor, info: TLPointerEventInfo & { target: "canvas" }) {
  const selectTool = editor.getStateDescendant("select");
  if (!selectTool) return;
  editor.setCurrentTool("select");
  selectTool.transition("brushing", info);
  watchForReturnToSelectIdle(editor);
}

// spec.md (new spec) subtask 3, point 4 ("drag on an existing shape should
// move it"). Hands an in-flight canvas-pointer-down gesture (that started on
// an existing, interactable shape) off to the real `select` tool's real
// `translating` state - same reasoning/mechanism as `handOffToBrushing`
// above. Selects the dragged shape first, mirroring tldraw's own
// `PointingShape.startTranslating` (`Translating.onEnter` bails out to
// `idle` immediately if nothing is selected). Same as `handOffToBrushing`:
// `currentTool` stays on `select` (not `rich-text`) for as long as the
// dragged shape stays selected (see `watchForReturnToSelectIdle`).
function handOffToTranslating(
  editor: Editor,
  info: TLPointerEventInfo & { target: "shape"; shape: TLShape },
) {
  const selectTool = editor.getStateDescendant("select");
  if (!selectTool) return;
  editor.markHistoryStoppingPoint("selecting shape");
  editor.setSelectedShapes([info.shape.id]);
  // Re-focus the editor, just in case a shape's own text label/content
  // stole DOM focus - same defensive call tldraw's own
  // `PointingShape.startTranslating` makes before transitioning.
  editor.focus();
  editor.setCurrentTool("select");
  selectTool.transition("translating", info);
  watchForReturnToSelectIdle(editor);
}

// M1 subtask 2 originally added a `handOffToSelectionHandle` function here
// (gated on `Idle.onPointerDown` seeing `info.target === 'selection'`) to
// hand a pointer-down on a resize/rotate handle off to the real `select`
// tool's `pointing_resize_handle`/`pointing_rotate_handle` states. It was
// REMOVED after the fix to `watchForReturnToSelectIdle` below made it
// permanently unreachable dead code - not just unreachable due to the timing
// bug that fix addresses, but unreachable for a more fundamental reason that
// no fix to this file's own watcher logic could ever change:
//
// tldraw only makes selection resize/rotate handle DOM elements receive real
// pointer events while `editor.isInAny('select.idle', 'select.pointing_selection',
// 'select.pointing_shape', 'select.crop.idle')` is true (see
// `TldrawSelectionForeground.tsx`'s `shouldDisplayControls`; outside those
// states the handle elements get a `tl-hidden` class with
// `pointer-events: none`). That condition can only be true while
// `editor.getCurrentToolId()` is genuinely `'select'` - never while it's
// `'rich-text'`. But `info.target === 'selection'` can only ever reach
// `Idle.onPointerDown` in the first place if OUR tool (`rich-text`) is the
// one receiving the pointer-down, i.e. `currentTool === 'rich-text'`. Those
// two conditions ("select" active for handles to be interactive vs.
// "rich-text" active for our own `Idle` to see the event at all) are
// mutually exclusive - so a real DOM pointer-down with `target: 'selection'`
// can never reach this tool's `Idle` state, regardless of what
// `watchForReturnToSelectIdle` does.
//
// This is also why the fix below is the right one and not just a smaller
// patch: every place in this file that ever selects shapes
// (`createShapeAtOrigin`, `PointingShape.performClickAction`,
// `handOffToTranslating`) immediately hands off to `select`/`select.editing_shape`
// in the same call, so `currentTool` is never left on `rich-text` with a
// non-empty selection by this file's own code. The one remaining case checked
// live/via source (tldraw's own Ctrl+A `select-all` action, see
// node_modules/tldraw/src/lib/ui/context/actions.tsx's `mustGoBackToSelectToolFirst`)
// force-switches `currentTool` to `'select'` itself before selecting, so it
// doesn't violate this either. Net effect: whenever `rich-text` is genuinely
// active, the selection is empty, so there is never a legitimate handle for
// `Idle.onPointerDown` to hand off in the first place - resize/rotate/Delete/
// further-drag on an existing selection are now handled entirely by keeping
// `currentTool` on the real `select` tool for as long as the selection is
// non-empty (see `watchForReturnToSelectIdle` below), not by any hand-off
// code in this tool's own chart.

// One-shot reactive watcher: the first time the real `select` tool (driving
// a brush-select or shape-translate gesture this tool just handed off to,
// per the two functions above) genuinely settles back into `select.idle`
// WITH AN EMPTY SELECTION, switch back to `rich-text` and tear this watcher
// down. Deliberately requires BOTH conditions, not `select.idle` alone:
// tldraw only makes a selection's resize/rotate handles (and native
// Delete/Backspace, drag-to-move, etc.) interactive while `currentTool` is
// genuinely `select` (see the removed-`handOffToSelectionHandle` comment
// above for the precise mechanism) - if this watcher switched back to
// `rich-text` as soon as `select.idle` was reached, a marquee-select or
// shape-translate hand-off would settle into `select.idle` WITH a live
// selection still showing, immediately get yanked back to `rich-text`, and
// silently lose all of that native handle/Delete/drag behavior (handle DOM
// elements go non-interactive, and tldraw's own Delete action requires
// `editor.isIn('select')`). By staying on `select` for as long as the
// selection is non-empty, all of that native `select`-tool behavory just
// works, with no extra hand-off code needed. Once the user clicks empty
// canvas to deselect (while still within the native `select` tool, which
// just deselects - it does NOT create a rich-text shape), the selection
// becomes empty while still `select.idle`, and only then does this watcher
// fire and hand control back to `rich-text` - so, as an accepted UX
// consequence, the very next click after selecting something deselects
// rather than immediately creating a new shape; a second click (now back on
// `rich-text`) is what creates one. See this file's header comment for why
// this is needed at all (unlike `installRichTextToolAutoReturn`'s
// `editingShapeId`-keyed problem, this one isn't a document/record-store
// change tldraw's `sideEffects` can observe - tool-chart transitions and
// selection are pure in-memory `StateNode`/signal state - hence tldraw's own
// fine-grained-reactivity `react()`, not a store listener; `editor.isIn(...)`
// and `editor.getSelectedShapeIds()` are both backed by tldraw's own reactive
// signals - see `Editor.isIn`/`Editor.getSelectedShapeIds` in
// @tldraw/editor's `Editor.ts`, both implemented as/derived from `@tldraw/state`
// atoms/computeds - so `react()` re-running whenever either changes, and
// staying alive/re-evaluating rather than firing early, is exactly the
// reactivity `react()` provides, not an assumption specific to this file).
function watchForReturnToSelectIdle(editor: Editor) {
  const stop = react("rich-text tool: return from select brush/translate hand-off", () => {
    if (!editor.isIn("select.idle")) return;
    if (editor.getSelectedShapeIds().length > 0) return;
    stop();
    // Success path: the reactor already tore itself down above, so remove
    // its entry from `editor.disposables` too (added below) - otherwise
    // `disposables` would accumulate a dead, already-stopped entry for every
    // brush/translate hand-off over a long session (each entry is a no-op if
    // `editor.dispose()` later re-invokes it, but there's no reason to let
    // them pile up).
    editor.disposables.delete(stop);
    editor.setCurrentTool("rich-text");
  });
  // If the editor is disposed while this gesture is still in flight (e.g.
  // the user closes/switches the note mid-drag, before `select` ever
  // reaches `idle`), make sure this reactor is torn down too - otherwise it
  // keeps a live subscription and a closure over a now-disposed `editor`,
  // and could wrongly fire `setCurrentTool('rich-text')` (hijacking whatever
  // tool/note is active later) if `select.idle` is ever reached again for
  // any unrelated reason. Same pattern `installRichTextToolAutoReturn` uses
  // for its own cleanup.
  editor.disposables.add(stop);
}

// spec.md (new spec) subtask 3. This tool's own click-vs-drag decision for
// "pointer went down on empty canvas, or on a shape this tool can't/won't
// interact with (locked, or a non-editable rich-text shape)" - mirrors
// tldraw's own `SelectTool/childStates/PointingCanvas.ts`. On pointer-up
// without real drag distance, performs exactly what a plain click did
// before this subtask (create a new shape at the origin point). On real
// drag distance, hands off to tldraw's real marquee-select instead (see
// `handOffToBrushing` above) - no shape is created for a click-and-drag.
class PointingCanvas extends StateNode {
  static override id = "pointing_canvas";

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return;
    // Real drag distance confirmed - this is a click-AND-DRAG starting on
    // empty canvas (or a locked/non-editable shape, per the routing in
    // `Idle.onPointerDown` below), not a plain click. Reset this tool's own
    // chart back to idle first (mirrors `PointingCanvas.ts`'s pattern of
    // always ending in a clean `idle` transition), THEN hand the still-live
    // gesture off to tldraw's real marquee-select.
    this.parent.transition("idle");
    handOffToBrushing(this.editor, info as TLPointerEventInfo & { target: "canvas" });
  }

  override onPointerUp() {
    this.createShapeAtOrigin();
    this.complete();
  }

  override onComplete() {
    this.complete();
  }

  override onCancel() {
    this.complete();
  }

  override onInterrupt() {
    this.parent.transition("idle");
  }

  private complete() {
    this.parent.transition("idle");
  }

  // Exactly the "create a new shape" behavior `Idle.onPointerDown` performed
  // unconditionally before this subtask - see this file's header comment for
  // the full reasoning (mirrors tldraw's own text/note tools' create-on-
  // pointer-down behavior, adapted to fire on a confirmed CLICK rather than
  // on pointer-down itself).
  private createShapeAtOrigin() {
    const { editor } = this;

    editor.markHistoryStoppingPoint("creating rich text shape");

    const id = createShapeId();
    const point = editor.inputs.getOriginPagePoint();

    editor.createShape<RichTextShape>({
      id,
      type: "rich-text",
      x: point.x,
      y: point.y,
      props: { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, content: null },
    });

    // Track this shape as created by this tool's own click-to-create flow
    // for the CURRENT edit session only (see this file's header comment and
    // `shapesCreatedByThisTool`'s own comment) - consumed and removed by
    // `installRichTextToolAutoReturn` once this edit session ends.
    shapesCreatedByThisTool.add(id);

    // Immediately enter edit/focus mode on the new shape's Tiptap instance -
    // RichTextShape.tsx's own `useIsEditing(shape.id)` effect focuses the
    // Tiptap editor as soon as `getEditingShapeId()` matches this shape (see
    // that file's "commands.focus" effect), so no further wiring is needed
    // here for the "ready for typing, no second click" requirement.
    editor.select(id);
    editor.setEditingShape(id);
  }
}

// spec.md (new spec) subtask 3. This tool's own click-vs-drag decision for
// "pointer went down on an existing, interactable shape" (an editable
// `rich-text` shape, or any other unlocked shape type) - mirrors tldraw's
// own `SelectTool/childStates/PointingShape.ts`. On pointer-up without real
// drag distance, performs exactly what a plain click on such a shape did
// before this subtask (enter edit mode with cursor-to-click-position for an
// editable `rich-text` shape; no-op for anything else). On real drag
// distance, hands off to tldraw's real shape-translate instead (see
// `handOffToTranslating` above) - dragging the body of an unfocused shape
// moves it, matching tldraw's own default Select-tool feel (point 4 of this
// subtask's spec).
class PointingShape extends StateNode {
  static override id = "pointing_shape";

  private hitShape = {} as TLShape;
  // Client/viewport-space point the ORIGINAL pointer-down landed at - see
  // `Idle.onPointerDown`'s comment (preserved below) on why `info.point` is
  // exactly what `RichTextShape.tsx`'s edit-mode-entry effect needs, and why
  // this uses the ORIGINAL pointer-down's point rather than re-reading it at
  // pointer-up time (the shape under the cursor could theoretically have
  // moved/changed between down and up - an edge case tldraw's own
  // `PointingShape`/`PointingCanvas` don't guard against either, since both
  // act on state captured on enter, not re-hit-tested on pointer-up).
  private clickPoint = { x: 0, y: 0 };

  override onEnter(info: TLPointerEventInfo & { target: "shape" }) {
    this.hitShape = info.shape;
    this.clickPoint = { x: info.point.x, y: info.point.y };
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return;
    // Real drag distance confirmed - this is a click-AND-DRAG starting on an
    // existing shape's body. Reset this tool's own chart back to idle first,
    // THEN hand the still-live gesture off to tldraw's real shape-translate.
    this.parent.transition("idle");
    handOffToTranslating(this.editor, {
      ...info,
      target: "shape",
      shape: this.hitShape,
    });
  }

  override onPointerUp() {
    this.performClickAction();
    this.complete();
  }

  override onComplete() {
    this.complete();
  }

  override onCancel() {
    this.complete();
  }

  override onInterrupt() {
    this.parent.transition("idle");
  }

  private complete() {
    this.parent.transition("idle");
  }

  // Exactly the "clicking an existing rich-text shape edits it in place;
  // clicking any other shape type is a no-op" behavior `Idle.onPointerDown`
  // performed unconditionally before this subtask - see this file's header
  // comment for the full reasoning. Only reachable here for a shape
  // `Idle.onPointerDown` already determined was "interactable" (an editable
  // `rich-text` shape, or an unlocked non-`rich-text` shape) - a locked or
  // non-editable shape never routes to this state (see `Idle.onPointerDown`
  // below), so no re-check of lock/editability is needed here.
  private performClickAction() {
    const { editor } = this;
    const hitShape = this.hitShape;

    if (hitShape.type !== "rich-text") {
      // Non-rich-text, unlocked shape: no-op, don't stamp a duplicate on top
      // of it and don't enter any edit mode for it.
      return;
    }

    // spec.md subtask 2 ("Click-to-cursor, no double-click required").
    // Capture WHERE this click landed so RichTextShape.tsx's edit-mode-
    // entry effect can place the ProseMirror cursor at that exact point,
    // instead of always focusing at the end of the document. `clickPoint`
    // (captured from `info.point` in `onEnter` above) is genuinely CLIENT/
    // viewport space, not page space, despite this being sourced from a
    // `TLPointerEventInfo` handled deep inside tldraw's page-space-heavy
    // event pipeline - confirmed by reading @tldraw/editor's own
    // `getPointerInfo()` (which builds this object straight from the raw DOM
    // PointerEvent's `clientX`/`clientY`, see node_modules/@tldraw/editor/
    // src/lib/utils/getPointerInfo.ts) and `InputsManager.updateFromEvent()`
    // (node_modules/@tldraw/editor/src/lib/editor/managers/InputsManager/
    // InputsManager.ts), which derives its own page-space tracking
    // (`_currentPagePoint`) into SEPARATE internal signals rather than
    // mutating `info.point` itself. So this needs no page-to-screen/viewport
    // conversion (e.g. `editor.pageToViewport`) - `clickPoint.x`/`.y` ARE the
    // client coordinates `EditorView.posAtCoords()` expects, already.
    useAppStore.getState().setPendingEditClickPoint({
      shapeId: hitShape.id,
      clientX: this.clickPoint.x,
      clientY: this.clickPoint.y,
    });
    editor.select(hitShape.id);
    editor.setEditingShape(hitShape.id);
  }
}

class Idle extends StateNode {
  static override id = "idle";

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    const { editor } = this;

    // Note: there is deliberately no `info.target === 'selection'` branch
    // here (a prior version of this subtask had one, calling a now-removed
    // `handOffToSelectionHandle` function) - see the large comment above
    // `watchForReturnToSelectIdle` for why a real resize/rotate-handle
    // pointer-down can never actually reach this tool's `Idle` state in the
    // first place: tldraw only makes handle DOM elements pointer-interactive
    // while `currentTool` is genuinely `select`, which - now that
    // `watchForReturnToSelectIdle` keeps `currentTool` on `select` for as
    // long as a selection persists - is exactly the situation whenever a
    // handle could legitimately be grabbed.

    // See this file's header comment for why `info.target` alone can't be
    // trusted here - do the same real geometry-based hit test tldraw's own
    // select tool does for this exact "canvas pointer-down, but was a shape
    // actually there" question.
    const hitShape = getHitShapeOnCanvasPointerDown(editor);

    if (hitShape) {
      // Clicking an existing rich-text shape edits it in place instead of
      // stamping a duplicate on top of it; clicking any other shape type
      // (e.g. a drawn stroke) is a no-op - handled by `PointingShape` above,
      // once a click (rather than a drag) is confirmed - unless it's locked,
      // in which case it's routed below as if it were empty canvas, matching
      // tldraw's own `SelectTool/childStates/Idle.ts`, which never selects a
      // locked shape this way (`editor.select()` doesn't check lock state
      // itself, unlike `editor.setEditingShape()`, which already no-ops for
      // locked shapes internally).
      if (hitShape.type === "rich-text") {
        // Gate on `editor.canEditShape()` - the exact public predicate
        // `editor.setEditingShape()` uses internally to decide whether it
        // will actually enter edit mode - rather than `!hitShape.isLocked`
        // alone. `hitShape.isLocked` only reflects the shape's OWN lock
        // flag; `canEditShape()` additionally walks up via
        // `isShapeOrAncestorLocked()`, so a shape that isn't itself locked
        // but sits inside a locked group/frame ancestor still correctly
        // reads as non-editable here. Getting this wrong previously caused
        // a real bug: `setPendingEditClickPoint()` (in `PointingShape`
        // above) would fire based only on the shape's own lock flag, then
        // `setEditingShape()` would silently no-op for the ancestor-locked
        // shape (its `isEditing` never flips to true), so
        // RichTextShape.tsx's edit-mode-entry effect - the only place that
        // reads-and-clears `pendingEditClickPoint` - would never run,
        // leaving a stale entry in the store that a LATER, unrelated edit of
        // that same shape id (e.g. after the ancestor is unlocked, or via
        // the Select tool's own double-click path) would blindly reuse,
        // silently placing the cursor at a bogus/stale location. If the
        // shape can't actually be edited for any lock reason (own or
        // ancestor's), fall through to the "treat like empty canvas"
        // behavior below instead - same as the directly-locked case already
        // did.
        if (editor.canEditShape(hitShape.id)) {
          this.parent.transition("pointing_shape", { ...info, target: "shape", shape: hitShape });
          return;
        }
        // Not editable (locked, directly or via an ancestor) - fall through
        // to the "treat like empty canvas" behavior below.
      } else if (!hitShape.isLocked) {
        this.parent.transition("pointing_shape", { ...info, target: "shape", shape: hitShape });
        return;
      }
      // Non-rich-text locked shape, or non-editable rich-text shape: fall
      // through to the "treat like empty canvas" behavior below - the locked
      // shape occupying that point isn't something this tool can
      // meaningfully interact with (on a plain click, `PointingCanvas`
      // creates a new shape on top of it, same as this file's prior
      // behavior; on a drag, it marquee-selects instead of moving it).
    }

    // Genuinely empty canvas, or a locked/non-editable shape underneath the
    // pointer (see the fall-through comment above) - mirrors tldraw's own
    // `SelectTool/childStates/Idle.ts` routing both of those cases to
    // `pointing_canvas`.
    this.parent.transition("pointing_canvas", info);
  }

  override onCancel() {
    this.editor.setCurrentTool("select");
  }
}

/** @public */
export class RichTextTool extends StateNode {
  static override id = "rich-text";
  static override initial = "idle";
  static override children(): TLStateNodeConstructor[] {
    return [Idle, PointingCanvas, PointingShape];
  }
}

// See this file's header comment ("Getting this right needs one more piece
// beyond the tool itself..."). Call once per tldraw `editor` instance (e.g.
// from CanvasEditor.tsx's `onMount`) and call the returned cleanup function
// on unmount, mirroring that file's existing `editor.store.listen` cleanup
// pattern.
export function installRichTextToolAutoReturn(editor: Editor): () => void {
  const unregister = editor.sideEffects.registerAfterChangeHandler(
    "instance_page_state",
    (prev, next) => {
      // Only care about an edit session ENDING (editingShapeId -> null) -
      // the start of an edit session is tldraw's own concern (see the
      // defaultSideEffects.ts logic cited in this file's header comment).
      if (!prev.editingShapeId || next.editingShapeId) return;

      // Consume (remove) the transient tracking entry for this shape id
      // regardless of outcome - this is a one-time "was THIS edit session
      // opened by the click-to-create flow" check, not a permanent property
      // of the shape (see `shapesCreatedByThisTool`'s own comment above).
      const wasCreatedByThisTool = shapesCreatedByThisTool.delete(prev.editingShapeId);
      if (!wasCreatedByThisTool) return;

      // Only auto-return when this is really "the user clicked elsewhere on
      // the canvas to keep creating", not an out-of-band `setCurrentTool`/
      // toolbar-button call that also happens to end the edit session (see
      // this file's header comment for the "Select tool must stay genuinely
      // independent" requirement this distinguishes). `editor.inputs
      // .getIsPointing()` is the signal that distinguishes them - true only
      // while this handler is firing as a nested side effect of a REAL,
      // in-flight pointer_down dispatch (see Editor.ts's `dispatch()`, which
      // sets `inputs.isPointing = true` before invoking the state chart that
      // eventually calls `setEditingShape(null)`).
      //
      // Round 4 fix: `getIsPointing()` MUST be read synchronously, right
      // here, before anything else runs - not re-read later from inside a
      // deferred callback. Traced sequence (this is what rounds 3 and 4 both
      // got wrong in different ways): this handler fires synchronously in the
      // middle of tldraw's own `EditingShape.onExit()` (called from
      // `select.transition('idle', ...)`, itself invoked by
      // `EditingShape.onPointerDown`'s `case 'canvas'` branch when the user
      // clicks empty canvas to finish editing). `onExit()`'s
      // `editor.setEditingShape(null)` call is its own top-level store
      // transaction, so THIS `instance_page_state.afterChange` handler runs
      // immediately, before that same `case 'canvas'` branch's following line
      // - `this.editor.root.handleEvent(info)`, which re-dispatches the SAME
      // pointerdown event - has run. That re-dispatch is what actually drives
      // `select`'s own `Idle -> PointingCanvas` transition, and
      // `PointingCanvas` only returns `select` to `idle` on pointer-UP, not
      // immediately - so `select.idle` is NOT yet reached at the instant this
      // handler fires. `getIsPointing()`, by contrast, IS already reliably
      // true right here (round 3's mistake was checking it again later, once
      // its true-window had already closed - `inputs.isPointing` is cleared
      // before the state chart even processes the eventual pointerup, so by
      // the time `select.idle` is genuinely reached, `getIsPointing()` always
      // reads false). So: capture it now, synchronously, while it's still a
      // reliable "this is the same in-flight, user-driven gesture" signal.
      const wasPointing = editor.inputs.getIsPointing();
      if (!wasPointing) {
        // Not a live pointer gesture (e.g. an out-of-band `setCurrentTool`
        // call while mid-edit) - don't auto-return; see the Select-tool-
        // independence requirement in this file's header comment.
        return;
      }

      // Now wait for `select` to genuinely, eventually reach `select.idle`
      // WITH AN EMPTY SELECTION - however long that actually takes (one
      // pointerup event, however many ticks away) - using the SAME one-shot
      // `react()` watcher technique `watchForReturnToSelectIdle` above
      // already uses successfully: tool-chart transitions and selection are
      // pure in-memory `StateNode`/signal state, not something `sideEffects`/
      // store listeners can observe, hence tldraw's own fine-grained
      // reactivity instead of a fixed-timing guess like the `queueMicrotask`
      // this replaces (round 3's bug: by the time a microtask runs, `select`
      // is still `select.pointing_canvas`, not `select.idle` yet -
      // `isIn('select.idle')` was never true at that point, so the old check
      // could never fire).
      //
      // The empty-selection requirement (round 5 fix) is required for the
      // same reason `watchForReturnToSelectIdle` needs it: the click-away
      // pointerdown that ends the edit session gets re-dispatched into
      // `select.Idle -> pointing_canvas`, and `PointingCanvas.onEnter`'s own
      // `selectNone()` runs immediately at pointer-DOWN time, not at
      // settle/pointer-up time - but if the user's pointer then moves enough
      // before releasing, `PointingCanvas.onPointerMove` transitions to
      // `select.brushing` instead (a real marquee-select), which can settle
      // back into `select.idle` with a NON-empty selection. Gating on
      // `select.idle` alone would then switch back to `rich-text` while that
      // marquee selection is still live, stranding its resize/rotate handles
      // and native Delete outside `select` - the exact class of bug
      // `watchForReturnToSelectIdle` already guards against for its own
      // brush/translate hand-offs. Requiring both conditions here means the
      // switch to `rich-text` only happens once `select` is truly done with
      // this gesture AND nothing is left selected.
      const stop = react("rich-text tool: auto-return after click-away edit exit", () => {
        if (!editor.isIn("select.idle")) return;
        if (editor.getSelectedShapeIds().length > 0) return;
        stop();
        // Mirrors `watchForReturnToSelectIdle`'s own cleanup comment: the
        // reactor already tore itself down above, so remove its entry from
        // `editor.disposables` too, rather than letting a dead entry pile up
        // for every click-away over a long session.
        editor.disposables.delete(stop);
        editor.setCurrentTool("rich-text");
      });
      // Same reasoning/pattern as `watchForReturnToSelectIdle`'s own
      // `editor.disposables.add(stop)`: if the editor is disposed before
      // `select` ever reaches `idle` (e.g. the note is closed mid-gesture),
      // tear this watcher down too, rather than leaving a live subscription
      // with a closure over a disposed `editor`.
      editor.disposables.add(stop);
    },
  );

  return unregister;
}
