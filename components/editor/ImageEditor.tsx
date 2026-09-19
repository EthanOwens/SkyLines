"use client";

// spec.md subtask 12 ("Image editor pop-out shell") + subtask 13 ("Undo-stack
// draw tool"). The pop-out window's root content (see app/image-editor/page.tsx,
// and lib/imageEditorWindow.ts for how the window itself gets opened and how
// the image reaches it as a temp-file path rather than inline data).
//
// Subtask 13 adds the first real editing tool - freehand draw, reusing the
// pointer-tracking approach from components/sticky/ScreenshotCapture.tsx -
// plus a canvas-snapshot undo stack (Ctrl+Z) designed to be reused by later
// tools (14-17: shapes, censor, text, erase/crop), which will each push their
// own snapshots onto the same `history` stack via `pushHistorySnapshot()`.

import { useEffect, useRef, useState } from "react";
import { Circle, Crop, Eraser, EyeOff, Minus, Pencil, Square, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  path: string;
}

type Tool = "none" | "draw" | "shape" | "censor" | "text" | "erase" | "crop";

// Which geometric primitive the shape tool commits on pointer-up.
type ShapeType = "rectangle" | "ellipse" | "line";

// Which effect the censor tool applies to its drag box.
type CensorMode = "black" | "blur";

// Blur radius scales with canvas width like stroke width does elsewhere in
// this file, but with a much stronger ratio - censoring needs to stay
// visually opaque even on native-resolution (e.g. 4K) screenshots, unlike
// the thin/subtle stroke width.
function censorBlurRadius(canvasWidth: number): number {
  return Math.max(10, canvasWidth / 80);
}

// Erase brush half-width, scaled like the draw tool's line width but larger
// since it needs to feel like a brush, not a thin pen stroke.
function eraseBrushRadius(canvasWidth: number): number {
  return Math.max(8, canvasWidth / 100);
}

// Matches components/theme/ThemeEditor.tsx's own MAX_UNDO_HISTORY convention -
// bounds memory growth from full-canvas snapshots.
const MAX_UNDO_HISTORY = 50;

// Mirrors components/sticky/ScreenshotCapture.tsx's fileToDataUrl exactly -
// reads the temp file lib/imageEditorWindow.ts wrote and decodes it in
// chunks to avoid blowing the call stack on a full-resolution image's byte
// array.
async function fileToDataUrl(path: string): Promise<string> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export function ImageEditor({ path }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("none");
  const [shapeType, setShapeType] = useState<ShapeType>("rectangle");
  const [censorMode, setCensorMode] = useState<CensorMode>("black");
  const isPointerDownRef = useRef(false);
  // Drag-start point and the pre-drag pixel snapshot the shape tool restores
  // on every pointermove before redrawing the in-progress preview on top -
  // keeps the live preview from smearing without permanently committing it.
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeBaseRef = useRef<ImageData | null>(null);
  // Same restore-then-redraw base as the shape tool, reused for the censor
  // tool's own drag box.
  const censorStartRef = useRef<{ x: number; y: number } | null>(null);
  const censorBaseRef = useRef<ImageData | null>(null);
  // The original loaded image's pixels, captured once when the image first
  // loads and never mutated afterward - the erase tool restores from this,
  // not from whatever's currently on the canvas.
  const originalImageRef = useRef<ImageData | null>(null);
  // Drag-start point and pre-drag snapshot for the crop tool's live dashed
  // preview, same restore-then-redraw pattern as shape/censor. Kept alive
  // (not cleared on pointer-up) until the pending crop is confirmed or
  // cancelled, since crop has an extra confirm step the other tools don't.
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropBaseRef = useRef<ImageData | null>(null);
  // The pending crop rectangle once a drag completes - drives the confirm/
  // cancel UI; null while no crop is awaiting confirmation.
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  // Synchronous re-entrancy guard for commitTextEdit - state updates aren't
  // synchronous, so a stale-closure onBlur firing after Escape's cancel (from
  // unmounting the focused overlay input) can't be stopped by checking
  // textEditState alone; this ref makes the second call a provable no-op.
  const textCommittedRef = useRef(false);
  // Pending text placement: the overlay <input> renders while this is set,
  // positioned over the click point in canvas-space; null once committed or cancelled.
  const [textEditState, setTextEditState] = useState<{
    canvasX: number;
    canvasY: number;
    value: string;
  } | null>(null);

  // Generic canvas-snapshot undo stack, reused by every tool this editor
  // ever gets (draw here; shapes/censor/text/erase/crop in subtasks 14-17) -
  // a ref, not state, since pushing/popping shouldn't itself trigger a
  // re-render. Each entry is the full pixel state right before an undoable
  // action was committed.
  // Each entry also carries whatever `originalImageRef` was at push time, so
  // undo can restore it alongside the pixels - crop is the only tool that
  // rebases `originalImageRef`, but pairing it unconditionally keeps every
  // other tool's restore a no-op instead of special-casing crop here.
  const historyRef = useRef<{ snapshot: ImageData; originalImage: ImageData | null }[]>([]);

  // Captures the canvas's current pixels and pushes them onto `historyRef` -
  // call this right before making any undoable change. Named/shaped
  // generically (not draw-specific) so later tools push to the same stack.
  // Returns just the pixel snapshot (not the paired originalImage) since
  // that's all existing call sites use as their live-preview restore base.
  function pushHistorySnapshot(): ImageData | null {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push({ snapshot, originalImage: originalImageRef.current });
    if (historyRef.current.length > MAX_UNDO_HISTORY) {
      historyRef.current.shift();
    }
    return snapshot;
  }

  // Ctrl+Z (only - no redo, per this subtask's scope): pops the most recent
  // snapshot and restores the canvas (and originalImageRef) to it.
  function handleUndo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const entry = historyRef.current.pop();
    if (!canvas || !ctx || !entry) return;
    const { snapshot, originalImage } = entry;
    // Crop is the first tool that changes canvas dimensions - resize back to
    // the snapshot's own size before writing its pixels, or putImageData
    // would just repaint the top-left overlap of a mismatched-size canvas.
    if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
    }
    ctx.putImageData(snapshot, 0, 0);
    originalImageRef.current = originalImage;
  }

  // Scoped to this window only, while it's mounted - same modifier-check
  // convention as components/theme/ThemeEditor.tsx's own Ctrl+Z handling.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isUndoShortcut =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z";
      if (!isUndoShortcut) return;
      // Same target-exclusion as ThemeEditor.tsx's Ctrl+Z - lets the text
      // tool's overlay <input> use the browser's normal text-undo instead.
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      // A pending crop isn't yet committed or cancelled, and its snapshot is
      // still sitting on top of `historyRef` - undoing straight through it
      // would desync the confirm/cancel UI from the canvas and corrupt
      // history (see cancelCrop's own pop). Treat Ctrl+Z as "cancel the
      // pending crop" instead, which pops exactly that snapshot.
      if (cropRect) {
        cancelCrop();
        return;
      }
      handleUndo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cropRect]);

  function canvasPointFromEvent(
    e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>,
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  // Inverse of canvasPointFromEvent's scale conversion - turns a canvas-space
  // point back into a CSS position for the text overlay <input>, which sits
  // in the same offsetParent as the canvas (see the relative wrapper below).
  function displayPointFromCanvasPoint(point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { left: 0, top: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      left: canvas.offsetLeft + point.x / scaleX,
      top: canvas.offsetTop + point.y / scaleY,
    };
  }

  // Draws one shape (rectangle/ellipse/line) from `start` to `end` on `ctx`,
  // using the same red-stroke convention as the draw tool.
  function strokeShape(
    ctx: CanvasRenderingContext2D,
    type: ShapeType,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(3, (canvasRef.current?.width ?? 800) / 200);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (type === "rectangle") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      ctx.strokeRect(x, y, Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    } else if (type === "ellipse") {
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  // Draws the censor box from `start` to `end` on `ctx`: solid black fill,
  // or a real blur (native canvas filter, not a hand-rolled convolution) of
  // that region pulled from `base`.
  function drawCensorBox(
    ctx: CanvasRenderingContext2D,
    base: ImageData,
    mode: CensorMode,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w === 0 || h === 0) return;

    if (mode === "black") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, w, h);
      return;
    }

    // Blur mode: render the base image's own pixels through a temporary
    // offscreen canvas so ctx.filter's blur only samples this region's
    // source pixels (not whatever the preview already drew on top).
    const offscreen = document.createElement("canvas");
    offscreen.width = base.width;
    offscreen.height = base.height;
    const offscreenCtx = offscreen.getContext("2d");
    if (!offscreenCtx) return;
    offscreenCtx.putImageData(base, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = `blur(${censorBlurRadius(base.width)}px)`;
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  // Restores just the brushed square from the original loaded image onto the
  // canvas, undoing whatever draw/shape/censor/text/erase had touched that
  // spot. A square dab (not a true circle) - the simplest correct use of
  // putImageData's source-rectangle overload for this scope.
  function eraseDab(ctx: CanvasRenderingContext2D, point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const original = originalImageRef.current;
    if (!canvas || !original) return;
    const radius = eraseBrushRadius(canvas.width);
    ctx.putImageData(original, 0, 0, point.x - radius, point.y - radius, radius * 2, radius * 2);
  }

  // Dashed selection-rectangle overlay for the crop tool's live preview -
  // drawn on top of the unchanged image, doesn't alter underlying pixels.
  function drawCropOverlay(
    ctx: CanvasRenderingContext2D,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(2, (canvasRef.current?.width ?? 800) / 300);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // Called on pointer-up once a crop drag ends - resolves the dragged
  // rectangle into `cropRect` (showing the confirm/cancel UI), or cancels
  // outright if the drag was too small to be intentional.
  function finalizeCropDrag(end: { x: number; y: number }) {
    const start = cropStartRef.current;
    cropStartRef.current = null;
    const canvas = canvasRef.current;
    if (!start || !canvas) return;
    const x = Math.round(Math.min(start.x, end.x));
    const y = Math.round(Math.min(start.y, end.y));
    const w = Math.round(Math.abs(end.x - start.x));
    const h = Math.round(Math.abs(end.y - start.y));
    if (w < 2 || h < 2) {
      cancelCrop();
      return;
    }
    // Clamp to canvas bounds in case the drag ended outside the canvas.
    const clampedX = Math.max(0, Math.min(x, canvas.width - 1));
    const clampedY = Math.max(0, Math.min(y, canvas.height - 1));
    setCropRect({
      x: clampedX,
      y: clampedY,
      w: Math.min(w, canvas.width - clampedX),
      h: Math.min(h, canvas.height - clampedY),
    });
  }

  // Trims the canvas to the pending crop rectangle. The pre-crop snapshot
  // was already pushed to history on pointer-down (before any resize), so
  // undo restores both the pixels and (via handleUndo's dimension fix) the
  // canvas's previous size.
  function applyCrop() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const base = cropBaseRef.current;
    if (!canvas || !ctx || !base || !cropRect) return;
    ctx.putImageData(base, 0, 0); // clear the dashed preview before extracting
    const cropped = ctx.getImageData(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    canvas.width = cropRect.w;
    canvas.height = cropRect.h;
    ctx.putImageData(cropped, 0, 0);
    // originalImageRef would otherwise be stale (wrong size/offset) after a
    // crop - rebase it to the freshly cropped canvas so erase keeps working.
    originalImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cropBaseRef.current = null;
    setCropRect(null);
  }

  // Discards the pending crop preview and pops the unused history snapshot,
  // matching the text tool's cancel-discards-snapshot convention.
  function cancelCrop() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && cropBaseRef.current) ctx.putImageData(cropBaseRef.current, 0, 0);
    historyRef.current.pop();
    cropBaseRef.current = null;
    cropStartRef.current = null;
    setCropRect(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (
      activeTool !== "draw" &&
      activeTool !== "shape" &&
      activeTool !== "censor" &&
      activeTool !== "erase" &&
      activeTool !== "crop"
    )
      return;
    if (activeTool === "crop" && cropRect) return; // a crop is already pending confirm/cancel
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = canvasPointFromEvent(e);
    if (!canvas || !ctx || !point) return;
    // Snapshot the pre-change state now, before any pixels change, so
    // undoing this action restores exactly what was here before it started.
    const snapshot = pushHistorySnapshot();
    isPointerDownRef.current = true;

    if (activeTool === "shape") {
      shapeStartRef.current = point;
      // Reuses the same snapshot just pushed onto history (putImageData only
      // reads it, never mutates it) instead of capturing the canvas twice.
      shapeBaseRef.current = snapshot;
      return;
    }

    if (activeTool === "censor") {
      censorStartRef.current = point;
      censorBaseRef.current = snapshot;
      return;
    }

    if (activeTool === "erase") {
      eraseDab(ctx, point); // dab immediately so even a single click erases
      return;
    }

    if (activeTool === "crop") {
      cropStartRef.current = point;
      cropBaseRef.current = snapshot;
      return;
    }

    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(3, (canvasRef.current?.width ?? 800) / 200);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isPointerDownRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = canvasPointFromEvent(e);
    if (!ctx || !point) return;

    if (activeTool === "shape") {
      const start = shapeStartRef.current;
      const base = shapeBaseRef.current;
      if (!start || !base) return;
      // Restore the pre-drag pixels first, then draw the in-progress shape
      // on top - avoids smearing since the previous preview frame isn't kept.
      ctx.putImageData(base, 0, 0);
      strokeShape(ctx, shapeType, start, point);
      return;
    }

    if (activeTool === "censor") {
      const start = censorStartRef.current;
      const base = censorBaseRef.current;
      if (!start || !base) return;
      ctx.putImageData(base, 0, 0);
      drawCensorBox(ctx, base, censorMode, start, point);
      return;
    }

    if (activeTool === "erase") {
      eraseDab(ctx, point);
      return;
    }

    if (activeTool === "crop") {
      const start = cropStartRef.current;
      const base = cropBaseRef.current;
      if (!start || !base) return; // no active drag (e.g. confirm already pending)
      ctx.putImageData(base, 0, 0);
      drawCropOverlay(ctx, start, point);
      return;
    }

    if (activeTool !== "draw") return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const wasCropDragging = activeTool === "crop" && isPointerDownRef.current && cropStartRef.current;
    isPointerDownRef.current = false;
    shapeStartRef.current = null;
    shapeBaseRef.current = null;
    censorStartRef.current = null;
    censorBaseRef.current = null;
    if (wasCropDragging) {
      const point = canvasPointFromEvent(e) ?? cropStartRef.current;
      if (point) finalizeCropDrag(point);
    }
  }

  // Text tool is a single click, not a drag, so it's wired to onClick rather
  // than the pointerdown/move/up trio the other tools share.
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool !== "text" || textEditState) return;
    const point = canvasPointFromEvent(e);
    if (!point) return;
    // Push before the change, same as draw/shape/censor push on pointer-down -
    // discarded later if the user cancels or leaves the text empty.
    pushHistorySnapshot();
    textCommittedRef.current = false;
    setTextEditState({ canvasX: point.x, canvasY: point.y, value: "" });
  }

  // Bakes the pending text into the canvas at its original click coordinates,
  // or - on cancel/empty text - discards the snapshot pushed when editing started.
  function commitTextEdit(cancel: boolean) {
    const state = textEditState;
    if (textCommittedRef.current || !state) return;
    textCommittedRef.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (cancel || !state.value.trim() || !canvas || !ctx) {
      historyRef.current.pop();
      setTextEditState(null);
      return;
    }
    ctx.font = `${Math.max(16, canvas.width / 40)}px sans-serif`;
    ctx.fillStyle = "#ef4444";
    ctx.textBaseline = "top";
    ctx.fillText(state.value, state.canvasX, state.canvasY);
    setTextEditState(null);
  }

  // Any tool switch commits pending text first, so it's baked (or discarded
  // if empty) rather than silently abandoned mid-edit.
  function switchTool(tool: Tool) {
    if (textEditState) commitTextEdit(false);
    if (cropRect) cancelCrop();
    setActiveTool((t) => (t === tool ? "none" : tool));
  }

  // Enter/Escape confirm-or-cancel a pending crop, mirroring the text tool's
  // own keyboard pattern - only active while a crop rectangle awaits confirmation.
  useEffect(() => {
    if (!cropRect) return;
    function handleCropKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        applyCrop();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelCrop();
      }
    }
    window.addEventListener("keydown", handleCropKeyDown);
    return () => window.removeEventListener("keydown", handleCropKeyDown);
  }, [cropRect]);

  // Canvas is always mounted (never conditionally rendered out) so
  // `canvasRef.current` is already available by the time the image finishes
  // loading below - only its visibility toggles on `loading`/`error`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await fileToDataUrl(path);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          // Captured once, never mutated - the erase tool's restore source.
          originalImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
          setLoading(false);
        };
        img.onerror = () => {
          if (!cancelled) {
            setError("Couldn't load this image.");
            setLoading(false);
          }
        };
        img.src = dataUrl;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function handleClose() {
    // Best-effort cleanup of the temp file lib/imageEditorWindow.ts wrote -
    // doesn't catch force-quit/crash; a startup sweep of orphaned files is
    // deferred to subtask 18 (real save/close).
    try {
      const { remove } = await import("@tauri-apps/plugin-fs");
      await remove(path);
    } catch {
      // Non-fatal - still close the window even if cleanup failed.
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-2 px-3"
        style={{ background: "var(--primary)" }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary-foreground">
          Image editor
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-primary-foreground hover:bg-black/10 hover:text-primary-foreground"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!loading && !error && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button
            variant={activeTool === "draw" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("draw")}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Draw
          </Button>
          <Button
            variant={activeTool === "shape" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("shape")}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Shape
          </Button>
          {activeTool === "shape" && (
            <div className="flex items-center gap-1">
              <Button
                variant={shapeType === "rectangle" ? "default" : "outline"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setShapeType("rectangle")}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={shapeType === "ellipse" ? "default" : "outline"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setShapeType("ellipse")}
              >
                <Circle className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={shapeType === "line" ? "default" : "outline"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setShapeType("line")}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant={activeTool === "censor" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("censor")}
          >
            <EyeOff className="mr-1.5 h-3.5 w-3.5" />
            Censor
          </Button>
          {activeTool === "censor" && (
            <div className="flex items-center gap-1">
              <Button
                variant={censorMode === "black" ? "default" : "outline"}
                size="sm"
                className="h-7"
                onClick={() => setCensorMode("black")}
              >
                Black
              </Button>
              <Button
                variant={censorMode === "blur" ? "default" : "outline"}
                size="sm"
                className="h-7"
                onClick={() => setCensorMode("blur")}
              >
                Blur
              </Button>
            </div>
          )}
          <Button
            variant={activeTool === "text" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("text")}
          >
            <Type className="mr-1.5 h-3.5 w-3.5" />
            Text
          </Button>
          <Button
            variant={activeTool === "erase" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("erase")}
          >
            <Eraser className="mr-1.5 h-3.5 w-3.5" />
            Erase
          </Button>
          <Button
            variant={activeTool === "crop" ? "default" : "outline"}
            size="sm"
            onClick={() => switchTool("crop")}
          >
            <Crop className="mr-1.5 h-3.5 w-3.5" />
            Crop
          </Button>
        </div>
      )}
      <div className="relative flex flex-1 items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleCanvasClick}
          style={{
            cursor: activeTool === "text" ? "text" : activeTool !== "none" ? "crosshair" : "default",
          }}
          className={`max-h-full max-w-full border border-border ${loading || error ? "hidden" : ""}`}
        />
        {loading && (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
        {error && <span className="text-sm text-muted-foreground">{error}</span>}
        {textEditState &&
          (() => {
            const { left, top } = displayPointFromCanvasPoint({
              x: textEditState.canvasX,
              y: textEditState.canvasY,
            });
            // Same font-size formula as the baked fillText, scaled down by the
            // canvas's own CSS-vs-natural ratio so the overlay visually matches.
            const canvas = canvasRef.current;
            const rect = canvas?.getBoundingClientRect();
            const scaleY = canvas && rect ? canvas.height / rect.height : 1;
            const fontSize = canvas ? Math.max(16, canvas.width / 40) / scaleY : 24;
            return (
              <input
                autoFocus
                value={textEditState.value}
                onChange={(e) =>
                  setTextEditState((s) => (s ? { ...s, value: e.target.value } : s))
                }
                onBlur={() => commitTextEdit(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitTextEdit(true);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitTextEdit(false);
                  }
                }}
                style={{
                  position: "absolute",
                  left,
                  top,
                  font: `${fontSize}px sans-serif`,
                  color: "#ef4444",
                  background: "transparent",
                  border: "1px dashed #ef4444",
                  outline: "none",
                  padding: 0,
                  minWidth: "4ch",
                }}
              />
            );
          })()}
        {cropRect &&
          (() => {
            const { left, top } = displayPointFromCanvasPoint({
              x: cropRect.x + cropRect.w,
              y: cropRect.y + cropRect.h,
            });
            return (
              <div style={{ position: "absolute", left, top: top + 4, display: "flex", gap: 4 }}>
                <Button size="sm" className="h-7" onClick={applyCrop}>
                  Apply Crop
                </Button>
                <Button size="sm" variant="outline" className="h-7" onClick={cancelCrop}>
                  Cancel
                </Button>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
