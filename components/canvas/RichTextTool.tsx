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
// `Idle.onPointerDown` itself creates a shape, and the id is removed the
// first time the auto-return check consumes it (whether or not it decides to
// auto-return) - a one-time "was this exact edit session opened by the
// click-to-create flow" check, not a permanent property of the shape.
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
import {
  StateNode,
  createShapeId,
  getHitShapeOnCanvasPointerDown,
  type Editor,
  type TLPointerEventInfo,
  type TLShapeId,
  type TLStateNodeConstructor,
} from "@tldraw/tldraw";
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

class Idle extends StateNode {
  static override id = "idle";

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    const { editor } = this;

    // See this file's header comment for why `info.target` alone can't be
    // trusted here - do the same real geometry-based hit test tldraw's own
    // select tool does for this exact "canvas pointer-down, but was a shape
    // actually there" question.
    const hitShape = getHitShapeOnCanvasPointerDown(editor);
    // Mirrors tldraw's own SelectTool/childStates/Idle.ts, which never
    // selects a locked shape this way (`editor.select()` doesn't check lock
    // state itself, unlike `editor.setEditingShape()`, which already no-ops
    // for locked shapes internally). If the hit shape is locked, fall
    // through to the normal "create a new shape" behavior below instead of
    // treating the click as a no-op - the locked shape occupying that point
    // isn't something this tool can meaningfully interact with.
    if (hitShape && !hitShape.isLocked) {
      // Clicking an existing rich-text shape edits it in place instead of
      // stamping a duplicate on top of it; clicking any other shape type
      // (e.g. a drawn stroke) is a no-op.
      if (hitShape.type === "rich-text") {
        editor.select(hitShape.id);
        editor.setEditingShape(hitShape.id);
      }
      return;
    }

    // Genuinely empty canvas - mirrors tldraw's own text/note tools'
    // create-on-pointer-down behavior (see this file's header comment).
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

  override onCancel() {
    this.editor.setCurrentTool("select");
  }
}

/** @public */
export class RichTextTool extends StateNode {
  static override id = "rich-text";
  static override initial = "idle";
  static override children(): TLStateNodeConstructor[] {
    return [Idle];
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
      // the canvas to keep creating" (see this file's header comment for why
      // `isIn('select.idle')` alone isn't a reliable enough signal, and why
      // `getIsPointing()` is the one that actually distinguishes a live
      // pointer-driven click from an out-of-band tool switch).
      if (editor.isIn("select.idle") && editor.inputs.getIsPointing()) {
        editor.setCurrentTool("rich-text");
      }
    },
  );

  return unregister;
}
