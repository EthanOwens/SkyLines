"use client";

// Content of the image editor window (opened by lib/imageEditorWindow.ts).
// Every tool pushes a canvas snapshot onto one shared undo stack.

import { useEffect, useRef, useState } from "react";
import { Circle, Crop, Eraser, EyeOff, Minus, Pencil, Save, Square, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWindowDrag } from "@/hooks/useWindowDrag";

interface Props {
  path: string;
}

// The temp file is named <sourceId>.png, so the id comes from the path rather
// than a second query param.
function sourceIdFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.png$/, "");
}

type Tool = "none" | "draw" | "shape" | "censor" | "text" | "erase" | "crop";

type ShapeType = "rectangle" | "ellipse" | "line";

type CensorMode = "black" | "blur";

// Much stronger than the stroke-width ratio so censoring stays opaque on
// high-resolution screenshots.
function censorBlurRadius(canvasWidth: number): number {
  return Math.max(10, canvasWidth / 80);
}

function eraseBrushRadius(canvasWidth: number): number {
  return Math.max(8, canvasWidth / 100);
}

// Bounds memory used by full-canvas snapshots.
const MAX_UNDO_HISTORY = 50;

// Decodes in chunks so a full-resolution image doesn't overflow the call stack.
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
  const windowDrag = useWindowDrag();
  const isPointerDownRef = useRef(false);
  // The preview restores this snapshot on every move before redrawing, so it
  // doesn't smear.
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeBaseRef = useRef<ImageData | null>(null);
  const censorStartRef = useRef<{ x: number; y: number } | null>(null);
  const censorBaseRef = useRef<ImageData | null>(null);
  // The loaded image's pixels, never changed (crop aside); erase restores from
  // this.
  const originalImageRef = useRef<ImageData | null>(null);
  // Kept after pointer-up until the crop is confirmed or cancelled.
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropBaseRef = useRef<ImageData | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  // Synchronous guard: an onBlur from the unmounting input can fire after
  // Escape cancels, and state updates aren't synchronous enough to stop it.
  const textCommittedRef = useRef(false);
  const [textEditState, setTextEditState] = useState<{
    canvasX: number;
    canvasY: number;
    value: string;
  } | null>(null);
  // Cleared about 1.5s after a successful copy.
  const [copiedFlash, setCopiedFlash] = useState(false);

  // Undo stack of full-canvas snapshots, in a ref so pushing doesn't re-render.
  // Each entry also stores originalImageRef, which only crop changes.
  const historyRef = useRef<{ snapshot: ImageData; originalImage: ImageData | null }[]>([]);

  // Call right before any undoable change.
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

  // Ctrl+Z only; there's no redo.
  function handleUndo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const entry = historyRef.current.pop();
    if (!canvas || !ctx || !entry) return;
    const { snapshot, originalImage } = entry;
    // Crop changes the canvas size, so restore the snapshot's size before
    // writing its pixels.
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
      // Let the text overlay input keep the browser's own text undo.
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      // Undoing past a pending crop would desync the confirm UI from history,
      // so Ctrl+Z cancels the crop instead.
      if (cropRect) {
        cancelCrop();
        return;
      }
      handleUndo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cropRect]);

  // Image.new(rgba, width, height) builds the raw-RGBA image variant. Passing a
  // plain byte array instead makes the plugin decode it as an encoded image
  // file, which corrupts the pixels.
  async function copyToClipboard() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { Image } = await import("@tauri-apps/api/image");
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const image = await Image.new(new Uint8Array(data), canvas.width, canvas.height);
    await writeImage(image);
    setCopiedFlash(true);
  }

  useEffect(() => {
    if (!copiedFlash) return;
    const timer = setTimeout(() => setCopiedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, [copiedFlash]);

  // Ctrl+C / Cmd+C. Skips inputs so the text overlay keeps native copy.
  useEffect(() => {
    function handleCopyKeyDown(e: KeyboardEvent) {
      const isCopyShortcut =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c";
      if (!isCopyShortcut) return;
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      void copyToClipboard();
    }
    window.addEventListener("keydown", handleCopyKeyDown);
    return () => window.removeEventListener("keydown", handleCopyKeyDown);
  }, []);

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

  // Converts a canvas point back to a CSS position for the text overlay.
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

  // Solid black, or a real blur of that region using the canvas filter.
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

    // Blur from an offscreen copy so it samples only the base image, not the
    // preview drawn on top.
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

  // Restores a square from the original image. A square rather than a circle
  // because putImageData copies rectangles.
  function eraseDab(ctx: CanvasRenderingContext2D, point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const original = originalImageRef.current;
    if (!canvas || !original) return;
    const radius = eraseBrushRadius(canvas.width);
    ctx.putImageData(original, 0, 0, point.x - radius, point.y - radius, radius * 2, radius * 2);
  }

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

  // Shows the confirm/cancel UI, or cancels a drag too small to be intentional.
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

  // The pre-crop snapshot was pushed on pointer-down, so undo also restores the
  // old canvas size (see handleUndo).
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
    // Rebase the original image so erase still lines up after cropping.
    originalImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cropBaseRef.current = null;
    setCropRect(null);
  }

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
    const snapshot = pushHistorySnapshot();
    isPointerDownRef.current = true;

    if (activeTool === "shape") {
      shapeStartRef.current = point;
      // putImageData only reads the snapshot, so reuse it instead of capturing
      // again.
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

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool !== "text" || textEditState) return;
    const point = canvasPointFromEvent(e);
    if (!point) return;
    // Discarded if the text is cancelled or left empty.
    pushHistorySnapshot();
    textCommittedRef.current = false;
    setTextEditState({ canvasX: point.x, canvasY: point.y, value: "" });
  }

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

  // Commit pending text before switching so it isn't silently lost.
  function switchTool(tool: Tool) {
    if (textEditState) commitTextEdit(false);
    if (cropRect) cancelCrop();
    setActiveTool((t) => (t === tool ? "none" : tool));
  }

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

  // The canvas is always mounted so its ref exists when the image loads; only
  // its visibility changes.
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

  // Emits the edited image on image-editor:saved:<sourceId>. The window that
  // opened this editor listens for it and patches the original image node, then
  // saves through its own path.
  async function saveToSource() {
    const canvas = canvasRef.current;
    // Before the image loads the canvas is blank: never send that back.
    if (!canvas || loading || error) return;
    const dataUrl = canvas.toDataURL("image/png");
    const { emit } = await import("@tauri-apps/api/event");
    await emit(`image-editor:saved:${sourceIdFromPath(path)}`, dataUrl);
  }

  async function handleClose() {
    // Closing always saves. Best-effort, so a failed emit still closes the
    // window.
    try {
      await saveToSource();
    } catch {
      // Non-fatal - still close the window even if the save emit failed.
    }
    // Best-effort temp file cleanup; a crash or force-quit leaves the file
    // behind.
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
        {...windowDrag}
        className="flex h-10 shrink-0 items-center gap-2 px-3"
        style={{ background: "var(--primary)" }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary-foreground">
          Image editor
        </span>
        {!loading && !error && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-primary-foreground hover:bg-black/10 hover:text-primary-foreground"
            onClick={() => void saveToSource()}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        )}
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
        <div
          className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-300"
          style={{ opacity: copiedFlash ? 0.5 : 0 }}
        />
        <div
          className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background transition-opacity duration-300"
          style={{ opacity: copiedFlash ? 1 : 0 }}
        >
          Copied to clipboard
        </div>
        {textEditState &&
          (() => {
            const { left, top } = displayPointFromCanvasPoint({
              x: textEditState.canvasX,
              y: textEditState.canvasY,
            });
            // Same font size as the baked text, scaled to the canvas's display
            // size.
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
