"use client";

// Adapted from ../note_taking_app/app/canvas/[id]/page.tsx (spec.md subtask
// 18, M4 "canvas editor"). Two changes from the reference, matching the same
// two bug fixes already applied to app/note/page.tsx (subtask 17):
//
//   1. Routing (subtask 5): reads the note id via `useSearchParams().get
//      ("id")` instead of `useParams()`, since this repo uses query-param
//      routing (`/canvas?id=...`) rather than a `[id]` dynamic segment.
//      `useSearchParams()` requires a `<Suspense>` boundary for Next's
//      static export (`output: "export"`, see next.config.ts) - the default
//      export below wraps the real page body in one, per Next.js's
//      documented requirement for this hook in static/SSG contexts.
//
//   2. The reference's `useEffect` neither handled a missing `id` (it left
//      `loading` stuck at `true` forever, falling through to an endless
//      spinner) nor a rejected `getNoteById` call (same stuck-spinner
//      failure mode). Here, a missing `id` sets `loading` to `false`
//      immediately and renders a distinct "No canvas selected" message, and
//      a rejected fetch is caught and falls through to the existing
//      "Canvas not found" UI via `.catch()`/`.finally()`.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getNoteById } from "@/lib/db/notes";
import { recordNoteOpened } from "@/lib/lastOpen";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import type { Note } from "@/types";

function CanvasPageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getNoteById(id)
      .then((n) => {
        setNote(n);
        // Remember this as the last-open note (spec.md subtask 5) once it's
        // confirmed to exist - best-effort, never blocks rendering.
        if (n) void recordNoteOpened(n);
      })
      .catch(() => setNote(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No canvas selected.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Canvas not found.
      </div>
    );
  }

  return <CanvasEditor key={note.id} note={note} />;
}

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <CanvasPageInner />
    </Suspense>
  );
}
