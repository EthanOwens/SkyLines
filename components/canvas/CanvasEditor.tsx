"use client";

// Adapted from ../note_taking_app/components/canvas/CanvasEditor.tsx
// (spec.md subtask 18, M4 "canvas editor"). One change from the reference:
//
//   No manual `setSyncStatus("syncing"/"saved"/"error")` calls around the
//   snapshot autosave. The reference toggled `syncStatus` itself because it
//   wrote straight to Firestore. Here, saves go through lib/db/notes.ts's
//   `updateNote`, which writes to local SQLite and (via the
//   change-notification -> useSyncEngine.ts chain wired in subtask 15)
//   automatically schedules a real, debounced Firestore push - the real
//   `syncStatus` in stores/appStore.ts already reflects that actual push
//   activity, so this component no longer needs to fake it. The 800ms
//   debounce on the snapshot autosave is kept unchanged from the reference
//   (distinct from the rich text editor's 600ms - tldraw's `store.listen`
//   callback fires very frequently during canvas interaction, so this
//   debounce matters even more here).

import { useCallback, useRef } from "react";
import { Tldraw, type Editor, type TLEditorSnapshot } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { updateNote } from "@/lib/db/notes";
import type { Note } from "@/types";

interface Props {
  note: Note;
}

export function CanvasEditor({ note }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      // Load persisted snapshot
      if (note.canvasData) {
        try {
          editor.loadSnapshot(note.canvasData as TLEditorSnapshot);
        } catch {
          // Snapshot incompatible — start fresh
        }
      }

      // Listen for changes and auto-save
      const unlisten = editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            const snapshot = editor.getSnapshot();
            void updateNote(note.id, { canvasData: snapshot as unknown as object });
          }, 800);
        },
        { source: "user", scope: "document" },
      );

      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unlisten();
      };
    },
    [note.id, note.canvasData],
  );

  return (
    <div className="relative flex-1 h-full w-full">
      <Tldraw onMount={handleMount} />
    </div>
  );
}
