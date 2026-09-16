"use client";

// spec.md subtask 8 ("Sticky note pop-out window"). A minimal Tiptap editor
// for a single sticky note's content, hosted in its own pop-out window (see
// app/sticky/page.tsx). Reuses the exact same extensions list as
// components/editor/RichTextEditor.tsx (copied, not guessed at) so sticky
// note content stays structurally compatible with the rest of the app's
// Tiptap-based editors. Also hosts the top bar (spec.md subtask 9) and
// bottom formatting bar (spec.md subtask 10, see StickyNoteBottomBar below).
//
// Window-focus tracking (real Tauri `Window.onFocusChanged`, not a DOM
// focus/blur event - see StickyNoteTopBar.tsx's header comment for why) is
// owned here, not duplicated per-bar, since both the top and bottom bars
// need the same "only show while the OS window is focused" gating.
//
// spec.md subtask 3 reworked focus/blur: losing OS focus no longer resizes
// the window at all - it just fades the bottom bar and slims the top bar via
// CSS transitions (see the `focused` prop passed to both). Resizing the
// actual window to COLLAPSED_HEIGHT is now a manual, independent `collapsed`
// toggle (double-click the top bar), which is why `collapsed` is tracked
// separately from `focused` below.

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
import type { StickyNote } from "@/types";
import { StickyNoteTopBar } from "./StickyNoteTopBar";
import { StickyNoteBottomBar } from "./StickyNoteBottomBar";
import "./editor.css";

const lowlight = createLowlight(common);

// Same 800ms debounce convention already established by
// components/canvas/CanvasEditor.tsx's autosave.
const SAVE_DELAY_MS = 800;

// Collapsed (unfocused) window height in logical pixels - just enough to
// show the color strip/title, no buttons. The full height (whatever the
// window's actual current size is when it loses focus, since subtask 8 made
// the window resizable) is captured live in `originalSizeRef` rather than
// hardcoded, so refocusing always restores the exact prior size.
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
  // Mirrors `collapsed` inside the mount-only effect below (see its
  // `onResized` handler), since that effect's closure can't see state
  // updates that happen after it's set up.
  const collapsedRef = useRef(false);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

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

  // Sets up the real Tauri window-focus listener + applies the note's
  // persisted `pinned` state to the actual OS window on mount. Shared by
  // both StickyNoteTopBar (spec.md subtask 9) and StickyNoteBottomBar
  // (spec.md subtask 10) via the `focused` prop below, rather than each bar
  // subscribing to the same Tauri event separately. Focus changes no longer
  // resize the window (spec.md subtask 3) - that's now `toggleCollapsed`
  // below, triggered manually by double-clicking the top bar.
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

      // Keeps `originalSizeRef` in sync if the user resizes the window
      // while it's focused, so a subsequent collapse/restore cycle restores
      // the size they actually resized to, not a stale one from before the
      // resize. Resizes caused by our own collapse-toggle are ignored via
      // `collapsedRef` - a collapse can now happen while the window IS
      // focused (it's a manual double-click, not tied to OS focus anymore),
      // so the old `isFocusedRef`-only guard could no longer tell those
      // apart from a genuine user resize.
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

  // Toggled by double-clicking StickyNoteTopBar's root div. Performs the
  // exact resize-to-COLLAPSED_HEIGHT / restore-to-`originalSizeRef` behavior
  // that used to run automatically on blur/focus (spec.md subtask 3 made it
  // manual instead).
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
