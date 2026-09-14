"use client";

// spec.md subtask 8 ("Sticky note pop-out window"). A minimal Tiptap editor
// for a single sticky note's content, hosted in its own pop-out window (see
// app/sticky/page.tsx). Deliberately does NOT build the bottom formatting
// bar (spec.md subtask 10) or the bubble menu - just a plain, functional,
// autosaving editor plus the top bar (spec.md subtask 9, see
// StickyNoteTopBar below). Reuses the exact same extensions list as
// components/editor/RichTextEditor.tsx (copied, not guessed at) so sticky
// note content stays structurally compatible with the rest of the app's
// Tiptap-based editors.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import { updateStickyNote } from "@/lib/db/stickyNotes";
import type { StickyNote } from "@/types";
import { StickyNoteTopBar } from "./StickyNoteTopBar";
import "./editor.css";

const lowlight = createLowlight(common);

// Same 800ms debounce convention already established by
// components/canvas/CanvasEditor.tsx's autosave.
const SAVE_DELAY_MS = 800;

interface Props {
  note: StickyNote;
}

export function StickyNoteEditor({ note }: Props) {
  const [title, setTitle] = useState(note.title || "Untitled");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<object | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      CodeBlockLowlight.configure({ lowlight }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
    ],
    content: (note.content as object) ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[80vh] px-1",
      },
    },
    onUpdate({ editor }) {
      const content = editor.getJSON();
      pendingContentRef.current = content;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void updateStickyNote(note.id, { content });
        pendingContentRef.current = null;
      }, SAVE_DELAY_MS);
    },
  });

  // Flush any pending debounced save on unmount (e.g. the window closing
  // mid-debounce) so an edit isn't silently dropped - mirrors
  // CanvasEditor.tsx's identical unmount-flush pattern.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingContentRef.current) {
        void updateStickyNote(note.id, { content: pendingContentRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  function handleTitleBlur() {
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== note.title) {
      void updateStickyNote(note.id, { title: trimmed });
    }
  }

  // Flushes any unsaved title/content edits synchronously (as much as
  // awaiting async DB writes allows) - used by StickyNoteTopBar's Exit
  // button so a debounced edit in flight isn't lost when the window closes,
  // extending the same unmount-flush pattern above to a title still sitting
  // unblurred in the input.
  async function flushPendingSave() {
    const trimmed = title.trim() || "Untitled";
    if (trimmed !== note.title) {
      await updateStickyNote(note.id, { title: trimmed });
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingContentRef.current) {
      await updateStickyNote(note.id, { content: pendingContentRef.current });
      pendingContentRef.current = null;
    }
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <StickyNoteTopBar note={note} title={title} onBeforeExit={flushPendingSave} />
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
        <input
          className="mb-2 w-full bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
        />
        <EditorContent editor={editor} className="flex-1" />
      </div>
    </div>
  );
}
