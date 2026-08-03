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
import { recordNoteOpened } from "@/lib/lastOpen";
import { resolveNoteNotebookId } from "@/lib/notebookSync";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { useAppStore } from "@/stores/appStore";
import type { Note } from "@/types";

function NotePageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);
  const visitNote = useAppStore((s) => s.visitNote);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks a content edit that's been debounced but not yet written to
  // SQLite, along with the note id it belongs to (the id is captured here
  // rather than read fresh on unmount, since this page's editor isn't keyed
  // by note id - switching notes via the sidebar can change `id` in place
  // without unmounting, so relying on a closed-over `id` in the unmount
  // cleanup below could flush to the wrong note).
  const pendingContentRef = useRef<{ id: string; content: object } | null>(null);

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
          // being viewed (spec.md subtask 14 correctness requirement) - a
          // deep link or Back/Forward navigation can land on a note in a
          // different notebook than whatever's currently selected. Reads
          // the store directly (rather than subscribing notebooks/
          // notebooksLoaded into this effect's deps) so a notebooks refetch
          // elsewhere doesn't re-trigger this id-keyed fetch effect.
          const { notebooks: liveNotebooks, notebooksLoaded: liveLoaded } =
            useAppStore.getState();
          setSelectedNotebook(
            resolveNoteNotebookId(n.notebookId, liveNotebooks, liveLoaded),
          );

          // Record a history-stack visit (spec.md subtask 14) UNLESS this
          // navigation was triggered by clicking Back/Forward in TopBar.tsx
          // - goBack()/goForward() already moved historyIndex to the right
          // place, so re-pushing here would immediately truncate the very
          // forward-history the user just navigated back into. Read/consume
          // the flag directly from the store (rather than subscribing it
          // into this effect's deps) so flipping it back to `false` below
          // doesn't itself re-trigger this id-keyed fetch effect.
          if (useAppStore.getState().isHistoryNavigation) {
            useAppStore.getState().setIsHistoryNavigation(false);
          } else {
            visitNote({ noteId: n.id, type: n.type });
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

  const handleChange = useCallback(
    (content: object) => {
      if (!id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingContentRef.current = { id, content };
      saveTimer.current = setTimeout(() => {
        void updateNote(id, { content });
        pendingContentRef.current = null;
      }, 600);
    },
    [id],
  );

  // Flush any pending debounced save on unmount, so navigating away within
  // the 600ms debounce window doesn't silently drop the edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingContentRef.current) {
        const { id: pendingId, content } = pendingContentRef.current;
        pendingContentRef.current = null;
        void updateNote(pendingId, { content });
      }
    };
  }, []);

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
