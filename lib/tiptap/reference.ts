import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { parseReference, type Reference, type ReferenceKind } from "@/lib/references/format";
import { openReference, openWebLink } from "@/lib/references/navigate";
import { hoverPreviewPlugin } from "@/lib/tiptap/hoverPreview";
import { ReferenceChipView } from "@/components/editor/ReferenceChip";

export interface ReferenceAttrs {
  kind: ReferenceKind;
  id: string;
  pageId: string | null;
  shapeId: string | null;
  stickyId: string | null;
  // Fixed text chosen at insert time; shown instead of the live title.
  label: string | null;
  // Shown, struck through, once the target is gone.
  lastTitle: string | null;
}

const KINDS: ReadonlySet<string> = new Set<ReferenceKind>([
  "notebook",
  "folder",
  "note",
  "page",
  "shape",
  "sticky",
  "image",
]);

// An image is "%" when it sits in a sticky note.
export function referencePrefix(attrs: Pick<ReferenceAttrs, "kind" | "stickyId">): string {
  return attrs.kind === "sticky" || attrs.stickyId ? "%" : "#";
}

export function referenceFromAttrs(attrs: ReferenceAttrs): Reference | null {
  if (!KINDS.has(attrs.kind) || !attrs.id) return null;
  if (attrs.kind === "image") {
    if (attrs.stickyId) return { kind: "image", id: attrs.id, stickyId: attrs.stickyId };
    if (!attrs.pageId || !attrs.shapeId) return null;
    return { kind: "image", id: attrs.id, pageId: attrs.pageId, shapeId: attrs.shapeId };
  }
  if (attrs.kind === "shape") {
    if (!attrs.pageId || !attrs.shapeId) return null;
    return { kind: "shape", id: attrs.shapeId, pageId: attrs.pageId, shapeId: attrs.shapeId };
  }
  return { kind: attrs.kind, id: attrs.id };
}

function attrsFromReference(ref: Reference, label: string | null): ReferenceAttrs {
  return {
    kind: ref.kind,
    id: ref.id,
    pageId: ref.kind === "shape" || ref.kind === "image" ? (ref.pageId ?? null) : null,
    shapeId: ref.kind === "shape" || ref.kind === "image" ? (ref.shapeId ?? null) : null,
    stickyId: ref.kind === "image" ? (ref.stickyId ?? null) : null,
    label,
    lastTitle: null,
  };
}

function fallbackText(node: PMNode): string {
  const attrs = node.attrs as ReferenceAttrs;
  return `${referencePrefix(attrs)}${attrs.label || attrs.lastTitle || ""}`;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    reference: {
      /** Replaces the selection with a chip, using any selected text as its label. */
      insertReference: (ref: Reference) => ReturnType;
    };
  }
}

function dataAttribute(name: string, attr: keyof ReferenceAttrs) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs[attr] == null ? {} : { [name]: String(attrs[attr]) },
  };
}

// An atom rather than a Link mark: Link's URL sanitising drops non-web
// schemes, and the chip's text is derived, not typed.
export const ReferenceNode = Node.create({
  name: "reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: dataAttribute("data-kind", "kind"),
      id: dataAttribute("data-id", "id"),
      pageId: dataAttribute("data-page-id", "pageId"),
      shapeId: dataAttribute("data-shape-id", "shapeId"),
      stickyId: dataAttribute("data-sticky-id", "stickyId"),
      label: dataAttribute("data-label", "label"),
      lastTitle: dataAttribute("data-last-title", "lastTitle"),
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-reference]",
        getAttrs: (element) => (KINDS.has(element.getAttribute("data-kind") ?? "") ? null : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-reference": "" }, HTMLAttributes), fallbackText(node)];
  },

  renderText({ node }) {
    return fallbackText(node);
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferenceChipView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("referenceDoubleClick"),
        props: {
          // Swallows the browser's word selection on the chip itself; the click
          // listener in FollowOnClick does the following. Anywhere else on the
          // line (including the zero-width space and margin inside the node
          // view's wrapper) the default word selection runs.
          handleDoubleClickOn: (_view, _pos, _node, _nodePos, event) =>
            event.target instanceof Element && event.target.closest(".reference-chip") !== null,
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertReference:
        (ref) =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          const selected = empty ? "" : state.doc.textBetween(from, to, " ").trim();
          const node = this.type.create(attrsFromReference(ref, selected || null));
          if (dispatch) tr.replaceSelectionWith(node, false).scrollIntoView();
          return true;
        },
    };
  },
});

// A separate extension so its paste handler can run ahead of Link's without
// moving the node itself to the front of the schema.
export const ReferencePaste = Extension.create({
  name: "referencePaste",
  priority: 1001,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("referencePaste"),
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;
            const ref = parseReference(text);
            if (!ref) return false;
            return editor.commands.insertReference(ref);
          },
        },
      }),
    ];
  },
});

// Elements a click can follow: reference chips (ReferenceChip.tsx) and links.
export const FOLLOWABLE_SELECTOR = ".reference-chip, a[href]";

// An uneditable view (a canvas text box not being edited) follows on a plain
// click. Where the text is editable, a plain click places the cursor and
// Ctrl/Cmd+click follows.
function followTarget(view: EditorView, event: MouseEvent): Element | null {
  if (event.button !== 0 || !(event.target instanceof Element)) return null;
  const element = event.target.closest(FOLLOWABLE_SELECTOR);
  if (!element || !view.dom.contains(element)) return null;
  if (view.editable && !(event.metaKey || event.ctrlKey)) return null;
  return element;
}

// A double-click on an editable view's chip follows it: the first click only
// selected the chip. Links stay editable text there.
function isEditableChipDoubleClick(view: EditorView, event: MouseEvent): boolean {
  if (event.detail !== 2 || event.button !== 0 || !view.editable) return false;
  if (event.metaKey || event.ctrlKey || !(event.target instanceof Element)) return false;
  const chip = event.target.closest(".reference-chip");
  return !!chip && view.dom.contains(chip);
}

function follow(element: Element) {
  if (element.matches(".reference-chip")) {
    const ref = parseReference(element.getAttribute("data-reference-token") ?? "");
    if (ref) void openReference(ref);
    return;
  }
  void openWebLink(element.getAttribute("href") ?? "");
}

export const FollowOnClick = Extension.create({
  name: "followOnClick",

  addProseMirrorPlugins() {
    return [
      hoverPreviewPlugin(),
      new Plugin({
        key: new PluginKey("followOnClick"),
        props: {
          handleDOMEvents: {
            // Keeps the selection (and focus) where it was instead of moving
            // onto the chip or link being followed.
            mousedown: (view, event) => {
              if (!followTarget(view, event)) return false;
              event.preventDefault();
              return true;
            },
          },
        },
        // A native capture listener on the editor root. ProseMirror ignores
        // clicks inside node views, and a chip's node view is a React portal
        // whose synthetic handlers (tldraw's canvas onClick) stop the click
        // before it bubbles back up to the root.
        view: (view) => {
          const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const link = target?.closest("a[href]");
            if (link && view.dom.contains(link)) {
              // Only this extension opens links. Otherwise the webview would
              // navigate, and tauri-plugin-shell's script (a <body> click
              // listener for target="_blank" links, which ignores
              // defaultPrevented) would open the browser on any plain click.
              event.preventDefault();
              event.stopPropagation();
            }
            const element = followTarget(view, event);
            if (element) {
              event.preventDefault();
              event.stopPropagation();
              // The first click of a double-click already followed.
              if (event.detail <= 1) follow(element);
              return;
            }
            if (isEditableChipDoubleClick(view, event)) {
              event.preventDefault();
              event.stopPropagation();
              const chip = target?.closest(".reference-chip");
              if (chip) follow(chip);
            }
          };
          view.dom.addEventListener("click", onClick, true);
          return { destroy: () => view.dom.removeEventListener("click", onClick, true) };
        },
      }),
    ];
  },
});
