"use client";

// Editor for one sticky note, in its own window. Uses the same extensions as
// RichTextEditor so content stays compatible.
//
// Owns window-focus tracking (Tauri's onFocusChanged; DOM focus events only
// cover single elements) for both bars. Losing focus only fades the bars;
// collapsing the window is a separate manual toggle.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { STICKY_NOTE_CHANGED_EVENT, getStickyNoteById, updateStickyNote } from "@/lib/db/stickyNotes";
import { stickyLinkClickEditorProps } from "@/lib/tiptap/stickyLinkClick";
import { openImageEditorWindow } from "@/lib/imageEditorWindow";
import { createEditorExtensions } from "@/lib/tiptap/extensions";
import type { StickyNote } from "@/types";
import { StickyNoteTopBar } from "./StickyNoteTopBar";
import { StickyNoteBottomBar } from "./StickyNoteBottomBar";
import "./editor.css";

const SAVE_DELAY_MS = 800;

// Height when collapsed: just the color strip and title. The full size is
// captured in originalSizeRef when collapsing, so restoring returns to it.
const COLLAPSED_HEIGHT = 48;

// The dot menu can't fit in a collapsed window, so the window grows to this
// height while the menu is open (enough for the color picker submenu).
const COLLAPSED_MENU_HEIGHT = 320;

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
  // Set synchronously by toggleCollapsed rather than mirrored from state: the
  // collapse/restore resize events can arrive before React commits.
  const collapsedRef = useRef(false);
  // Mirrors `collapsed` synchronously; collapsedRef can't tell a collapsed note
  // from one mid-restore.
  const isCollapsedRef = useRef(false);
  // Once the note is deleted, no save may run: a late write would land on the
  // deleted row.
  const deletedRef = useRef(false);

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
      if (deletedRef.current) return;
      const content = editor.getJSON();
      pendingContentRef.current = content;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (deletedRef.current) return;
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
      // Resizes caused by collapsing are ignored via collapsedRef, and the
      // height check catches any collapse event that slips past it.
      unlistenResize = await win.onResized(async () => {
        if (!isFocusedRef.current || collapsedRef.current) return;
        const size = (await win.outerSize()).toLogical(scaleFactor);
        if (collapsedRef.current || size.height <= COLLAPSED_HEIGHT) return;
        originalSizeRef.current = size;
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
      if (pendingContentRef.current && !deletedRef.current) {
        void updateStickyNote(note.id, { content: pendingContentRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  function discardPendingSave() {
    deletedRef.current = true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingContentRef.current = null;
  }

  // Closes the window when its note is deleted from anywhere else (for example
  // the sticky notes home). The event also fires for edits, so the row is
  // re-checked rather than assumed gone.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const fn = await listen<{ id: string }>(STICKY_NOTE_CHANGED_EVENT, async (e) => {
        if (e.payload.id !== note.id || deletedRef.current) return;
        const current = await getStickyNoteById(note.id).catch(() => undefined);
        if (current !== null || deletedRef.current) return;
        discardPendingSave();
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
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
      collapsedRef.current = true;
      isCollapsedRef.current = false;
      setCollapsed(false);
      try {
        if (originalSizeRef.current) {
          await win.setSize(originalSizeRef.current);
        }
      } finally {
        collapsedRef.current = false;
      }
    } else {
      const currentSize = (await win.outerSize()).toLogical(scaleFactor);
      originalSizeRef.current = currentSize;
      collapsedRef.current = true;
      isCollapsedRef.current = true;
      setCollapsed(true);
      await win.setSize(new LogicalSize(currentSize.width, COLLAPSED_HEIGHT));
    }
  }

  // Grows a collapsed window while the top bar menu is open and shrinks it back
  // after. collapsedRef stays true throughout, so the resize listener never
  // records the temporary size into originalSizeRef.
  async function handleMenuOpenChange(open: boolean) {
    if (!isCollapsedRef.current) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    const scaleFactor = await win.scaleFactor();
    const { width } = (await win.outerSize()).toLogical(scaleFactor);
    // A restore may have started during the awaits; resizing now would undo it.
    if (!isCollapsedRef.current) return;
    await win.setSize(new LogicalSize(width, open ? COLLAPSED_MENU_HEIGHT : COLLAPSED_HEIGHT));
  }

  function handleTitleBlur() {
    if (deletedRef.current) return;
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== note.title) {
      void updateStickyNote(note.id, { title: trimmed });
    }
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(trimmed);
    })();
  }

  // Used by the Exit button so pending edits, including an unblurred title, are
  // saved before the window closes.
  async function flushPendingSave() {
    if (deletedRef.current) return;
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
        onMenuOpenChange={handleMenuOpenChange}
        onBeforeExit={flushPendingSave}
        onBeforeDelete={discardPendingSave}
      />
      <div className={`flex flex-1 flex-col overflow-y-auto px-4 py-4 ${collapsed ? "hidden" : ""}`}>
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
