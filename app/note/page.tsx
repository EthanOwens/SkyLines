"use client";

// spec.md subtask 6 ("Merge note creation UI: retire the separate 'New
// canvas' action"). `/note?id=...` is retired as a distinct full-page
// linear-editor route - every note (old `type: "note"` rows included) now
// opens through the merged free-form-canvas editor at `/canvas?id=...`
// (components/canvas/CanvasEditor.tsx / app/canvas/page.tsx). This page is
// kept only as a redirect, preserving the `id` query param, so old
// bookmarks/links and anything still left in the note-history stack don't
// dead-end.
//
// This redirect is SAFE for old-format notes (real Tiptap `content`, no
// `canvasData` yet): CanvasEditor.tsx detects that case on mount and
// performs a minimal, idempotent inline migration - wrapping the note's
// existing `content` into a single RichTextShape and saving that as
// `canvasData` - before rendering, so the old content becomes visible
// immediately instead of appearing to have vanished on a blank canvas. See
// CanvasEditor.tsx's header comment for the full reasoning; a startup/
// backfill pass over notes that are never individually opened this way is
// still spec.md subtask 8's job.
//
// Uses the same `useSearchParams()` + `<Suspense>` pattern the rest of this
// codebase's query-param routes use (see app/canvas/page.tsx's identical
// header comment for why `<Suspense>` is required here for Next's static
// export), and `router.replace()` (not `push()`) so this redirect doesn't
// itself become a dead entry in browser history - matching the established
// convention in components/AppShell.tsx's own last-open-note restore
// redirect.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function NoteRedirectInner() {
  const router = useRouter();
  const id = useSearchParams().get("id");

  useEffect(() => {
    router.replace(id ? `/canvas?id=${id}` : "/canvas");
  }, [id, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export default function NotePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <NoteRedirectInner />
    </Suspense>
  );
}
