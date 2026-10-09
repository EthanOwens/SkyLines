"use client";

// Editor for one sticky note, in its own window. Uses the same extensions as
// RichTextEditor so content stays compatible.
//
// Owns window-focus tracking (Tauri's onFocusChanged; DOM focus events only
// cover single elements) for both bars. Losing focus only fades the bars;
// collapsing the window is a separate manual toggle.

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
import { stickyLinkClickEditorProps } from "@/lib/tiptap/stickyLinkClick";
import { openImageEditorWindow } from "@/lib/imageEditorWindow";
import type { StickyNote } from "@/types";
import { StickyNoteTopBar } from "./StickyNoteTopBar";
import { StickyNoteBottomBar } from "./StickyNoteBottomBar";
import "./editor.css";

const lowlight = createLowlight(common);

const SAVE_DELAY_MS = 800;

// Height when collapsed: just the color strip and title. The full size is
// captured in originalSizeRef when collapsing, so restoring returns to it.
const COLLAPSED_HEIGHT = 48;

interface Props {
  note: StickyNote;
}

export function StickyNoteEditor({ note }: Props) {
  const [title, setTitle] = useState(note.title || "Untitled");
  const [focused, setFocused] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<object | null>(null);
  const originalSizeRef = useRef<import("@tauri-apps/api/dpi").LogicalSize | null>(null);
  // Mirrors collapsed for the mount-only effect, whose closure can't see later
  // state.
  const collapsedRef = useRef(false);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

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
      ...stickyLinkClickEditorProps(),
      // Double-clicking an image opens it in the image editor window. On save,
      // a one-shot listener scoped to this edit session patches the node at its
      // exact pos (matching by src breaks with duplicate images); the change
      // then autosaves like any edit.
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
      const content = editor.getJSON();
      pendingContentRef.current = content;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void updateStickyNote(note.id, { content });
        pendingContentRef.current = null;
      }, SAVE_DELAY_MS);
    },
  });

  // Window focus listener for both bars, and applies the saved pinned state to
  // the OS window on mount.
  useEffect(() => {
    let cancelled = false;
    let unlistenFocus: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    const isFocusedRef = { current: true };

    async function setup() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();

      const scaleFactor = await win.scaleFactor();
      const initialFocused = await win.isFocused();
      if (cancelled) return;
      isFocusedRef.current = initialFocused;
      setFocused(initialFocused);

      originalSizeRef.current = (await win.outerSize()).toLogical(scaleFactor);

      if (note.pinned) {
        await win.setAlwaysOnTop(true);
      }

      unlistenFocus = await win.onFocusChanged(({ payload: isFocused }) => {
        isFocusedRef.current = isFocused;
        setFocused(isFocused);
      });

      // Track user resizes so restoring returns to the size the user chose.
      // Resizes caused by collapsing are ignored via collapsedRef.
      unlistenResize = await win.onResized(async () => {
        if (!isFocusedRef.current || collapsedRef.current) return;
        originalSizeRef.current = (await win.outerSize()).toLogical(scaleFactor);
      });
    }

    void setup();

    return () => {
      cancelled = true;
      unlistenFocus?.();
      unlistenResize?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Flush a pending save on unmount (for example the window closing) so the
  // edit isn't dropped.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingContentRef.current) {
        void updateStickyNote(note.id, { content: pendingContentRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Double-clicking the top bar resizes the window to COLLAPSED_HEIGHT and
  // back.
  async function toggleCollapsed() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    const scaleFactor = await win.scaleFactor();

    if (collapsed) {
      setCollapsed(false);
      if (originalSizeRef.current) {
        await win.setSize(originalSizeRef.current);
      }
    } else {
      const currentSize = (await win.outerSize()).toLogical(scaleFactor);
      originalSizeRef.current = currentSize;
      setCollapsed(true);
      await win.setSize(new LogicalSize(currentSize.width, COLLAPSED_HEIGHT));
    }
  }

  function handleTitleBlur() {
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== note.title) {
      void updateStickyNote(note.id, { title: trimmed });
    }
  }

  // Used by the Exit button so pending edits, including an unblurred title, are
  // saved before the window closes.
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
      <StickyNoteTopBar
        note={note}
        title={title}
        focused={focused}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onBeforeExit={flushPendingSave}
      />
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
      <StickyNoteBottomBar editor={editor} focused={focused} collapsed={collapsed} />
    </div>
  );
}
