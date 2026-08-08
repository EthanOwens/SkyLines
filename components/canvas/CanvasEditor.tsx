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
import { useAppStore } from "@/stores/appStore";
import type { Note } from "@/types";
import { RichTextShapeUtil } from "./RichTextShape";
import { RichTextTool, installRichTextToolAutoReturn } from "./RichTextTool";

// spec.md subtask 1 ("RichTextShape") - registers the custom shape type via
// tldraw's `shapeUtils` prop. Defined as a module-level constant (rather
// than inline in the JSX below) so it's referentially stable across
// re-renders - <Tldraw> re-creates its internal shape registry if this
// array's identity changes.
const shapeUtils = [RichTextShapeUtil];

// spec.md subtask 2 ("Click-to-create tool") - registers the custom
// click-to-create tool via tldraw's `tools` prop (see Tldraw.tsx's
// `mergeArraysAndReplaceDefaults('id', tools, allDefaultTools)`, which adds
// this alongside - not instead of - tldraw's own select/draw/etc. tools).
// Same referential-stability reasoning as `shapeUtils` above.
const tools = [RichTextTool];

interface Props {
  note: Note;
}

export function CanvasEditor({ note }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether a debounced save is pending (i.e. the store changed but
  // the 800ms timer hasn't fired yet), so it can be flushed synchronously on
  // unmount below. This component is keyed by note.id (see
  // app/canvas/page.tsx), so an unmount always corresponds to leaving this
  // exact note - no risk of flushing to the wrong note here.
  const pendingSaveRef = useRef(false);
  const setActiveCanvasEditor = useAppStore((s) => s.setActiveCanvasEditor);

  const handleMount = useCallback(
    (editor: Editor) => {
      // Exposes the live tldraw `editor` instance to TopBar.tsx's top-bar
      // Undo/Redo (spec.md subtask 15, "Undo/redo wiring") via
      // stores/appStore.ts, mirroring RichTextEditor.tsx's `setActiveEditor`
      // pattern for Tiptap. Cleared back to `null` in the cleanup function
      // returned below (tldraw's `onMount` contract) so TopBar correctly
      // falls back to a neutral/disabled state once this canvas unmounts.
      setActiveCanvasEditor(editor);

      // spec.md subtask 2 ("Click-to-create tool") - makes the rich-text
      // tool the default/primary interaction on mount (design guidance:
      // "set this new tool as the DEFAULT active tool when a canvas note
      // first mounts"), instead of leaving tldraw's own `select` as the
      // default. tldraw's `<TldrawEditor>` hardcodes `initialState="select"`
      // internally (see Tldraw.tsx) with no prop to override it, so this is
      // switched right after mount instead - the same place/pattern
      // `editor.loadSnapshot` below already uses for other one-time
      // post-mount setup. Users can still switch to `select`/`draw`/etc. via
      // the toolbar (or `editor.setCurrentTool(...)`) exactly like any other
      // tldraw tool - this only changes what's active by default.
      editor.setCurrentTool("rich-text");

      // See RichTextTool.tsx's header comment for why this is needed
      // (tldraw's own framework force-switches `currentTool` to `select`
      // any time a shape enters edit mode - this keeps the rich-text tool
      // "sticky" across repeated click-to-create actions the way spec.md's
      // "just works, no reselecting a tool" requirement needs).
      const uninstallRichTextToolAutoReturn = installRichTextToolAutoReturn(editor);

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
          pendingSaveRef.current = true;
          saveTimer.current = setTimeout(() => {
            const snapshot = editor.getSnapshot();
            void updateNote(note.id, { canvasData: snapshot as unknown as object });
            pendingSaveRef.current = false;
          }, 800);
        },
        { source: "user", scope: "document" },
      );

      return () => {
        setActiveCanvasEditor(null);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unlisten();
        uninstallRichTextToolAutoReturn();
        // Flush any pending debounced save on unmount, so navigating away
        // within the 800ms debounce window doesn't silently drop the edit.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          const snapshot = editor.getSnapshot();
          void updateNote(note.id, { canvasData: snapshot as unknown as object });
        }
      };
    },
    [note.id, note.canvasData, setActiveCanvasEditor],
  );

  return (
    <div className="relative flex-1 h-full w-full">
      <Tldraw shapeUtils={shapeUtils} tools={tools} onMount={handleMount} />
    </div>
  );
}
