"use client";

// Ported unchanged from ../note_taking_app/components/editor/RichTextEditor.tsx
// (spec.md subtask 17, M4 "rich text editor"). This component has no direct
// Firestore/SQLite coupling - it only takes `note`/`onChange`/`onTitleChange`
// props - so autosave-to-SQLite-instead-of-Firestore is handled entirely by
// the caller (app/note/page.tsx), not here.

import { useEffect, useCallback, useState } from "react";
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
import { useAppStore } from "@/stores/appStore";
import type { Note } from "@/types";
import "./editor.css";

const lowlight = createLowlight(common);

interface Props {
  note: Note;
  onChange: (content: object) => void;
  onTitleChange: (title: string) => void;
}

export function RichTextEditor({ note, onChange, onTitleChange }: Props) {
  const [title, setTitle] = useState(note.title || "Untitled");
  const setActiveEditor = useAppStore((s) => s.setActiveEditor);

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
      // TextStyle is a prerequisite for FontFamily/FontSize/Color (spec.md
      // subtask 10, "Format tab") - all three attach `textStyle` mark
      // attributes and require the base mark to be registered first, per
      // Tiptap v3's docs.
      TextStyle,
      FontFamily,
      FontSize,
      Color,
    ],
    content: note.content as object ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[60vh] px-1",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON());
    },
  });

  // Exposes the live Tiptap `editor` instance to the Ribbon's Format tab
  // (spec.md subtask 10, "Format tab") via stores/appStore.ts - `Ribbon` is
  // rendered by AppLayout.tsx as a sibling of this component, not a
  // descendant, so it has no other way to reach `editor`. Clears back to
  // `null` on unmount (e.g. navigating away from this note) so the Format
  // tab correctly falls back to a neutral state instead of holding a stale
  // reference to a torn-down editor.
  useEffect(() => {
    setActiveEditor(editor);
    return () => setActiveEditor(null);
  }, [editor, setActiveEditor]);

  // Load new content when note changes
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(note.content ?? "");
    if (current !== incoming) {
      editor.commands.setContent(note.content as object ?? "");
    }
    setTitle(note.title || "Untitled");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const handleTitleBlur = useCallback(() => {
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    onTitleChange(trimmed);
  }, [title, onTitleChange]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Scrollable content area */}
      <div className="flex flex-1 flex-col overflow-y-auto px-8 py-6 md:px-16 md:py-10">
        <input
          className="mb-4 w-full bg-transparent text-3xl font-bold text-foreground outline-none placeholder:text-muted-foreground"
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
