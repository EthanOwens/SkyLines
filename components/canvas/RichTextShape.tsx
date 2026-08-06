"use client";

// spec.md subtask 1 ("RichTextShape — a custom tldraw shape hosting a Tiptap
// editor"). A tldraw custom ShapeUtil (see tldraw's own built-in note/text/
// embed/video shapes in node_modules/tldraw/src/lib/shapes for the reference
// patterns this follows) whose geometry is a resizable rectangular bounding
// box (BaseBoxShapeUtil, same base class tldraw's own `embed`/`video` shapes
// use) and whose `component()` hosts a REAL Tiptap editor instance (not
// tldraw's own built-in rich-text label) with the exact same extensions list
// as components/editor/RichTextEditor.tsx, so all formatting built for that
// full-page editor (bold/italic/headings/lists/font/color/etc.) works
// identically inside a shape.
//
// Content is stored in `shape.props.content` as plain Tiptap JSON (matching
// Note.content's `object | null` shape in types/index.ts, for consistency
// with the rest of this codebase's Tiptap-JSON handling) - tldraw's own
// store/snapshot mechanism persists this automatically, since shape props
// are just data on the tldraw record; no separate persistence path is
// needed (see CanvasEditor.tsx's existing getSnapshot()/loadSnapshot()
// round-trip through `canvasData`, left completely unchanged by this file).
//
// Pointer-event handling (draggable-when-not-editing vs
// focusable-and-typeable-when-editing) follows the EXACT pattern tldraw's
// own `embed`/`video` shapes use (see VideoShapeUtil.tsx/EmbedShapeUtil.tsx
// in node_modules/tldraw/src/lib/shapes): the shape's outer HTMLContainer
// has `pointer-events: none` by default (tldraw.css's `.tl-html-container`
// rule - shape selection/dragging is driven by tldraw's own geometry-based
// hit testing, not real DOM pointer events), and only the inner interactive
// content opts back in to `pointer-events: all` while
// `useIsEditing(shape.id)` is true. Editing mode itself is entered/exited by
// tldraw's own default select-tool double-click-to-edit behavior (this
// shape just declares `canEdit() { return true }`, same as tldraw's note/
// text/embed/video shapes - no custom StateNode/tool needed for that, see
// tldraw's ShapeUtil.canEdit doc comment "whether the shape can be double
// clicked to edit"). While editing, `onPointerDownCapture`/
// `onTouchEndCapture` stop propagation on the content wrapper - the exact
// technique tldraw's own Tiptap-hosting RichTextArea.tsx
// (node_modules/tldraw/src/lib/shapes/text/RichTextArea.tsx) uses to keep
// text-selection drags inside the editor from being reinterpreted as a
// shape-drag gesture by tldraw's canvas-level pointer handling.

import { useEffect } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor as useTldrawEditor,
  useIsEditing,
  type RecordProps,
  type TLBaseShape,
} from "@tldraw/tldraw";
import { useEditor as useTiptapEditor, EditorContent } from "@tiptap/react";
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
import "@/components/editor/editor.css";

const lowlight = createLowlight(common);

export type RichTextShapeProps = {
  w: number;
  h: number;
  // Tiptap JSON document, or `null` for an empty shape - mirrors
  // `Note.content`'s `object | null` (types/index.ts).
  content: object | null;
};

// Augments tldraw's own `TLShape` union (see @tldraw/tlschema's
// TLBaseShape.ts doc comment: "Custom shapes should be defined by
// augmenting the TLGlobalShapePropsMap type") so tldraw's generic APIs
// (BaseBoxShapeUtil's `TLBaseBoxShape` constraint, `editor.updateShape`,
// `useIsEditing`, etc.) recognize `"rich-text"` as a real shape type instead
// of rejecting it as unrelated to the built-in shape union.
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "rich-text": RichTextShapeProps;
  }
}

export type RichTextShape = TLBaseShape<"rich-text", RichTextShapeProps>;

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
  };

  override canEdit() {
    return true;
  }

  override getDefaultProps(): RichTextShape["props"] {
    return { w: 320, h: 200, content: null };
  }

  component(shape: RichTextShape) {
    return <RichTextShapeComponent shape={shape} />;
  }

  indicator(shape: RichTextShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={4} />;
  }
}

function RichTextShapeComponent({ shape }: { shape: RichTextShape }) {
  const tldrawEditor = useTldrawEditor();
  const isEditing = useIsEditing(shape.id);

  const tiptapEditor = useTiptapEditor(
    {
      extensions: [
        StarterKit.configure({ codeBlock: false }),
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
      content: (shape.props.content as object) ?? "",
      editable: isEditing,
      editorProps: {
        attributes: {
          class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none h-full",
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
          props: { content: editor.getJSON() },
        });
      },
    },
    // Recreate the Tiptap instance only if this shape's identity changes -
    // NOT on every content/isEditing change, otherwise every keystroke (via
    // onUpdate -> updateShape -> re-render with new `shape.props.content`)
    // would tear down and recreate the editor, destroying focus/selection.
    [shape.id],
  );

  // Toggle the underlying ProseMirror editable state as edit-mode is
  // entered/exited (tldraw's own default select-tool double-click-to-edit
  // behavior, driven by this shape's `canEdit()`), without recreating the
  // Tiptap instance itself.
  useEffect(() => {
    if (!tiptapEditor) return;
    tiptapEditor.setEditable(isEditing);
    // tldraw's own default select-tool double-click-to-edit only flips
    // `getEditingShapeId()` - it has no idea this shape hosts a real Tiptap
    // instance, so it can't focus it for us (contrast with tldraw's own
    // RichTextArea.tsx, which explicitly calls `.commands.focus()` when its
    // own text editor mounts for editing - see this file's header comment).
    // Without this, entering edit mode toggles `contenteditable` but leaves
    // real keyboard focus on tldraw's own container, so typed keystrokes
    // never reach the editor.
    if (isEditing) {
      tiptapEditor.commands.focus("end");
    }
  }, [isEditing, tiptapEditor]);

  // Keep the Tiptap instance in sync with externally-changed content (e.g. a
  // fresh `loadSnapshot()` on note load) - mirrors
  // components/editor/RichTextEditor.tsx's identical note-content-sync
  // effect. The stringify comparison avoids clobbering the user's own
  // in-progress edit/cursor position with the state this same edit just
  // wrote back via onUpdate above.
  useEffect(() => {
    if (!tiptapEditor) return;
    const current = JSON.stringify(tiptapEditor.getJSON());
    const incoming = JSON.stringify(shape.props.content ?? "");
    if (current !== incoming) {
      tiptapEditor.commands.setContent((shape.props.content as object) ?? "");
    }
  }, [shape.props.content, tiptapEditor]);

  return (
    <HTMLContainer id={shape.id}>
      <div
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: isEditing ? "all" : "none",
          overflow: "auto",
          background: "var(--color-panel, white)",
          border: "1px solid var(--tl-color-low-border, #d0d0d0)",
          borderRadius: 4,
          cursor: isEditing ? "text" : "inherit",
        }}
        // Same technique tldraw's own Tiptap-hosting RichTextArea.tsx uses -
        // see this file's header comment.
        onPointerDownCapture={isEditing ? stopEventPropagation : undefined}
        onTouchEndCapture={isEditing ? stopEventPropagation : undefined}
      >
        <EditorContent editor={tiptapEditor} className="h-full px-2 py-1" />
      </div>
    </HTMLContainer>
  );
}
