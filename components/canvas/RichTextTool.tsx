"use client";

// The app's persistent default tool: unlike tldraw's text tool, it doesn't hand
// back to select after one shape. tldraw force-switches currentTool to
// select.editing_shape whenever editing starts, so the auto-return watcher
// switches back to rich-text when an edit session this tool started ends.
// Shapes edited through Select's own double-click behave like normal tldraw.
//
// Click vs drag mirrors tldraw's Select tool chart. Brushing and Translating
// aren't exported, so a drag hands off to the real select tool, which stays
// current while the selection is non-empty so resize, rotate, Delete and drag
// keep working.
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

// Shapes whose current edit session this tool started. Kept in memory rather
// than as shape meta, which would misfire on a later Select double-click edit.
// Consumed when that session ends.
const shapesWithEditSessionOwnedByThisTool = new Set<TLShapeId>();

function handOffToBrushing(editor: Editor, info: TLPointerEventInfo & { target: "canvas" }) {
  const selectTool = editor.getStateDescendant("select");
  if (!selectTool) return;
  editor.setCurrentTool("select");
  selectTool.transition("brushing", info);
  requestReturnToRichText();
}

// Select the shape first, like tldraw's PointingShape.startTranslating.
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

// No handle branch is needed here: resize and rotate handles only respond while
// currentTool is select, and Idle only runs under rich-text.
//
// requestReturnToRichText() is called whenever this tool's own logic (not a
// user tool choice) hands control to select and wants it back. mayReenterEdit
// is set only for edit-to-edit clicks, never for hand-offs or Escape, so a
// marquee or Escape never opens a shape for editing.
let pendingReturnToRichText = false;
let pendingReturnMayReenterEdit = false;
// The shape whose edit session ended, when known. Undefined for hand-offs and
// Escape, which aren't tied to one shape.
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

// Clears a dangling pending return outright. An edit session that ends while a
// shape's link dialog is open sets the flag without changing any signal the
// watcher tracks, so it would otherwise fire on a later unrelated click.
export function clearPendingReturnToRichText() {
  pendingReturnToRichText = false;
  pendingReturnMayReenterEdit = false;
  pendingReturnShapeId = undefined;
}

// Shapes whose link dialog is open. If the edit session ends anyway, that isn't
// a canvas interaction: re-entering edit then would look like a phantom text
// box, and the dialog's close resumes editing through
// resumeEditingWithRichTextTool instead. Per shape, so one dialog closing can't
// clear another's suppression.
const shapesWithSuppressedReenter = new Set<TLShapeId>();
export function setReenterEditSuppressed(shapeId: TLShapeId, suppressed: boolean) {
  if (suppressed) {
    shapesWithSuppressedReenter.add(shapeId);
  } else {
    shapesWithSuppressedReenter.delete(shapeId);
  }
}

// Use this instead of setCurrentTool for deliberate tool switches. It stops the
// auto-return watcher from hijacking the switch, and forces an exit and
// re-enter because transition() does nothing when select is already active (as
// it is mid-edit).
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

// Puts the canvas back in this tool and edits the shape again, with the session
// owned by this tool so ending it later returns here. Falls back to just the
// tool switch when the shape is gone or can't be edited.
export function resumeEditingWithRichTextTool(editor: Editor, shapeId: TLShapeId) {
  switchToToolExplicitly(editor, "rich-text");
  const shape = editor.getShape(shapeId);
  if (!shape || shape.type !== "rich-text" || !editor.canEditShape(shapeId)) return;
  shapesWithEditSessionOwnedByThisTool.add(shapeId);
  editor.select(shapeId);
  editor.setEditingShape(shapeId);
}

// Installed once per editor. Acts only while a return is pending, and only once
// select is idle with an empty selection: returning earlier would break resize,
// rotate and Delete, which need select with a live selection.
//
// All three signals are read before any branching because react() only tracks
// what each run reads.
//
// The callback never writes to the editor directly. react() can rerun
// reentrantly mid-transition (clicking a second shape while editing visits
// select.idle with the old selection), and writing then corrupts tldraw's
// state. Work is deferred with queueMicrotask and re-reads everything; a timer
// or await would let these module-level flags outlive an editor teardown.
function installReturnToRichTextWatcher(editor: Editor): () => void {
  // Treat rich-text -> select switches we didn't cause (tldraw's Ctrl+A,
  // delete, group and similar) like our own hand-offs.
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

// Runs on a fresh call stack (see the watcher above). If the settled selection
// is one editable rich-text shape and re-entering is allowed, edit it at the
// click point: clicking from one text box straight into another only selects it
// in tldraw. mayReenterEdit is consumed whether or not it's used.
function resolvePendingReturnToRichText(editor: Editor) {
  if (editor.getCurrentToolId() !== "select") return;
  if (!editor.isIn("select.idle")) return;
  if (!pendingReturnToRichText) return;

  const selectedShapeIds = editor.getSelectedShapeIds();
  const mayReenterEditThisRun = pendingReturnMayReenterEdit;
  const shapeIdThisRun = pendingReturnShapeId;
  pendingReturnMayReenterEdit = false;
  pendingReturnShapeId = undefined;

  // A session that ended because focus moved to this shape's link dialog isn't
  // a canvas interaction, so neither re-enter edit nor re-arm the tool.
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

// Click on empty canvas (or a locked shape) creates a shape; a drag hands off
// to tldraw's marquee select.
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

    // RichTextShape focuses its editor once it becomes the editing shape.
    editor.select(id);
    editor.setEditingShape(id);
  }
}

// Click on a shape edits it (if it's an editable rich-text shape); a drag hands
// off to tldraw's translate.
class PointingShape extends StateNode {
  static override id = "pointing_shape";

  private hitShape = {} as TLShape;
  // Viewport coordinates of the pointer-down, which posAtCoords() expects.
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

    // Track edits of existing shapes too, so leaving them triggers the
    // auto-return.
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
        // canEditShape() also respects locked ancestors such as groups and
        // frames.
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

  // Mirrors select: right-clicking a shape selects it (keeping a selection it's
  // part of) so the context menu can act on it; empty canvas clears selection.
  override onRightClick() {
    const { editor } = this;
    const hitShape = getHitShapeOnCanvasPointerDown(editor);
    if (!hitShape) {
      editor.selectNone();
      return;
    }
    const target = editor.getOutermostSelectableShape(hitShape);
    if (!editor.getSelectedShapeIds().includes(target.id)) editor.select(target.id);
  }

  override onCancel() {
    // Escape forces select; queue the return to rich-text.
    requestReturnToRichText();
    this.editor.setCurrentTool("select");
  }
}

export class RichTextTool extends StateNode {
  static override id = "rich-text";
  static override initial = "idle";
  static override children(): TLStateNodeConstructor[] {
    return [Idle, PointingCanvas, PointingShape];
  }
}

// Call once per editor (CanvasEditor's onMount); call the returned cleanup on
// unmount.
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
      // The click that ended this session may also have landed on another
      // editable shape, so allow re-entering edit; shapeId scopes the dialog
      // suppression to this shape.
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
