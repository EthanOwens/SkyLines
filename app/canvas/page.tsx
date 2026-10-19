"use client";

// Routes use query params (/canvas?id=...) because of the static export, and
// useSearchParams() needs the <Suspense> boundary in the default export.

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
          // Best-effort; never blocks rendering.
          void recordNoteOpened(n);

          // Keep the selected notebook in step with the note being viewed.
          const { notebooks: liveNotebooks, notebooksLoaded: liveLoaded } =
            useAppStore.getState();
          setSelectedNotebook(
            resolveNoteNotebookId(n.notebookId, liveNotebooks, liveLoaded),
          );

          // Back/Forward navigation must not push a new history entry.
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
