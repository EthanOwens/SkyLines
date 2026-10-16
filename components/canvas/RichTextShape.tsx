"use client";

// A tldraw box shape hosting a real Tiptap editor with the same extensions as
// RichTextEditor. Content is Tiptap JSON in shape props, so tldraw's snapshot
// persists it.
//
// Pointer handling follows tldraw's embed/video shapes: the container is
// pointer-events: none (tldraw hit-tests by geometry), and the content opts
// back in only while editing (reference chips and links always opt in, so they
// can be clicked). While editing, pointer-down capture stops propagation so
// text-selection drags aren't read as shape drags.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  BaseBoxShapeUtil,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor as useTldrawEditor,
  useIsEditing,
  useToasts,
  useValue,
  type RecordProps,
  type TLBaseShape,
  type TLShapeId,
} from "@tldraw/tldraw";
import { useEditor as useTiptapEditor, useEditorState, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { isNodeSelection, isTextSelection } from "@tiptap/core";
import { useAppStore } from "@/stores/appStore";
import { useAuthContext } from "@/components/AuthProvider";
import { InsertLinkDialog } from "@/components/editor/InsertLinkDialog";
import { openImageEditorWindow } from "@/lib/imageEditorWindow";
import { createEditorExtensions } from "@/lib/tiptap/extensions";
import { copyReference } from "@/lib/references/copy";
import { FOLLOWABLE_SELECTOR } from "@/lib/tiptap/reference";
import {
  suppressReenterEditAfterEndingSession,
  setReenterEditSuppressed,
  clearPendingReturnToRichText,
  resumeEditingWithRichTextTool,
} from "./RichTextTool";
import {
  formatActions,
  selectFormatActionState,
  FONT_FAMILIES,
  FONT_SIZES,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  applyFontFamily,
  applyFontSize,
  applyTextColor,
  applyHighlightColor,
  toggleHighlight,
} from "@/components/ribbon/formatActions";
import { cn } from "@/lib/utils";
import { Link as LinkIcon, Link2, Highlighter } from "lucide-react";
import "@/components/editor/editor.css";

// One formatter so the date and time always share a consistent format.
const shortTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
function formatShortTimestamp(ms: number) {
  return shortTimestampFormatter.format(new Date(ms));
}

// Hover via tldraw's geometry hit-testing. A DOM :hover can't work because the
// container is pointer-events: none while not editing.
function useIsHoveredShape(shapeId: TLShapeId) {
  const editor = useTldrawEditor();
  return useValue("isHovered", () => editor.getHoveredShapeId() === shapeId, [editor, shapeId]);
}

// Same subset as RichTextEditor's bubble menu.
const BUBBLE_MENU_ACTION_IDS = ["bold", "italic", "strike", "code", "bulletList", "orderedList"];
const bubbleMenuActions = formatActions.filter((a) => BUBBLE_MENU_ACTION_IDS.includes(a.id));

export type RichTextShapeProps = {
  w: number;
  h: number;
  // Tiptap JSON document, or `null` for an empty shape - mirrors
  // `Note.content`'s `object | null` (types/index.ts).
  content: object | null;
  // Updated on every content edit; persisted through shape props.
  lastEditedAt: number;
};

// Registers "rich-text" with tldraw's shape union so its generic APIs accept
// it.
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "rich-text": RichTextShapeProps;
  }
}

export type RichTextShape = TLBaseShape<"rich-text", RichTextShapeProps>;

// Backfills lastEditedAt onto shapes saved before it existed: tldraw's props
// validator rejects records missing a required key.
const Versions = createShapePropsMigrationIds("rich-text", {
  AddLastEditedAt: 1,
});

export const richTextShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.AddLastEditedAt,
      up: (props) => {
        // 0 marks "never edited" rather than backdating old shapes to the
        // migration time.
        props.lastEditedAt = 0;
      },
      down: (props) => {
        delete props.lastEditedAt;
      },
    },
  ],
});

export class RichTextShapeUtil extends BaseBoxShapeUtil<RichTextShape> {
  static override type = "rich-text" as const;

  // `T.jsonValue` is the validator tldraw's own shape props (e.g.
  // TLNoteShape's `richText`) use for structurally-arbitrary JSON - cast to
  // `object | null` to line up with `RichTextShapeProps.content` above,
  // same cast tlschema's own `createShapeValidator` makes internally for
  // untyped `props`/`meta` json fields (see @tldraw/tlschema's
  // TLBaseShape.ts).
  static override props: RecordProps<RichTextShape> = {
    w: T.number,
    h: T.number,
    content: T.jsonValue.nullable() as unknown as T.Validatable<object | null>,
    lastEditedAt: T.number,
  };

  static override migrations = richTextShapeMigrations;

  override canEdit() {
    return true;
  }

  override getDefaultProps(): RichTextShape["props"] {
    return { w: 320, h: 200, content: null, lastEditedAt: Date.now() };
  }

  component(shape: RichTextShape) {
    return <RichTextShapeComponent shape={shape} />;
  }

  indicator(shape: RichTextShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={4} />;
  }
}

// Needs tldraw's UI context (for toasts), which the canvas and so every shape
// render inside.
export function useCopyShapeReference() {
  const { addToast } = useToasts();
  const pageId = useAppStore((s) => s.selectedPageId);
  return useCallback(
    async (shapeId: string, imageId?: string) => {
      if (!pageId) return;
      try {
        await copyReference(
          imageId
            ? { kind: "image", id: imageId, pageId, shapeId }
            : { kind: "shape", id: shapeId, pageId, shapeId },
        );
        addToast({ title: "Reference copied", severity: "success" });
      } catch (err) {
        console.error("Copy reference failed", err);
        addToast({ title: "Couldn't copy reference", severity: "error" });
      }
    },
    [addToast, pageId],
  );
}

// The menu is portalled, but React events still bubble through the React tree
// to tldraw's .tl-canvas handlers, which would end the edit session.
function stopReactPropagation(e: SyntheticEvent) {
  e.stopPropagation();
}

// While not editing, chips and links take plain clicks (FollowOnClick in
// lib/tiptap/reference.ts). tldraw mustn't see them, or it would edit the box.
function keepFollowClickFromTldraw(e: ReactPointerEvent) {
  if (e.button !== 0) return;
  if (e.target instanceof Element && e.target.closest(FOLLOWABLE_SELECTOR)) {
    stopEventPropagation(e);
  }
}

// Preventing mousedown keeps DOM focus, and so the text selection, in the
// editor.
function keepEditorFocus(e: ReactMouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

// Stands in for tldraw's context menu while a box is being edited: opening
// tldraw's calls editor.complete(), which ends the edit session.
export function EditingContextMenu({
  x,
  y,
  onCopyReference,
  onClose,
}: {
  x: number;
  y: number;
  onCopyReference: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  }, [x, y]);

  useEffect(() => {
    function closeOnOutsidePointerDown(e: PointerEvent) {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      onClose();
    }
    function closeOnKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Otherwise Escape also reaches tldraw and ends the edit session.
        e.preventDefault();
        e.stopPropagation();
      }
      onClose();
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    window.addEventListener("keydown", closeOnKeyDown, true);
    window.addEventListener("wheel", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      window.removeEventListener("keydown", closeOnKeyDown, true);
      window.removeEventListener("wheel", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: x, top: y }}
      className="z-50 min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      onPointerDown={stopReactPropagation}
      onPointerUp={stopReactPropagation}
      onMouseDown={keepEditorFocus}
      onMouseUp={stopReactPropagation}
      onClick={stopReactPropagation}
      onDoubleClick={stopReactPropagation}
      onContextMenu={keepEditorFocus}
      onTouchStart={stopReactPropagation}
      onTouchEnd={stopReactPropagation}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onCopyReference();
        }}
        className="flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent hover:text-accent-foreground"
      >
        <Link2 className="size-4 shrink-0" />
        Copy reference
      </button>
    </div>,
    document.body,
  );
}

function RichTextShapeComponent({ shape }: { shape: RichTextShape }) {
  const tldrawEditor = useTldrawEditor();
  const isEditing = useIsEditing(shape.id);
  const isHovered = useIsHoveredShape(shape.id);
  // The border and handle bar show on hover or while editing.
  const showChrome = isHovered || isEditing;
  const setActiveEditor = useAppStore((s) => s.setActiveEditor);
  const setPendingEditClickPoint = useAppStore((s) => s.setPendingEditClickPoint);
  const { user } = useAuthContext();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingMenuAt, setEditingMenuAt] = useState<{
    x: number;
    y: number;
    imageId?: string;
  } | null>(null);
  const closeEditingMenu = useCallback(() => setEditingMenuAt(null), []);
  const copyShapeReference = useCopyShapeReference();

  useEffect(() => {
    if (!isEditing) setEditingMenuAt(null);
  }, [isEditing]);

  const tiptapEditor = useTiptapEditor(
    {
      extensions: createEditorExtensions({ highlight: true }),
      content: (shape.props.content as object) ?? "",
      editable: isEditing,
      editorProps: {
        attributes: {
          class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none h-full",
        },
        // Ctrl+K / Cmd+K opens the link dialog; only while this shape is
        // editing.
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            setLinkDialogOpen(true);
            return true;
          }
          return false;
        },
        // Double-clicking an image opens it in the image editor window. On
        // save, a one-shot listener scoped to this edit session patches the
        // node at its exact pos (matching by src breaks with duplicate images).
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
              // The doc may have changed while the editor was open: make sure
              // pos still holds the same image before patching.
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
        // Writes the new Tiptap content back into the shape's own props via
        // tldraw's own shape-update mechanism, so it becomes part of the
        // tldraw document/store (and therefore of getSnapshot()'s output -
        // see this file's header comment).
        tldrawEditor.updateShape<RichTextShape>({
          id: shape.id,
          type: "rich-text",
          props: { content: editor.getJSON(), lastEditedAt: Date.now() },
        });
      },
    },
    // Recreate the editor only when the shape changes; recreating on content
    // changes would reset focus on every keystroke.
    [shape.id],
  );

  // Tracks the previous isEditing so only a real true -> false transition
  // counts as blur (not mounting with isEditing already false). Updated before
  // the tiptapEditor null check, because the editor can still be null on the
  // first renders and a transition then would otherwise be missed.
  const wasEditingRef = useRef(isEditing);
  // Set by the drag handle to skip the empty-delete check below when it
  // ends editing to start a drag (avoids deleting the shape mid-drag).
  const suppressEmptyDeleteRef = useRef(false);

  // Pending image-editor listeners, removed on unmount so a pop-out that never
  // saves can't leak one or patch a destroyed view.
  const pendingImageEditorUnlistens = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    return () => {
      pendingImageEditorUnlistens.current.forEach((fn) => fn());
      pendingImageEditorUnlistens.current.clear();
    };
  }, []);

  // Toggle editability without recreating the editor.
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = isEditing;

    if (!tiptapEditor) return;
    tiptapEditor.setEditable(isEditing);

    if (isEditing) {
      // tldraw only sets the editing shape id; it can't focus the Tiptap
      // editor, so keystrokes would go to tldraw's container. Place the cursor
      // where the triggering click landed (recorded by RichTextTool), or at the
      // end when there is no click to use, such as a newly created shape.
      const pendingClick = useAppStore.getState().pendingEditClickPoint;
      let cursorPlaced = false;
      if (pendingClick && pendingClick.shapeId === shape.id) {
        setPendingEditClickPoint(null);
        const resolved = tiptapEditor.view.posAtCoords({
          left: pendingClick.clientX,
          top: pendingClick.clientY,
        });
        if (resolved) {
          tiptapEditor.commands.focus(resolved.pos);
          cursorPlaced = true;
        }
      }
      if (!cursorPlaced) {
        tiptapEditor.commands.focus("end");
      }
      // Point the Format tab and bubble menu at this shape's editor while
      // editing.
      setActiveEditor(tiptapEditor);
      return;
    }

    // Only a real end of editing counts as blur. DOM blur fires when the bubble
    // menu or Format tab takes focus, and a shape loaded already empty must not
    // be deleted.
    if (!wasEditing) return;

    // Only clear activeEditor if it's still this shape's: moving straight from
    // shape A to B can run A's cleanup after B has claimed it.
    if (useAppStore.getState().activeEditor === tiptapEditor) {
      setActiveEditor(null);
    }

    // isEmpty is false for whitespace or images, so those shapes are kept.
    if (suppressEmptyDeleteRef.current) {
      suppressEmptyDeleteRef.current = false;
    } else if (tiptapEditor.isEmpty) {
      tldrawEditor.deleteShapes([shape.id]);
    }
  }, [isEditing, tiptapEditor, tldrawEditor, shape.id, setActiveEditor, setPendingEditClickPoint]);

  // Release activeEditor on unmount too, since the Ribbon and TopBar call
  // methods on it without an isDestroyed check. Same ownership guard as above.
  useEffect(() => {
    return () => {
      if (useAppStore.getState().activeEditor === tiptapEditor) {
        setActiveEditor(null);
      }
    };
  }, [tiptapEditor, setActiveEditor]);

  // Sync externally loaded content (e.g. loadSnapshot). The comparison avoids
  // overwriting the in-progress edit that onUpdate just wrote back.
  useEffect(() => {
    if (!tiptapEditor) return;
    const current = JSON.stringify(tiptapEditor.getJSON());
    const incoming = JSON.stringify(shape.props.content ?? "");
    if (current !== incoming) {
      tiptapEditor.commands.setContent((shape.props.content as object) ?? "");
    }
  }, [shape.props.content, tiptapEditor]);

  // useEditorState because selection changes don't fire onUpdate.
  const bubbleMenuState = useEditorState({
    editor: tiptapEditor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  const chipSelected = useEditorState({
    editor: tiptapEditor,
    selector: ({ editor }) =>
      !!editor && isNodeSelection(editor.state.selection) && editor.state.selection.node.type.name === "reference",
  });

  const selectedImageId = useEditorState({
    editor: tiptapEditor,
    selector: ({ editor }) => {
      if (!editor) return null;
      const { selection } = editor.state;
      const node = isNodeSelection(selection) ? selection.node : null;
      return node?.type.name === "image" ? ((node.attrs.id as string | null) ?? null) : null;
    },
  });

  // Opens on the Ribbon's link button, but only for the editor it targets.
  const linkDialogRequest = useAppStore((s) => s.linkDialogRequest);
  const seenLinkRequestRef = useRef(linkDialogRequest);
  useEffect(() => {
    if (seenLinkRequestRef.current === linkDialogRequest) return;
    seenLinkRequestRef.current = linkDialogRequest;
    if (tiptapEditor && useAppStore.getState().activeEditor === tiptapEditor) setLinkDialogOpen(true);
  }, [linkDialogRequest, tiptapEditor]);

  const setLink = useCallback(() => {
    if (!tiptapEditor) return;
    setLinkDialogOpen(true);
  }, [tiptapEditor]);

  // The dialog keeps its events away from tldraw, so editing normally survives
  // it. If the session ended anyway, RichTextTool's pending return flags are
  // left set (a later unrelated click would act on them) and the canvas is
  // left in Select, so on close clear them and resume editing this shape.
  const wasLinkDialogOpenRef = useRef(false);
  useEffect(() => {
    setReenterEditSuppressed(shape.id, linkDialogOpen);
    // Only on a real open -> close: the flags are shared by every rich-text
    // shape.
    if (wasLinkDialogOpenRef.current && !linkDialogOpen) {
      clearPendingReturnToRichText();
      if (tldrawEditor.getEditingShapeId() !== shape.id) {
        resumeEditingWithRichTextTool(tldrawEditor, shape.id);
      }
    }
    wasLinkDialogOpenRef.current = linkDialogOpen;
    return () => setReenterEditSuppressed(shape.id, false);
  }, [linkDialogOpen, shape.id, tldrawEditor]);

  return (
    <HTMLContainer id={shape.id}>
      {/*
        Invisible when idle. The dotted border shows on hover or while editing.
        pointer-events: none so tldraw's hit-testing drives selection; the
        handle bar and content opt back in.
      */}
      <div
        style={{
          width: shape.props.w,
          height: shape.props.h,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          pointerEvents: "none",
          background: "transparent",
          border: showChrome ? "1px dashed var(--border)" : "1px solid transparent",
          borderRadius: 4,
        }}
        onContextMenu={
          isEditing
            ? (e) => {
                e.preventDefault();
                // Keeps tldraw's menu (which would end editing) from opening.
                e.stopPropagation();
                // WebKit selects the word under a right-click before this
                // event, and ProseMirror only reads it on the later
                // selectionchange; focus() writes the editor's selection back.
                tiptapEditor?.view.focus();
                const img = e.target instanceof Element ? e.target.closest("img[data-image-id]") : null;
                setEditingMenuAt({
                  x: e.clientX,
                  y: e.clientY,
                  imageId: img?.getAttribute("data-image-id") ?? undefined,
                });
              }
            : undefined
        }
      >
        {showChrome && (
          // Drag handle. A sibling of the content wrapper (not a child), so the
          // wrapper's stopPropagation never sees its events and tldraw's own
          // translate handling drags the shape. In normal flow rather than
          // absolutely positioned, so it doesn't cover the top of the text
          // area.
          <div
            style={{
              flexShrink: 0,
              height: 8,
              pointerEvents: linkDialogOpen ? "none" : "all",
              cursor: "grab",
              background: "var(--muted-foreground)",
              opacity: 0.4,
              borderTopLeftRadius: 3,
              borderTopRightRadius: 3,
            }}
            // End editing first so the drag reaches tldraw's real
            // translate handling instead of EditingShape's no-op.
            onPointerDown={(e) => {
              if (isEditing && e.button === 0) {
                suppressEmptyDeleteRef.current = true;
                tldrawEditor.setEditingShape(null);
                suppressReenterEditAfterEndingSession();
              }
            }}
          />
        )}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            pointerEvents: linkDialogOpen ? "none" : isEditing ? "all" : "none",
            overflow: "auto",
            background: "transparent",
            cursor: isEditing ? "text" : "inherit",
          }}
          onPointerDownCapture={isEditing ? stopEventPropagation : keepFollowClickFromTldraw}
          onPointerUpCapture={isEditing ? undefined : keepFollowClickFromTldraw}
          onTouchEndCapture={isEditing ? stopEventPropagation : undefined}
        >
        {tiptapEditor && (
          <BubbleMenu
            editor={tiptapEditor}
            // Portal to body so the shape's overflow doesn't clip the menu.
            // Positioning is unaffected.
            appendTo={() => document.body}
            shouldShow={({ editor: shouldShowEditor, view, state, from, to }) => {
              // Hide when unfocused, the selection is empty or an empty block,
              // or it's a node selection other than an image (which offers Copy reference).
              const { doc, selection } = state;
              const { empty } = selection;
              const isEmptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(selection);
              const hasEditorFocus = view.hasFocus();
              if (!hasEditorFocus || empty || isEmptyTextBlock || !shouldShowEditor.isEditable) {
                return false;
              }
              if (isNodeSelection(selection)) {
                return (
                  selection.node.type.name === "reference" ||
                  (selection.node.type.name === "image" && !!selection.node.attrs.id)
                );
              }
              return true;
            }}
            // Compact and wrapping, so it fits near a 320x200 shape.
            className="flex max-w-[220px] flex-wrap items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {chipSelected ? (
              <button
                type="button"
                title="Insert link"
                onClick={setLink}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <LinkIcon className="h-3 w-3" />
              </button>
            ) : selectedImageId ? (
              <button
                type="button"
                title="Copy reference"
                onClick={() => void copyShapeReference(shape.id, selectedImageId)}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Link2 className="h-3 w-3" />
                Copy reference
              </button>
            ) : bubbleMenuState && (
              <>
                {bubbleMenuActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    title={action.tip}
                    disabled={action.isDisabled?.(bubbleMenuState)}
                    onClick={() => action.run(tiptapEditor)}
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50",
                      action.isActive(bubbleMenuState)
                        ? "bg-secondary text-secondary-foreground"
                        : "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <action.icon className="h-3 w-3" />
                  </button>
                ))}
                <button
                  type="button"
                  title="Insert link"
                  onClick={setLink}
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                    bubbleMenuState.link !== null
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <LinkIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Copy reference"
                  onClick={() => void copyShapeReference(shape.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Link2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Highlight"
                  onClick={() => toggleHighlight(tiptapEditor)}
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                    bubbleMenuState.highlight !== null
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Highlighter className="h-3 w-3" />
                </button>

                <select
                  aria-label="Font family"
                  title="Font family"
                  value={bubbleMenuState.fontFamily}
                  onChange={(e) => applyFontFamily(tiptapEditor, e.target.value)}
                  className="mt-0.5 h-6 w-full basis-full rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Font size"
                  title="Font size"
                  value={bubbleMenuState.fontSize}
                  onChange={(e) => applyFontSize(tiptapEditor, e.target.value)}
                  className="mt-0.5 h-6 w-full basis-full rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
                >
                  {FONT_SIZES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <div className="mt-0.5 flex basis-full items-center gap-0.5" title="Highlight color">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      onClick={() => applyHighlightColor(tiptapEditor, c.value)}
                      className={cn(
                        "h-4 w-4 rounded-full border",
                        bubbleMenuState.highlight === c.value
                          ? "ring-2 ring-ring ring-offset-1"
                          : "border-border",
                      )}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>

                <div className="mt-0.5 flex basis-full items-center gap-0.5" title="Text color">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.value || "default"}
                      type="button"
                      title={c.label}
                      onClick={() => applyTextColor(tiptapEditor, c.value)}
                      className={cn(
                        "h-4 w-4 rounded-full border",
                        bubbleMenuState.color === c.value ? "ring-2 ring-ring ring-offset-1" : "border-border",
                      )}
                      style={{ backgroundColor: c.value || "transparent" }}
                    />
                  ))}
                </div>
              </>
            )}
          </BubbleMenu>
        )}
        <EditorContent editor={tiptapEditor} className="h-full px-2 py-1" />
        </div>
        {/*
          Shown with the rest of the chrome. Skipped for lastEditedAt 0 ("never
          edited"), which would otherwise show Jan 1, 1970.
        */}
        {showChrome && shape.props.lastEditedAt !== 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 2,
              right: 4,
              pointerEvents: "none",
              color: "var(--muted-foreground)",
              opacity: 0.6,
            }}
            className="select-none text-[10px] leading-none"
          >
            {formatShortTimestamp(shape.props.lastEditedAt)}
          </div>
        )}
      </div>
      {isEditing && editingMenuAt && (
        <EditingContextMenu
          x={editingMenuAt.x}
          y={editingMenuAt.y}
          onCopyReference={() => void copyShapeReference(shape.id, editingMenuAt.imageId)}
          onClose={closeEditingMenu}
        />
      )}
      <InsertLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        editor={tiptapEditor}
        currentUrl={bubbleMenuState?.link ?? null}
        userId={user?.uid ?? null}
      />
    </HTMLContainer>
  );
}
