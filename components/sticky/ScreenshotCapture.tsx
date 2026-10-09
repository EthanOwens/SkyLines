"use client";

// Pick an open window, capture it with tauri-plugin-screenshots, optionally
// draw on the preview, then double-click to create a sticky note from it.
// Drawings are baked into the image; a saved note's image can't be drawn on
// again here.

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ScreenshotableWindow {
  id: number;
  name: string;
  title: string;
  appName: string;
}

interface ScreenshotCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a Tiptap `image` node's `src` data URL once the user double-clicks the preview. */
  onCapture: (dataUrl: string) => void;
}

// Builds the data URL in chunks: String.fromCharCode(...bytes) overflows the
// call stack on a full-resolution screenshot.
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

export function ScreenshotCapture({ open, onOpenChange, onCapture }: ScreenshotCaptureProps) {
  const [windows, setWindows] = useState<ScreenshotableWindow[] | null>(null);
  const [capturing, setCapturing] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setWindows(null);
      setPreviewSrc(null);
      setCapturing(null);
      setCaptureError(null);
      return;
    }
    void (async () => {
      const { getScreenshotableWindows } = await import("tauri-plugin-screenshots-api");
      setWindows(await getScreenshotableWindows());
    })();
  }, [open]);

  // The drawing canvas uses the image's full resolution so strokes bake in at
  // full quality; CSS scales it down.
  function handleImageLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    const point = canvasPointFromEvent(e);
    if (!ctx || !point) return;
    isPointerDownRef.current = true;
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
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function handlePointerUp() {
    isPointerDownRef.current = false;
  }

  function handleClearDrawing() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function handleSelectWindow(win: ScreenshotableWindow) {
    setCapturing(win.id);
    setCaptureError(null);
    try {
      const { getWindowScreenshot } = await import("tauri-plugin-screenshots-api");
      const path = await getWindowScreenshot(win.id);
      setPreviewSrc(await fileToDataUrl(path));
    } catch (err) {
      // The window list isn't live, so the target can close or minimize before
      // it's captured.
      setCaptureError(err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(null);
    }
  }

  function handleCreateFromPreview() {
    const img = imgRef.current;
    const drawCanvas = canvasRef.current;
    if (!img || !drawCanvas) return;

    const bake = document.createElement("canvas");
    bake.width = img.naturalWidth;
    bake.height = img.naturalHeight;
    const ctx = bake.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);

    onCapture(bake.toDataURL("image/png"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Screenshot a window</DialogTitle>
        </DialogHeader>

        {previewSrc ? (
          <div className="flex flex-col gap-2">
            <div className="relative w-fit select-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={previewSrc}
                alt="Captured window preview"
                onLoad={handleImageLoad}
                onDoubleClick={handleCreateFromPreview}
                className="max-h-[55vh] max-w-full rounded-md border border-border"
              />
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onDoubleClick={handleCreateFromPreview}
                className="absolute inset-0 h-full w-full"
                style={{ cursor: drawing ? "crosshair" : "default", pointerEvents: drawing ? "auto" : "none" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant={drawing ? "default" : "outline"} size="sm" onClick={() => setDrawing((d) => !d)}>
                {drawing ? "Drawing on" : "Draw"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleClearDrawing}>
                Clear drawing
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreviewSrc(null)}>
                Back to windows
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                Double-click the image to create a sticky note
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {captureError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                Couldn't capture that window: {captureError}
              </div>
            )}
            {windows === null ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading windows…</div>
            ) : windows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No open windows found</div>
            ) : (
              windows.map((win) => (
                <button
                  key={win.id}
                  type="button"
                  disabled={capturing !== null}
                  onClick={() => void handleSelectWindow(win)}
                  className="flex items-center gap-2 rounded-md border border-border p-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{win.title || win.appName || win.name}</span>
                  {capturing === win.id && (
                    <span className="ml-auto text-xs text-muted-foreground">Capturing…</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
