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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor as useTldrawEditor,
  useIsEditing,
  useValue,
  type RecordProps,
  type TLBaseShape,
  type TLShapeId,
} from "@tldraw/tldraw";
import { useEditor as useTiptapEditor, useEditorState, EditorContent } from "@tiptap/react";
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
import Highlight from "@tiptap/extension-highlight";
import { useAppStore } from "@/stores/appStore";
import { useAuthContext } from "@/components/AuthProvider";
import { LinkOrStickyDialog } from "@/components/editor/LinkOrStickyDialog";
import { stickyLinkClickEditorProps } from "@/lib/tiptap/stickyLinkClick";
import { openImageEditorWindow } from "@/lib/imageEditorWindow";
import {
  suppressReenterEditAfterEndingSession,
  setReenterEditSuppressed,
  clearPendingReturnToRichText,
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
import { Link as LinkIcon, Highlighter } from "lucide-react";
import "@/components/editor/editor.css";

const lowlight = createLowlight(common);

// spec.md subtask 5 ("faded short-form timestamp"). No existing
// date-formatting helper elsewhere in the codebase (checked lib/ for
// `toLocaleDateString`/`Intl.DateTimeFormat`/a `formatDate`-style util) -
// this is small/local enough not to warrant a shared module. `Intl.
// DateTimeFormat` (rather than string-concatenating `toLocaleDateString()` +
// `toLocaleTimeString()`) so the two are always in a single consistent
// order/format like the spec's own "Sep 5, 2:55 PM" example.
const shortTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
function formatShortTimestamp(ms: number) {
  return shortTimestampFormatter.format(new Date(ms));
}

// spec.md (new spec) subtask 1 ("RichTextShape visual redesign"). tldraw
// tracks the currently-hovered shape reactively via its own geometry-based
// pointer hit-testing (see tldraw's own
// node_modules/tldraw/src/lib/tools/selection-logic/updateHoveredShapeId.ts
// - it hit-tests `editor.getShapeAtPoint()` against the raw pointer
// position on every canvas pointer move, entirely independent of this
// shape's own DOM `pointer-events` value), exposed as
// `editor.getHoveredShapeId()` (@tldraw/editor's Editor.ts). There's no
// ready-made `useIsHovered`-style hook exported alongside `useIsEditing`
// (confirmed by searching @tldraw/editor's whole public `index.ts`), so this
// mirrors `useIsEditing`'s own implementation
// (node_modules/@tldraw/editor/src/lib/hooks/useIsEditing.ts) exactly: a
// `useValue` subscription (tldraw's own reactive-signal hook, from
// @tldraw/state-react from re-exported via `@tldraw/tldraw`) over
// `getHoveredShapeId()`. Deliberately NOT a CSS `:hover`/DOM
// mouseenter-mouseleave handler - this shape's outer container has
// `pointer-events: none` while not editing (see this file's header comment
// on why), which makes it fully transparent to DOM-level hover detection.
function useIsHoveredShape(shapeId: TLShapeId) {
  const editor = useTldrawEditor();
  return useValue("isHovered", () => editor.getHoveredShapeId() === shapeId, [editor, shapeId]);
}

// Same subset the full-page editor's bubble menu uses (see
// components/editor/RichTextEditor.tsx's identical constant) - kept
// duplicated rather than imported from there since RichTextEditor.tsx is a
// route-specific component slated for retirement (spec.md subtask 6), not a
// shared module.
//
// spec.md M3 subtask 6 ("Bubble menu: add font family, font size,
// highlight, text color, bullet/numbered toggles") added `bulletList`/
// `orderedList` to this subset - both already existed in `formatActions`
// (the Format tab already used them), so this just widens the filter
// rather than duplicating their toggle logic.
const BUBBLE_MENU_ACTION_IDS = ["bold", "italic", "strike", "code", "bulletList", "orderedList"];
const bubbleMenuActions = formatActions.filter((a) => BUBBLE_MENU_ACTION_IDS.includes(a.id));

export type RichTextShapeProps = {
  w: number;
  h: number;
  // Tiptap JSON document, or `null` for an empty shape - mirrors
  // `Note.content`'s `object | null` (types/index.ts).
  content: object | null;
  // spec.md subtask 4 ("per-shape last-edited timestamp"). Plain millisecond
  // Unix timestamp, same representation lib/db/pages.ts's `created_at`/
  // `updated_at` columns already use - NOT rendered by this file (that's a
  // later subtask); just kept up to date on every content edit below so it's
  // available for that subtask to read. Persisted for free as part of
  // `shape.props`, via tldraw's own snapshot mechanism (see this file's
  // header comment) - no separate DB column.
  lastEditedAt: number;
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

// spec.md subtask 4's backward-compatibility mechanism. Existing shapes
// already saved to disk (in a page's `canvasData` snapshot, from before
// `lastEditedAt` was added) don't have this prop at all - tldraw's own
// props validator (`static override props` below, run on every shape record
// loaded via `editor.loadSnapshot()`) rejects a record whose props object is
// missing ANY key the validator declares, since `RecordProps` validates
// every declared key as required unless the validator itself is
// `.optional()`. Rather than making `lastEditedAt` optional in the type
// (which would push "never edited" handling onto every future reader,
// including subtask 5's renderer), this follows the exact pattern tldraw's
// own built-in shapes use for adding a new required prop to an existing
// shape type (see e.g. @tldraw/tlschema's TLNoteShape.ts `AddFontSizeAdjustment`/
// `AddScale`/`AddLabelColor` migrations, which backfill a default onto old
// prop objects with `props.foo = <default>` BEFORE the props validator ever
// runs): a `TLPropsMigrationSequence`, registered via `static override
// migrations` below, that backfills `lastEditedAt` onto any pre-existing
// record that doesn't have it yet.
const Versions = createShapePropsMigrationIds("rich-text", {
  AddLastEditedAt: 1,
});

export const richTextShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.AddLastEditedAt,
      up: (props) => {
        // `0` (not `Date.now()`) so migrated-up old shapes are
        // indistinguishable from a real "never edited" epoch, rather than
        // silently backdating them to whenever this migration happened to
        // run.
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
    // A freshly-created shape has never actually been edited yet - `Date.now()`
    // here (rather than `0`, the migrated-up-from-legacy sentinel above)
    // reflects that the shape itself was just created "now", matching how a
    // brand-new shape is the most-recently-touched thing on the canvas.
    return { w: 320, h: 200, content: null, lastEditedAt: Date.now() };
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
  const isHovered = useIsHoveredShape(shape.id);
  // Border/handle bar are shown on hover OR while editing (spec.md subtask
  // 1's exact condition).
  const showChrome = isHovered || isEditing;
  const setActiveEditor = useAppStore((s) => s.setActiveEditor);
  const setPendingEditClickPoint = useAppStore((s) => s.setPendingEditClickPoint);
  const { user } = useAuthContext();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

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
        // spec.md M3 subtask 6. `multicolor: true` so `setHighlight({ color
        // })` (via formatActions.ts's `applyHighlightColor`/
        // `toggleHighlight`) can pick from `HIGHLIGHT_COLORS` rather than a
        // single fixed highlight color.
        Highlight.configure({ multicolor: true }),
      ],
      content: (shape.props.content as object) ?? "",
      editable: isEditing,
      editorProps: {
        attributes: {
          class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none h-full",
        },
        ...stickyLinkClickEditorProps(),
        // Ctrl+K / Cmd+K opens the same link dialog as the bubble menu's link
        // button (`setLink` below) - only fires while this shape's editor is
        // actually focused/editing, so it can't fire globally.
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            setLinkDialogOpen(true);
            return true;
          }
          return false;
        },
        // spec.md subtask 12 ("Image editor pop-out shell") + subtask 18
        // ("Save-back-to-note"). Double-clicking an inserted image opens it
        // in its own pop-out editor window - the image's `src` is already a
        // data URL (Image.configure above has `allowBase64: true`), so it's
        // passed straight through. A one-shot Tauri event listener, scoped
        // to this specific edit session's own `sourceId` (returned by
        // `openImageEditorWindow`), patches JUST this image node - by its
        // exact ProseMirror `pos`, not by matching `src` (fragile with
        // duplicate images) - when the pop-out window saves, then
        // unregisters itself. Same pattern as
        // components/editor/RichTextEditor.tsx's identical handler.
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
              // Re-verify the node at `pos` is still the SAME image node
              // double-clicked - the doc may have shifted (concurrent
              // edits) while the pop-out was open, so `pos` could now land
              // on an unrelated or non-image node; dispatching blindly
              // would silently drop the edit or corrupt a different image.
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
          // `lastEditedAt` updates atomically with `content` in this same
          // shape-update transaction, on every edit (not just on blur) - per
          // spec.md subtask 4's explicit decision.
          props: { content: editor.getJSON(), lastEditedAt: Date.now() },
        });
      },
    },
    // Recreate the Tiptap instance only if this shape's identity changes -
    // NOT on every content/isEditing change, otherwise every keystroke (via
    // onUpdate -> updateShape -> re-render with new `shape.props.content`)
    // would tear down and recreate the editor, destroying focus/selection.
    [shape.id],
  );

  // Tracks the previous `isEditing` value seen by the effect below, purely
  // to distinguish a GENUINE true -> false transition (a real edit session
  // just ended) from this component simply mounting/rendering with
  // `isEditing` already false (e.g. an existing empty shape loaded from a
  // snapshot that's never been edited this session) - the latter must never
  // be treated as "blur" and trigger the auto-delete effect below. Starts
  // at `isEditing`'s own initial value so the very first render is never
  // mistaken for a transition.
  //
  // This bookkeeping runs unconditionally at the top of the effect below,
  // BEFORE the `!tiptapEditor` guard - not after it. `useEditor()` here
  // doesn't pass `immediatelyRender`, so per Tiptap's own Next.js
  // auto-detection the Tiptap instance is created inside Tiptap's own
  // internal effect rather than synchronously at render, meaning
  // `tiptapEditor` can still be `null` on this component's very first
  // render(s). If the ref update were gated behind the `!tiptapEditor`
  // check, any `isEditing` transition that occurred while `tiptapEditor`
  // was still null would leave the ref stale, and a genuine edit -> blur
  // transition could go undetected once the Tiptap instance became ready.
  // Keeping the ref in sync with `isEditing` on every render (regardless of
  // Tiptap's readiness) avoids that gap; only the actual Tiptap-dependent
  // operations (setEditable/focus/isEmpty/deleteShapes) stay gated on
  // `tiptapEditor` being non-null.
  const wasEditingRef = useRef(isEditing);
  // Set by the drag handle to skip the empty-delete check below when it
  // ends editing to start a drag (avoids deleting the shape mid-drag).
  const suppressEmptyDeleteRef = useRef(false);

  // Tracks every still-pending image-editor `listen()` unlisten fn
  // (handleDoubleClick below, one per double-clicked image) so this
  // component's own unmount can clean up any that never fired - otherwise a
  // pop-out closed while loading/errored (never emits) or a crashed pop-out
  // leaks the listener for the rest of the app session, and if this
  // component unmounts first, the eventual event would dispatch into a
  // destroyed ProseMirror view.
  const pendingImageEditorUnlistens = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    return () => {
      pendingImageEditorUnlistens.current.forEach((fn) => fn());
      pendingImageEditorUnlistens.current.clear();
    };
  }, []);

  // Toggle the underlying ProseMirror editable state as edit-mode is
  // entered/exited (tldraw's own default select-tool double-click-to-edit
  // behavior, driven by this shape's `canEdit()`), without recreating the
  // Tiptap instance itself.
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = isEditing;

    if (!tiptapEditor) return;
    tiptapEditor.setEditable(isEditing);

    if (isEditing) {
      // tldraw's own default select-tool double-click-to-edit only flips
      // `getEditingShapeId()` - it has no idea this shape hosts a real
      // Tiptap instance, so it can't focus it for us (contrast with
      // tldraw's own RichTextArea.tsx, which explicitly calls
      // `.commands.focus()` when its own text editor mounts for editing -
      // see this file's header comment). Without this, entering edit mode
      // toggles `contenteditable` but leaves real keyboard focus on
      // tldraw's own container, so typed keystrokes never reach the
      // editor.
      //
      // spec.md subtask 2 ("Click-to-cursor, no double-click required").
      // RichTextTool.tsx's `Idle.onPointerDown` records exactly where a
      // click on THIS shape landed (client/viewport coordinates) right
      // before it called `editor.setEditingShape()` - a one-shot,
      // read-then-cleared signal, since this is a transient "where did the
      // triggering click land" fact, not persisted document data (see
      // `pendingEditClickPoint`'s own comment in stores/appStore.ts). If
      // present and it's for this shape, resolve it to a ProseMirror
      // document position via Tiptap/ProseMirror's own
      // `EditorView.posAtCoords()` (expects client coordinates, exactly
      // what was captured) and place the cursor there. Falls back to the
      // previous "focus at the end" behavior whenever there's no pending
      // click to apply - e.g. a freshly-created empty shape (no meaningful
      // "click position" for a shape that didn't exist a moment ago - see
      // RichTextTool.tsx's create-shape branch, which deliberately never
      // sets `pendingEditClickPoint`), or `posAtCoords` failing to resolve
      // a position (e.g. the click coordinates no longer correspond to any
      // on-screen content by the time this effect runs).
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
      // spec.md subtask 4 ("Wire the Format tab / bubble menu to the
      // focused shape's Tiptap instance"). Mirrors
      // components/editor/RichTextEditor.tsx's identical `setActiveEditor`
      // wiring, but keyed off this shape's own edit-focus rather than
      // mount/unmount (see this file's header comment - shapes aren't
      // mounted/unmounted the way page components are).
      setActiveEditor(tiptapEditor);
      return;
    }

    // spec.md subtask 3 ("Empty-shape auto-delete on blur"). Only treat
    // this as "blur" - and consider clearing `activeEditor`/deleting - on a
    // GENUINE true -> false transition of `isEditing` (driven by tldraw's
    // own stable `editingShapeId`, via `useIsEditing`), i.e. this shape's
    // edit session actually just ended, not a raw DOM blur event (which
    // would be unreliable given this shape's own pointer-events/
    // stopEventPropagation handling above; e.g. clicking inside the Tiptap
    // content to move the cursor, or the format tab/bubble menu (subtask 4)
    // stealing DOM focus, must NOT look like a real blur) - and NOT merely
    // "this component rendered with isEditing already false", which would
    // otherwise wrongly delete an existing, already-empty, never-edited-
    // this-session shape the moment it's rendered (e.g. right after being
    // loaded from a snapshot).
    if (!wasEditing) return;

    // spec.md subtask 4. Clear `activeEditor` on this genuine blur - but
    // only if the store's current `activeEditor` still actually IS this
    // shape's own `tiptapEditor` instance. Without this guard, a race where
    // shape A's blur-cleanup effect runs AFTER shape B has already called
    // `setActiveEditor(tiptapEditor)` above (e.g. rapidly clicking from
    // shape A straight into shape B, with no intervening deselect) would
    // wrongly clobber B's now-active editor back to `null`. Read via
    // `getState()` (not a subscribed value) since this is a one-off
    // point-in-time check inside an effect, not something that should
    // itself trigger a re-render.
    if (useAppStore.getState().activeEditor === tiptapEditor) {
      setActiveEditor(null);
    }

    // `tiptapEditor.isEmpty` is Tiptap/ProseMirror's own doc-emptiness
    // check (true only for the doc's default empty-paragraph state) - it
    // correctly returns false for whitespace-only text (a text node with a
    // space character is still a text node) and for any non-text content
    // (e.g. an inserted image node), so neither case is wrongly deleted
    // here.
    if (suppressEmptyDeleteRef.current) {
      suppressEmptyDeleteRef.current = false;
    } else if (tiptapEditor.isEmpty) {
      tldrawEditor.deleteShapes([shape.id]);
    }
  }, [isEditing, tiptapEditor, tldrawEditor, shape.id, setActiveEditor, setPendingEditClickPoint]);

  // Genuine unmount-cleanup path for `activeEditor`, kept SEPARATE from the
  // `isEditing`-keyed effect above (that effect's cleanup semantics are tied
  // to dependency changes, not true unmount, so it only clears
  // `activeEditor` on an explicit true -> false transition). Mirrors
  // components/editor/RichTextEditor.tsx's `useEffect(() => { ...; return ()
  // => setActiveEditor(null); }, [editor, setActiveEditor])`, but guarded
  // the same way as the blur-clear above: only clear if the store's current
  // `activeEditor` still actually IS this shape's own `tiptapEditor`
  // instance, so this never clobbers a different, more-recently-focused
  // shape's claim. This runs whenever `tiptapEditor` changes OR this
  // component genuinely unmounts (e.g. the user navigates away from the
  // canvas note entirely while this shape is mid-edit), releasing the
  // reference regardless of why - otherwise the store could keep pointing
  // at a Tiptap `Editor` instance that's already been destroyed by
  // `useEditor()`'s own unmount effect, which Ribbon.tsx/TopBar.tsx call
  // methods on with no `isDestroyed` guard.
  useEffect(() => {
    return () => {
      if (useAppStore.getState().activeEditor === tiptapEditor) {
        setActiveEditor(null);
      }
    };
  }, [tiptapEditor, setActiveEditor]);

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

  // spec.md subtask 4 ("Bubble menu"). Reactive state for the bubble menu's
  // active/disabled button styling - mirrors
  // components/editor/RichTextEditor.tsx's identical `bubbleMenuState`
  // (see that file's header comment for why `useEditorState`, rather than
  // this component's own render cycle, is required here: selection changes
  // don't trigger Tiptap's `onUpdate`).
  const bubbleMenuState = useEditorState({
    editor: tiptapEditor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  const setLink = useCallback(() => {
    if (!tiptapEditor) return;
    setLinkDialogOpen(true);
  }, [tiptapEditor]);

  // The actual bug: ending the edit session while the dialog is open (via
  // focus loss, not a canvas click) leaves RichTextTool's own pending
  // return-to-rich-text/reenter-edit flags dangling, since nothing triggers
  // their normal resolution without a following canvas pointer event - they
  // only get picked up whenever some LATER, unrelated click happens to touch
  // tldraw's tracked tool/selection state, springing the shape back into
  // edit mode (or re-arming the crosshair) seemingly out of nowhere. Clear
  // them outright the moment the dialog closes, rather than merely
  // suppressing for its open duration (which the dangling flag can outlive).
  const wasLinkDialogOpenRef = useRef(false);
  useEffect(() => {
    setReenterEditSuppressed(shape.id, linkDialogOpen);
    // Only on a genuine open->close transition - this is a module-level
    // flag shared by every rich-text shape, so clearing it on mount (when
    // linkDialogOpen starts false) could wrongly wipe an unrelated shape's
    // legitimately-pending flag.
    if (wasLinkDialogOpenRef.current && !linkDialogOpen) clearPendingReturnToRichText();
    wasLinkDialogOpenRef.current = linkDialogOpen;
    return () => setReenterEditSuppressed(shape.id, false);
  }, [linkDialogOpen, shape.id]);

  return (
    <HTMLContainer id={shape.id}>
      {/* spec.md subtask 1. Outer box: transparent background always (idle
          state has NO visible fill/border/handle at all - "invisible except
          for its actual text content"), `pointer-events: none` always (same
          reasoning as this file's header comment - shape selection/dragging
          for anything that ISN'T the drag-handle bar below stays driven by
          tldraw's own geometry-based hit testing, not real DOM events; the
          handle bar and the content area each explicitly opt back in to
          real pointer events below, same pattern the original single-div
          version of this component already used for the content area
          alone). Dotted border drawn here (around the shape's FULL w x h
          bounding box, per spec.md's exact wording) only while
          hovered/editing, using this app's own `--border` theme CSS custom
          property (see app/globals.css) rather than a hardcoded color, so
          it follows the active theme like the rest of the app. */}
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
      >
        {showChrome && (
          // spec.md subtask 1's drag-handle bar. A thin strip along the top
          // edge that opts back in to real `pointer-events` (`all`,
          // overriding the outer box's `none` above) SPECIFICALLY on this
          // element, and - critically - is a SIBLING of the content wrapper
          // below, not a descendant of it, so it's never touched by that
          // wrapper's own `onPointerDownCapture={stopEventPropagation}`
          // (that capture listener only intercepts events targeting itself
          // or ITS OWN descendants - a sibling's events never reach it).
          // With no `stopPropagation` of its own, a pointer-down here simply
          // bubbles up through the DOM to tldraw's own `tl-canvas` element,
          // exactly like a pointer-down on any other `pointer-events: none`
          // area of this shape - tldraw's own canvas-level pointer handling
          // (`useCanvasEvents`) then does ITS OWN geometry-based hit test
          // (`editor.getShapeAtPoint`, the same mechanism
          // updateHoveredShapeId.ts above uses for hover) against the
          // resulting page coordinates, finds this shape, and drives it
          // through the Select tool's normal Idle -> PointingShape ->
          // Translating state chart - tldraw's real shape-translate
          // mechanics, not custom drag math (per spec.md's explicit
          // instruction). A normal-flow flex child (NOT `position:
          // absolute`) with a fixed height, so it occupies its own space at
          // the top of the flex column instead of overlapping the content
          // wrapper below it - the two previously shared the same y=0
          // origin, which let this bar win hit-testing over the top strip
          // of the content area even while editing, blocking cursor
          // placement/selection at the very start of the text.
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
            onPointerDown={() => {
              if (isEditing) {
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
          // Same technique tldraw's own Tiptap-hosting RichTextArea.tsx uses -
          // see this file's header comment.
          onPointerDownCapture={isEditing ? stopEventPropagation : undefined}
          onTouchEndCapture={isEditing ? stopEventPropagation : undefined}
        >
        {tiptapEditor && (
          <BubbleMenu
            editor={tiptapEditor}
            // Portal to `document.body` rather than the default `appendTo`
            // (the editor's own DOM parent - i.e. this shape's small,
            // fixed-size `overflow: auto` div above) so the menu isn't
            // clipped by that box's scroll/clip region near a shape's edges.
            // Tiptap/Floating UI compute the menu's position from the
            // selection's screen coordinates, independent of DOM parent, so
            // this doesn't affect positioning - only where in the DOM tree
            // the element lives.
            appendTo={() => document.body}
            shouldShow={({ editor: shouldShowEditor, view, state, from, to }) => {
              // Replicates components/editor/RichTextEditor.tsx's identical
              // `shouldShow` (see that file's header comment / reviewer
              // finding on spec.md subtask 11) - hidden when the editor
              // isn't focused, the selection is empty, it's an empty text
              // block, or the selection is a NodeSelection (e.g. a selected
              // inserted Image), none of which the bubble menu's mark-based
              // actions apply to.
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
            // Smaller padding/gap than RichTextEditor.tsx's own bubble menu
            // - a shape's bounding box is much smaller than a full page, so
            // this keeps the popover compact enough to comfortably fit
            // within/near a shape sized close to its 320x200 default.
            // `flex-wrap` + a fixed `max-w` (spec.md M3 subtask 6) let the
            // now-larger control set (font family/size selects, highlight
            // toggle + swatches, text-color swatches, list toggles) wrap
            // onto a few short rows instead of the Format tab's single wide
            // strip, which wouldn't fit over a small shape.
            className="flex max-w-[220px] flex-wrap items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {bubbleMenuState && (
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

                {/* Full-width rows below (spec.md M3 subtask 6) - a select's
                    intrinsic width and a row of color swatches don't fit
                    alongside the icon-button strip above within this
                    popover's 220px cap, so each gets its own flex-basis-100%
                    row instead of being crammed into the first line. */}
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
        {/* spec.md subtask 5. Faded short-form last-edited timestamp -
            gated on `showChrome` (same hover-or-editing condition as the
            drag-handle bar/dashed border above) for consistency with this
            shape's existing chrome pattern, rather than always-on clutter
            over the shape's small default 320x200 size. Absolutely
            positioned in the bottom-right corner (its own row, below the
            8px handle bar at top) so it never overlaps the handle bar or
            crowds the text content area above it; `pointer-events: none`
            since it's a purely informational label, not interactive.
            `lastEditedAt === 0` is the migration's sentinel for a
            pre-existing shape that's never actually been edited since this
            feature shipped (see `richTextShapeMigrations` above) - skipped
            entirely rather than rendering a garbage "Jan 1, 1970" date. */}
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
      <LinkOrStickyDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        editor={tiptapEditor}
        currentUrl={bubbleMenuState?.link ?? null}
        userId={user?.uid ?? null}
      />
    </HTMLContainer>
  );
}
