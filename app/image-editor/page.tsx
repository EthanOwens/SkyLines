"use client";

// Loaded only in its own window (see lib/imageEditorWindow.ts), outside the app
// shell.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ImageEditor } from "@/components/editor/ImageEditor";

function ImageEditorPageInner() {
  // get() already percent-decodes the value.
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
