import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseReference, type Reference, type ReferenceKind } from "@/lib/references/format";
import { ReferenceChipView } from "@/components/editor/ReferenceChip";

export interface ReferenceAttrs {
  kind: ReferenceKind;
  id: string;
  pageId: string | null;
  shapeId: string | null;
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
]);

export function referencePrefix(kind: ReferenceKind): string {
  return kind === "sticky" ? "%" : "#";
}

export function referenceFromAttrs(attrs: ReferenceAttrs): Reference | null {
  if (!KINDS.has(attrs.kind) || !attrs.id) return null;
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
    pageId: ref.kind === "shape" ? ref.pageId : null,
    shapeId: ref.kind === "shape" ? ref.shapeId : null,
    label,
    lastTitle: null,
  };
}

function fallbackText(node: PMNode): string {
  const attrs = node.attrs as ReferenceAttrs;
  return `${referencePrefix(attrs.kind)}${attrs.label || attrs.lastTitle || ""}`;
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
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("referenceDoubleClick"),
        props: {
          // The browser's default word selection skips the uneditable chip and
          // picks the text beside it, or nothing at a line's start.
          handleDoubleClickOn: (view, _pos, node, nodePos, _event, direct) => {
            if (!direct || node.type !== type) return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
            return true;
          },
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
