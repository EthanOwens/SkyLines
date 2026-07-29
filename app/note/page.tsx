"use client";

// Adapted from ../note_taking_app/app/note/[id]/page.tsx (spec.md subtask
// 17, M4 "rich text editor"). Two changes from the reference:
//
//   1. Routing (subtask 5): reads the note id via `useSearchParams().get
//      ("id")` instead of `useParams()`, since this repo uses query-param
//      routing (`/note?id=...`) rather than a `[id]` dynamic segment.
//      `useSearchParams()` requires a `<Suspense>` boundary for Next's
//      static export (`output: "export"`, see next.config.ts) - the default
//      export below wraps the real page body in one, per Next.js's
//      documented requirement for this hook in static/SSG contexts.
//
//   2. No manual `setSyncStatus("syncing"/"saved"/"error")` calls around the
//      save. The reference toggled `syncStatus` itself because it wrote
//      straight to Firestore. Here, saves go through lib/db/notes.ts's
//      `updateNote`, which writes to local SQLite and (via the
//      change-notification -> useSyncEngine.ts chain wired in subtask 15)
//      automatically schedules a real, debounced Firestore push - the real
//      `syncStatus` in stores/appStore.ts already reflects that actual push
//      activity, so this page no longer needs to fake it. A local debounce
//      is still kept on the content-change autosave (same 600ms as the
//      reference) purely to avoid a SQLite write on every keystroke; the
//      title save stays on-blur/undebounced, matching the reference's
//      `onTitleChange` timing.

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { getNoteById, updateNote } from "@/lib/db/notes";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import type { Note } from "@/types";

function NotePageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getNoteById(id)
      .then((n) => setNote(n))
      .catch(() => setNote(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = useCallback(
    (content: object) => {
      if (!id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void updateNote(id, { content });
      }, 600);
    },
    [id],
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!id) return;
      void updateNote(id, { title });
    },
    [id],
  );

  if (!id) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No note selected.
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
        Note not found.
      </div>
    );
  }

  return (
    <RichTextEditor
      note={note}
      onChange={handleChange}
      onTitleChange={handleTitleChange}
    />
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
      <NotePageInner />
    </Suspense>
  );
}
