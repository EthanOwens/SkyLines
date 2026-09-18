"use client";

// spec.md subtask 12 ("Image editor pop-out shell"). Only ever loaded inside
// its own dedicated Tauri window (see lib/imageEditorWindow.ts, which opens
// it at `/image-editor/?path=...`), never inside the main app's AppLayout
// shell - components/AppShell.tsx special-cases this pathname the same way
// it already does `/sticky`.
//
// Mirrors app/sticky/page.tsx's `useSearchParams()` + `<Suspense>` pattern
// (required for `useSearchParams()` under this repo's static export).

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ImageEditor } from "@/components/editor/ImageEditor";

function ImageEditorPageInner() {
  // `useSearchParams().get()` already percent-decodes the value, so no
  // further `decodeURIComponent` is needed here.
  const path = useSearchParams().get("path");

  if (!path) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        No image selected.
      </div>
    );
  }

  return <ImageEditor path={path} />;
}

export default function ImageEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ImageEditorPageInner />
    </Suspense>
  );
}
