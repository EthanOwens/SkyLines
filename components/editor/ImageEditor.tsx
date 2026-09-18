"use client";

// spec.md subtask 12 ("Image editor pop-out shell"). The pop-out window's
// root content (see app/image-editor/page.tsx, and lib/imageEditorWindow.ts
// for how the window itself gets opened and how the image reaches it as a
// temp-file path rather than inline data).
//
// This subtask is ONLY the shell: load the image from disk onto a canvas at
// its natural resolution, plus a minimal top bar with a Close button. No
// drawing tools yet - those are later subtasks (13-18).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  path: string;
}

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
      <div className="relative flex flex-1 items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
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
