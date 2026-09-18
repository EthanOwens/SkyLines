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
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  path: string;
}

// Any later tool (shape/censor/text/erase/crop) added in this dropdown as it
// grows across subtasks 14-17.
type Tool = "none" | "draw";

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
  const isPointerDownRef = useRef(false);

  // Generic canvas-snapshot undo stack, reused by every tool this editor
  // ever gets (draw here; shapes/censor/text/erase/crop in subtasks 14-17) -
  // a ref, not state, since pushing/popping shouldn't itself trigger a
  // re-render. Each entry is the full pixel state right before an undoable
  // action was committed.
  const historyRef = useRef<ImageData[]>([]);

  // Captures the canvas's current pixels and pushes them onto `historyRef` -
  // call this right before making any undoable change. Named/shaped
  // generically (not draw-specific) so later tools push to the same stack.
  function pushHistorySnapshot() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > MAX_UNDO_HISTORY) {
      historyRef.current.shift();
    }
  }

  // Ctrl+Z (only - no redo, per this subtask's scope): pops the most recent
  // snapshot and restores the canvas to it.
  function handleUndo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = historyRef.current.pop();
    if (!canvas || !ctx || !snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
  }

  // Scoped to this window only, while it's mounted - same modifier-check
  // convention as components/theme/ThemeEditor.tsx's own Ctrl+Z handling.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isUndoShortcut =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z";
      if (!isUndoShortcut) return;
      // Same target-exclusion as ThemeEditor.tsx's Ctrl+Z - matters once a
      // later tool (e.g. the text tool, subtask 16) adds a real text input.
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      handleUndo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool !== "draw") return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = canvasPointFromEvent(e);
    if (!ctx || !point) return;
    // Snapshot the pre-stroke state now, before any pixels change, so
    // undoing this stroke restores exactly what was here before it started.
    pushHistorySnapshot();
    isPointerDownRef.current = true;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(3, (canvasRef.current?.width ?? 800) / 200);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool !== "draw" || !isPointerDownRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = canvasPointFromEvent(e);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function handlePointerUp() {
    isPointerDownRef.current = false;
  }

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
            onClick={() => setActiveTool((t) => (t === "draw" ? "none" : "draw"))}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Draw
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
          style={{ cursor: activeTool === "draw" ? "crosshair" : "default" }}
          className={`max-h-full max-w-full border border-border ${loading || error ? "hidden" : ""}`}
        />
        {loading && (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
        {error && <span className="text-sm text-muted-foreground">{error}</span>}
      </div>
    </div>
  );
}
