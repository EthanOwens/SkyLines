"use client";

// spec.md subtask 8 ("Sticky note pop-out window"). This route is only ever
// loaded inside its own dedicated Tauri window (see lib/stickyWindow.ts,
// which opens it at `/sticky/?id=...`), never inside the main app's
// AppLayout shell - components/AppShell.tsx special-cases this pathname to
// render `children` directly, with none of the ribbon/sidebar chrome.
//
// Mirrors app/canvas/page.tsx's `useSearchParams()` + `<Suspense>` pattern
// (required for `useSearchParams()` under this repo's static export, see
// that file's header comment) and its loading/not-found states.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getStickyNoteById } from "@/lib/db/stickyNotes";
import { StickyNoteEditor } from "@/components/editor/StickyNoteEditor";
import type { StickyNote } from "@/types";

function StickyPageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<StickyNote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getStickyNoteById(id)
      .then((n) => {
        if (!cancelled) setNote(n);
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
  }, [id]);

  if (!id) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        No sticky note selected.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Sticky note not found.
      </div>
    );
  }

  return <StickyNoteEditor key={note.id} note={note} />;
}

export default function StickyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <StickyPageInner />
    </Suspense>
  );
}
