"use client";

// Saving is up to the caller through onChange and onTitleChange.

import { useEffect, useCallback, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { isNodeSelection, isTextSelection } from "@tiptap/core";
import { useAppStore } from "@/stores/appStore";
import { useAuthContext } from "@/components/AuthProvider";
import type { Note } from "@/types";
import { formatActions, selectFormatActionState } from "@/components/ribbon/formatActions";
import { cn } from "@/lib/utils";
import { Link as LinkIcon } from "lucide-react";
import { InsertLinkDialog } from "./InsertLinkDialog";
import { openImageEditorWindow } from "@/lib/imageEditorWindow";
import { createEditorExtensions } from "@/lib/tiptap/extensions";
import "./editor.css";

// Inline marks only: block-level actions don't fit a selection popover.
const BUBBLE_MENU_ACTION_IDS = ["bold", "italic", "strike", "code"];
const bubbleMenuActions = formatActions.filter((a) => BUBBLE_MENU_ACTION_IDS.includes(a.id));

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

  // Pending image-editor listeners, removed on unmount so a pop-out that never
  // saves can't leak one or patch a destroyed view.
  const pendingImageEditorUnlistens = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    return () => {
      pendingImageEditorUnlistens.current.forEach((fn) => fn());
      pendingImageEditorUnlistens.current.clear();
    };
  }, []);

  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: note.content as object ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[60vh] px-1",
      },
      // Ctrl+K / Cmd+K opens the link dialog.
      handleKeyDown(_view, event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setLinkDialogOpen(true);
          return true;
        }
        return false;
      },
      // Double-clicking an image opens it in the image editor window. On save,
      // a one-shot listener scoped to this edit session patches the node at its
      // exact pos (matching by src breaks with duplicate images).
      handleDoubleClick(view, pos, event) {
        const target = event.target as HTMLElement;
        if (target.tagName !== "IMG") return false;
        event.preventDefault();
        const originalSrc = (target as HTMLImageElement).src;
        void (async () => {
          const sourceId = await openImageEditorWindow(originalSrc);
          const { listen } = await import("@tauri-apps/api/event");
          const unlisten = await listen<string>(`image-editor:saved:${sourceId}`, (e) => {
            pendingImageEditorUnlistens.current.delete(unlisten);
            // The doc may have changed while the editor was open: make sure pos
            // still holds the same image before patching.
            const node = view.state.doc.nodeAt(pos);
            if (node && node.type.name === "image" && node.attrs.src === originalSrc) {
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: e.payload }));
            }
            unlisten();
          });
          pendingImageEditorUnlistens.current.add(unlisten);
        })();
        return true;
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON());
    },
  });

  // The Ribbon is a sibling, so it reaches this editor through the store.
  // Cleared on unmount so it never holds a destroyed editor.
  useEffect(() => {
    setActiveEditor(editor);
    return () => setActiveEditor(null);
  }, [editor, setActiveEditor]);

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

  // useEditorState because selection changes don't fire onUpdate.
  const bubbleMenuState = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  // Opens on the Ribbon's link button, but only for the editor it targets.
  const linkDialogRequest = useAppStore((s) => s.linkDialogRequest);
  const seenLinkRequestRef = useRef(linkDialogRequest);
  useEffect(() => {
    if (seenLinkRequestRef.current === linkDialogRequest) return;
    seenLinkRequestRef.current = linkDialogRequest;
    if (editor && useAppStore.getState().activeEditor === editor) setLinkDialogOpen(true);
  }, [linkDialogRequest, editor]);

  const chipSelected = useEditorState({
    editor,
    selector: ({ editor }) =>
      !!editor && isNodeSelection(editor.state.selection) && editor.state.selection.node.type.name === "reference",
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
            // Tiptap's default rules, plus hidden for node selections such as
            // an image, where the mark actions don't apply.
            const { doc, selection } = state;
            const { empty } = selection;
            const isEmptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(selection);
            const hasEditorFocus = view.hasFocus();
            if (!hasEditorFocus || empty || isEmptyTextBlock || !shouldShowEditor.isEditable) {
              return false;
            }
            if (isNodeSelection(selection)) {
              return selection.node.type.name === "reference";
            }
            return true;
          }}
          className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {bubbleMenuState &&
            !chipSelected &&
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

      <InsertLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        editor={editor}
        currentUrl={bubbleMenuState?.link ?? null}
        userId={user?.uid ?? null}
      />
    </div>
  );
}
