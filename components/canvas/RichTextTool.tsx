"use client";

// Custom tldraw StateNode tool that stays the persistent default tool
// (unlike tldraw's own text/note tools, which hand back to `select` after
// one shape). tldraw's own framework force-switches `currentTool` to
// `select.editing_shape` whenever `editingShapeId` goes null -> non-null, no
// opt-out - so right after creating/editing a shape, `currentTool` is really
// `select`, not `rich-text`. `installRichTextToolAutoReturn` watches for
// this tool's own edit sessions ending and switches back to `rich-text`, so
// repeated clicks on empty canvas keep creating shapes without reselecting a
// tool. Only shapes whose edit session THIS tool's own click handling
// started are eligible for that auto-return (tracked in
// `shapesWithEditSessionOwnedByThisTool`) - a shape edited via Select's own
// double-click-to-edit must behave like normal tldraw, untouched by this
// tool.
//
// tldraw's raw canvas pointerdown always reports `target: 'canvas'` (no
// real-DOM shape hit-testing) - `getHitShapeOnCanvasPointerDown` (tldraw's
// own helper, also used by its Select tool) does the actual geometry hit
// test.
//
// Click-vs-drag (`Idle` -> `PointingCanvas`/`PointingShape`) mirrors
// tldraw's own Select tool chart. `Brushing`/`Translating` aren't
// importable directly (excluded from tldraw's package exports), so a drag
// hands the gesture off to the real, already-registered `select` tool
// instance instead (`editor.setCurrentTool('select')` +
// `.transition('brushing'|'translating', info)`) - the same code path
// tldraw's own Select tool uses. `currentTool` stays on `select` for as
// long as the resulting selection is non-empty, so native resize/rotate/
// Delete/drag all keep working (those only wire up while `currentTool` is
// genuinely `select`); `installReturnToRichTextWatcher` switches back once
// the selection empties out.
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

// Transient, in-memory, session-scoped tracking of shape ids whose current
// edit session was started by this tool's own click handling (create in
// `PointingCanvas`, or click-to-edit-existing in `PointingShape`) - not a
// permanent `meta` flag, since a permanent flag would misfire on a later,
// unrelated Select-tool double-click-to-edit of the same shape. Populated
// on edit-session start, consumed (deleted) the first time the auto-return
// handler sees that session end.
const shapesWithEditSessionOwnedByThisTool = new Set<TLShapeId>();

function handOffToBrushing(editor: Editor, info: TLPointerEventInfo & { target: "canvas" }) {
  const selectTool = editor.getStateDescendant("select");
  if (!selectTool) return;
  editor.setCurrentTool("select");
  selectTool.transition("brushing", info);
  requestReturnToRichText();
}

// Selects the dragged shape first, mirroring tldraw's own
// `PointingShape.startTranslating` (bails to idle if nothing's selected).
function handOffToTranslating(
  editor: Editor,
  info: TLPointerEventInfo & { target: "shape"; shape: TLShape },
) {
  const selectTool = editor.getStateDescendant("select");
  if (!selectTool) return;
  editor.markHistoryStoppingPoint("selecting shape");
  editor.setSelectedShapes([info.shape.id]);
  // Re-focus in case a shape's own text content stole DOM focus.
  editor.focus();
  editor.setCurrentTool("select");
  selectTool.transition("translating", info);
  requestReturnToRichText();
}

// A resize/rotate-handle pointer-down can never reach this tool's `Idle`:
// handle DOM elements are only pointer-interactive while `currentTool` is
// genuinely `select`, and `Idle.onPointerDown` only ever runs while
// `currentTool` is `rich-text` - mutually exclusive. So there's no
// `info.target === 'selection'` branch here; native handle/Delete/drag
// behavior is fully covered by keeping `currentTool` on `select` for as
// long as a selection persists (see `installReturnToRichTextWatcher`).

// Single persistent flags (not per-gesture one-shot watchers) driving
// `installReturnToRichTextWatcher` below. `requestReturnToRichText()` is
// called any time this tool's OWN logic (not a deliberate user tool choice)
// hands control to `select` and wants it back - the brush/translate
// hand-offs, an edit session this tool owned ending, and Escape while idle.
// `mayReenterEdit` additionally covers the edit-to-edit-click case (see
// `resolvePendingReturnToRichText`) - only set by the sideEffects handler
// below, never by hand-offs or Escape, since a marquee-select or Escape
// settling on one selected shape must never auto-open it for editing.
let pendingReturnToRichText = false;
let pendingReturnMayReenterEdit = false;
// The shape whose edit session ending triggered this pending return, when
// known (only the sideEffects handler in `installRichTextToolAutoReturn`
// below provides one - an edit session just ended on this exact shape).
// `undefined` for the brush/translate hand-offs and Escape, which aren't
// associated with any one shape's edit session, so per-shape suppression
// below simply doesn't apply to them.
let pendingReturnShapeId: TLShapeId | undefined = undefined;
let explicitToolSwitchInProgress = false;

function requestReturnToRichText(options?: { mayReenterEdit?: boolean; shapeId?: TLShapeId }) {
  pendingReturnToRichText = true;
  pendingReturnMayReenterEdit = options?.mayReenterEdit ?? false;
  pendingReturnShapeId = options?.shapeId;
}

// Called by RichTextShape.tsx's drag handle after ending an edit session to
// start a drag, so the shape doesn't spring back into edit mode once it settles.
export function suppressReenterEditAfterEndingSession() {
  pendingReturnMayReenterEdit = false;
}

// Directly clears any dangling pending-return state, rather than merely
// suppressing it. The watcher below only re-evaluates `pendingReturnToRichText`
// when getCurrentToolId()/isIn("select.idle")/getSelectedShapeIds() actually
// change value - ending an edit session purely via focus loss (no canvas
// pointer event, e.g. clicking a portaled dialog's own button) can set
// `pendingReturnToRichText = true` with NO such signal change following it,
// so the watcher never re-runs and the flag stays dangling until some
// unrelated LATER click finally triggers it - by which point a merely
// time-scoped suppression (like `reenterEditSuppressed` while a dialog is
// open) has already been lifted. Called by RichTextShape.tsx when its link
// dialog closes, to flush this out definitively instead of racing it.
export function clearPendingReturnToRichText() {
  pendingReturnToRichText = false;
  pendingReturnMayReenterEdit = false;
  pendingReturnShapeId = undefined;
}

// Persistent (not one-shot) version of the above, toggled by RichTextShape.tsx
// while its link dialog is open. tldraw's own FocusManager ends the edit
// session on any outside mousedown (e.g. the dialog's Cancel/X button, which
// is portaled outside .tl-container) - without this, resolvePendingReturnToRichText
// below would then reenter edit on that same shape at the click's screen
// point, which looks like a phantom new text box appearing under the dialog.
// Keyed per-shape id (not a single flag) so one shape's dialog closing can
// never clear suppression for a DIFFERENT shape whose dialog is still open,
// mirroring `shapesWithEditSessionOwnedByThisTool` above.
const shapesWithSuppressedReenter = new Set<TLShapeId>();
export function setReenterEditSuppressed(shapeId: TLShapeId, suppressed: boolean) {
  if (suppressed) {
    shapesWithSuppressedReenter.add(shapeId);
  } else {
    shapesWithSuppressedReenter.delete(shapeId);
  }
}

// Ribbon.tsx's Draw-tab tool buttons call this INSTEAD OF a raw
// `editor.setCurrentTool(id)`, for two reasons: (1) it suppresses
// `requestReturnToRichText()` for the duration via
// `explicitToolSwitchInProgress`, so a deliberate switch is never hijacked
// by the auto-return watcher; (2) `StateNode.transition()` no-ops when the
// target id already matches the active child, so a raw
// `setCurrentTool('select')` while mid-edit (where `currentTool` is
// already `'select'`, via tldraw's own force-switch) would otherwise do
// nothing at all - the exit+enter below mirrors tldraw's own workaround
// for this in its Select toolbar button.
export function switchToToolExplicitly(editor: Editor, toolId: string) {
  explicitToolSwitchInProgress = true;
  try {
    if (toolId === "select" && editor.isIn("select")) {
      const current = editor.root.getCurrent();
      if (current) {
        current.exit({}, current.id);
        current.enter({}, current.id);
      }
    }
    // A deliberate switch right now supersedes any earlier pending return.
    pendingReturnToRichText = false;
    pendingReturnMayReenterEdit = false;
    pendingReturnShapeId = undefined;
    editor.setCurrentTool(toolId);
  } finally {
    explicitToolSwitchInProgress = false;
  }
}

// Persistent (not one-shot) reactive watcher, installed once for the
// editor's lifetime. Only acts while `pendingReturnToRichText` is true, and
// requires BOTH `select.idle` and an empty selection (not idle alone) -
// resize/rotate handles and native Delete only work while `currentTool` is
// genuinely `select` with a live selection, so returning to `rich-text` the
// instant `select.idle` is reached, before a hand-off's selection is even
// visible, would silently break all of that.
//
// `react()` rebuilds its dependency set from scratch every run, from
// exactly the signals read that run - an early return before reading a
// signal means that signal is never tracked going forward. All three
// signals below are therefore read unconditionally, before any branching,
// so a sub-state-only transition within `select` (which doesn't change
// `getCurrentToolId()`) still reliably reruns this effect.
//
// The reactive callback itself only reads signals and schedules work - it
// never calls an `editor.*` write directly. `react()` reruns synchronously
// and reentrantly the instant a tracked signal changes, including a
// transient value mid-way through a still-in-progress tldraw internal
// transition (e.g. clicking a second shape while editing a first briefly,
// reentrantly, visits `select.idle` with the OLD shape still selected,
// before the new one is actually selected). Acting on that transient state
// synchronously - calling `setEditingShape` from inside a reentrant,
// nested call - corrupts tldraw's own transition bookkeeping and can throw.
// So the actual work is deferred via `queueMicrotask` to a fresh top-level
// call stack that only runs once the whole synchronous dispatch has
// unwound, and re-reads everything fresh at that point rather than trusting
// this run's readings (this depends specifically on microtask semantics -
// swapping for `setTimeout`/`requestAnimationFrame`/anything `await`-based
// would let these module-level flags leak across an editor teardown).
function installReturnToRichTextWatcher(editor: Editor): () => void {
  // Catches any rich-text -> select transition we didn't cause ourselves
  // (e.g. tldraw's own Ctrl+A/delete/group/etc. actions force-switch to
  // select internally) and treats it the same as our own hand-offs.
  let lastToolId = editor.getCurrentToolId();
  const stop = react("rich-text tool: persistent return-to-rich-text watcher", () => {
    const toolId = editor.getCurrentToolId();
    const isSelectIdle = editor.isIn("select.idle");
    const selectedShapeIds = editor.getSelectedShapeIds();

    if (lastToolId === "rich-text" && toolId === "select" && !explicitToolSwitchInProgress) {
      pendingReturnToRichText = true;
    }
    lastToolId = toolId;

    if (toolId !== "select") {
      pendingReturnToRichText = false;
      pendingReturnMayReenterEdit = false;
      return;
    }
    if (!pendingReturnToRichText) return;
    if (!isSelectIdle) return;
    void selectedShapeIds; // tracked as a dependency; re-read fresh below
    queueMicrotask(() => resolvePendingReturnToRichText(editor));
  });
  return stop;
}

// Deferred resolution for the watcher above - see its comment for why this
// runs on a fresh call stack instead of inline. If the settled selection is
// exactly one editable `rich-text` shape and `pendingReturnMayReenterEdit`
// is set, re-enters edit mode on it directly (placing the cursor at the
// click position) instead of leaving it merely selected - this covers
// clicking directly from one text box's edit session into another, which
// tldraw's own Select tool only selects (never edits) since single-click-
// to-edit is entirely this tool's own behavior and isn't active during an
// edit-to-edit click. `mayReenterEdit` is consumed unconditionally the
// moment it's evaluated (not only on a successful reentry), so it can't
// wrongly fire on a later, unrelated ordinary click.
function resolvePendingReturnToRichText(editor: Editor) {
  if (editor.getCurrentToolId() !== "select") return;
  if (!editor.isIn("select.idle")) return;
  if (!pendingReturnToRichText) return;

  const selectedShapeIds = editor.getSelectedShapeIds();
  const mayReenterEditThisRun = pendingReturnMayReenterEdit;
  const shapeIdThisRun = pendingReturnShapeId;
  pendingReturnMayReenterEdit = false;
  pendingReturnShapeId = undefined;

  // While a link dialog is open (or was open when this session ended, see
  // RichTextShape.tsx) for the SPECIFIC shape whose edit session ending
  // triggered this pending return, neither reentering edit NOR switching to
  // the crosshair-arming "rich-text" tool is safe for it - both branches
  // below assume this was a genuine canvas interaction, but a session
  // ending purely via focus loss to that shape's portaled dialog isn't one.
  // Keyed per-shape so a DIFFERENT shape's dialog closing can't wrongly
  // clear this suppression.
  if (shapeIdThisRun && shapesWithSuppressedReenter.has(shapeIdThisRun)) {
    pendingReturnToRichText = false;
    return;
  }

  if (selectedShapeIds.length === 1 && mayReenterEditThisRun) {
    const onlyId = selectedShapeIds[0];
    const onlyShape = editor.getShape(onlyId);
    if (onlyShape && onlyShape.type === "rich-text" && editor.canEditShape(onlyId)) {
      pendingReturnToRichText = false;
      shapesWithEditSessionOwnedByThisTool.add(onlyId);
      const point = editor.inputs.getCurrentScreenPoint();
      useAppStore.getState().setPendingEditClickPoint({
        shapeId: onlyId,
        clientX: point.x,
        clientY: point.y,
      });
      editor.select(onlyId);
      editor.setEditingShape(onlyId);
      return;
    }
  }

  if (selectedShapeIds.length > 0) return;
  pendingReturnToRichText = false;
  editor.setCurrentTool("rich-text");
}

// Click-vs-drag on empty canvas (or a locked/non-editable shape). A plain
// click creates a new shape at the origin point; a real drag hands off to
// tldraw's marquee-select instead.
class PointingCanvas extends StateNode {
  static override id = "pointing_canvas";

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return;
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

    shapesWithEditSessionOwnedByThisTool.add(id);

    // RichTextShape.tsx's own `useIsEditing` effect focuses the Tiptap
    // editor once `getEditingShapeId()` matches, so no further wiring is
    // needed here.
    editor.select(id);
    editor.setEditingShape(id);
  }
}

// Click-vs-drag on an existing, interactable shape. A plain click enters
// edit mode (for an editable `rich-text` shape) or no-ops (anything else);
// a real drag hands off to tldraw's real shape-translate.
class PointingShape extends StateNode {
  static override id = "pointing_shape";

  private hitShape = {} as TLShape;
  // Client/viewport-space point the original pointer-down landed at -
  // captured on enter (not re-hit-tested on pointer-up), matching what
  // `posAtCoords()` expects downstream in RichTextShape.tsx.
  private clickPoint = { x: 0, y: 0 };

  override onEnter(info: TLPointerEventInfo & { target: "shape" }) {
    this.hitShape = info.shape;
    this.clickPoint = { x: info.point.x, y: info.point.y };
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return;
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

  private performClickAction() {
    const { editor } = this;
    const hitShape = this.hitShape;

    if (hitShape.type !== "rich-text") return;

    useAppStore.getState().setPendingEditClickPoint({
      shapeId: hitShape.id,
      clientX: this.clickPoint.x,
      clientY: this.clickPoint.y,
    });

    // Editing an existing shape (not just creating one) also needs to be
    // tracked, so clicking away from it correctly primes the auto-return
    // watcher instead of stranding `currentTool` on `select`.
    shapesWithEditSessionOwnedByThisTool.add(hitShape.id);

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

    const hitShape = getHitShapeOnCanvasPointerDown(editor);

    if (hitShape) {
      if (hitShape.type === "rich-text") {
        // `canEditShape()` (not just `!hitShape.isLocked`) also walks up
        // via ancestor lock state, so a shape inside a locked group/frame
        // still correctly reads as non-editable.
        if (editor.canEditShape(hitShape.id)) {
          this.parent.transition("pointing_shape", { ...info, target: "shape", shape: hitShape });
          return;
        }
      } else if (!hitShape.isLocked) {
        this.parent.transition("pointing_shape", { ...info, target: "shape", shape: hitShape });
        return;
      }
      // Locked/non-editable shape: fall through and treat as empty canvas.
    }

    this.parent.transition("pointing_canvas", info);
  }

  override onCancel() {
    // Escape forces `currentTool` to `select` regardless of what this tool
    // wants - prime the auto-return so control bounces straight back once
    // `select` settles (in practice, near-instant).
    requestReturnToRichText();
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

// Call once per tldraw editor instance (CanvasEditor.tsx's `onMount`) and
// call the returned cleanup on unmount.
export function installRichTextToolAutoReturn(editor: Editor): () => void {
  const unregister = editor.sideEffects.registerAfterChangeHandler(
    "instance_page_state",
    (prev, next) => {
      if (!prev.editingShapeId || next.editingShapeId) return;

      const editSessionOwnedByThisTool = shapesWithEditSessionOwnedByThisTool.delete(
        prev.editingShapeId,
      );
      if (!editSessionOwnedByThisTool) return;
      if (explicitToolSwitchInProgress) return;
      // `mayReenterEdit: true` only here - covers the same click ending
      // this edit session possibly also landing `select` on a different,
      // editable `rich-text` shape (see `resolvePendingReturnToRichText`).
      // `shapeId` is this exact shape (`prev.editingShapeId`), so per-shape
      // reenter suppression below only ever applies to the shape whose
      // session actually just ended.
      requestReturnToRichText({ mayReenterEdit: true, shapeId: prev.editingShapeId });
    },
  );

  const stopWatcher = installReturnToRichTextWatcher(editor);

  return () => {
    unregister();
    stopWatcher();
    pendingReturnToRichText = false;
    pendingReturnMayReenterEdit = false;
    pendingReturnShapeId = undefined;
    explicitToolSwitchInProgress = false;
    shapesWithEditSessionOwnedByThisTool.clear();
    shapesWithSuppressedReenter.clear();
  };
}
