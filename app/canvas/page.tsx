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
import { resolveNoteNotebookId } from "@/lib/notebookSync";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { PageSidebar } from "@/components/sidebar/PageSidebar";
import { useAppStore } from "@/stores/appStore";
import type { Note } from "@/types";

function CanvasPageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);
  const visitNote = useAppStore((s) => s.visitNote);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getNoteById(id)
      .then((n) => {
        if (cancelled) return;
        setNote(n);
        if (n) {
          // Remember this as the last-open note (spec.md subtask 5) once
          // it's confirmed to exist - best-effort, never blocks rendering.
          void recordNoteOpened(n);

          // Keep selectedNotebookId in sync with whichever note is actually
          // being viewed (spec.md subtask 14 correctness requirement) - see
          // app/note/page.tsx for the identical logic/rationale.
          const { notebooks: liveNotebooks, notebooksLoaded: liveLoaded } =
            useAppStore.getState();
          setSelectedNotebook(
            resolveNoteNotebookId(n.notebookId, liveNotebooks, liveLoaded),
          );

          // Record a history-stack visit (spec.md subtask 14) UNLESS this
          // navigation was triggered by clicking Back/Forward in
          // TopBar.tsx - see app/note/page.tsx for the identical
          // logic/rationale.
          if (useAppStore.getState().isHistoryNavigation) {
            useAppStore.getState().setIsHistoryNavigation(false);
          } else {
            visitNote({ noteId: n.id });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setNote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, setSelectedNotebook, visitNote]);

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

  return (
    <div className="flex h-full w-full">
      {/* spec.md M6 subtask 17 ("Page sidebar") - a new, dedicated sidebar
          for this note's Pages, distinct from the notebook/folder tree
          Sidebar (components/sidebar/Sidebar.tsx) rendered further out by
          AppLayout.tsx. Only mounted here, once a note has actually loaded -
          matches the spec's "appears once a note is open" requirement. */}
      <PageSidebar note={note} />
      <CanvasEditor key={note.id} note={note} />
    </div>
  );
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
