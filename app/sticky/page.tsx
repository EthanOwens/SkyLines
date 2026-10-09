"use client";

// Loaded only in a sticky note's own window (see lib/stickyWindow.ts), outside
// the app shell.

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
