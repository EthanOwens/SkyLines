"use client";

// Ported unchanged from ../note_taking_app/components/editor/RichTextEditor.tsx
// (spec.md subtask 17, M4 "rich text editor"). This component has no direct
// Firestore/SQLite coupling - it only takes `note`/`onChange`/`onTitleChange`
// props - so autosave-to-SQLite-instead-of-Firestore is handled entirely by
// the caller (app/note/page.tsx), not here.

import { useEffect, useCallback, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { isNodeSelection, isTextSelection } from "@tiptap/core";
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
import { useAuthContext } from "@/components/AuthProvider";
import type { Note } from "@/types";
import { formatActions, selectFormatActionState } from "@/components/ribbon/formatActions";
import { cn } from "@/lib/utils";
import { Link as LinkIcon } from "lucide-react";
import { LinkOrStickyDialog } from "./LinkOrStickyDialog";
import { stickyLinkClickEditorProps } from "@/lib/tiptap/stickyLinkClick";
import "./editor.css";

// Subset of the Format tab's actions (spec.md subtask 11, "Bubble menu") -
// intentionally excludes headings/lists/blockquote/divider/undo/redo, which
// are either block-level (don't make sense on a selection popover) or too
// heavy for a small floating toolbar. Filtered from formatActions.ts's
// shared list rather than hand-writing duplicate action definitions (see
// that file's header comment, which anticipated this reuse).
const BUBBLE_MENU_ACTION_IDS = ["bold", "italic", "strike", "code"];
const bubbleMenuActions = formatActions.filter((a) => BUBBLE_MENU_ACTION_IDS.includes(a.id));

const lowlight = createLowlight(common);

interface Props {
  note: Note;
  onChange: (content: object) => void;
  onTitleChange: (title: string) => void;
}

export function RichTextEditor({ note, onChange, onTitleChange }: Props) {
  const [title, setTitle] = useState(note.title || "Untitled");
  const setActiveEditor = useAppStore((s) => s.setActiveEditor);
  const { user } = useAuthContext();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

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
      ...stickyLinkClickEditorProps(),
      // Ctrl+K / Cmd+K opens the same link dialog as the bubble menu's link
      // button (`setLink` below) - no existing Mod-k binding elsewhere.
      handleKeyDown(_view, event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setLinkDialogOpen(true);
          return true;
        }
        return false;
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

  // Reactive state for the bubble menu's active/disabled button styling
  // (spec.md subtask 11, "Bubble menu") - reused from formatActions.ts, same
  // as Ribbon.tsx's FormatTab. Unlike FormatTab (a sibling of this
  // component, subscribing to `editor` via stores/appStore.ts), the bubble
  // menu lives right here with direct access to the local `editor` variable
  // - but it still needs `useEditorState` rather than relying on this
  // component's own render cycle, because selection changes (which flip
  // isActive results) don't trigger Tiptap's `onUpdate` callback (that only
  // fires on document/content changes), so nothing would otherwise cause a
  // re-render when the user just moves the selection.
  const bubbleMenuState = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    setLinkDialogOpen(true);
  }, [editor]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: shouldShowEditor, view, state, from, to }) => {
            // Replicates Tiptap's default shouldShow (hidden when the editor
            // isn't focused, the selection is empty, or it's an empty text
            // block) and additionally hides the menu for a NodeSelection
            // (e.g. clicking to select an inserted Image), since none of the
            // bubble menu's mark-based actions (bold/italic/etc.) apply to a
            // selected node - see reviewer finding on spec.md subtask 11.
            const { doc, selection } = state;
            const { empty } = selection;
            const isEmptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(selection);
            const hasEditorFocus = view.hasFocus();
            if (!hasEditorFocus || empty || isEmptyTextBlock || !shouldShowEditor.isEditable) {
              return false;
            }
            if (isNodeSelection(selection)) {
              return false;
            }
            return true;
          }}
          className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {bubbleMenuState &&
            bubbleMenuActions.map((action) => (
              <button
                key={action.id}
                type="button"
                title={action.tip}
                disabled={action.isDisabled?.(bubbleMenuState)}
                onClick={() => action.run(editor)}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50",
                  action.isActive(bubbleMenuState)
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <action.icon className="h-3.5 w-3.5" />
              </button>
            ))}
          <button
            type="button"
            title="Insert link"
            onClick={setLink}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              bubbleMenuState?.link !== null && bubbleMenuState?.link !== undefined
                ? "bg-secondary text-secondary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
        </BubbleMenu>
      )}

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

      <LinkOrStickyDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        editor={editor}
        currentUrl={bubbleMenuState?.link ?? null}
        userId={user?.uid ?? null}
      />
    </div>
  );
}
