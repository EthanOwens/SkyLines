import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// Images get a stable id so they can be referenced (skylines://image/...).
// The plugin also renumbers a pasted copy whose id is already in the document.
export const ImageWithId = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-image-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.id ? { "data-image-id": String(attrs.id) } : {},
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imageId"),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "image") return;
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = crypto.randomUUID();
            seen.add(fresh);
            // Throws when the schema rejects the node where it sits (for
            // example an image inline in a paragraph); leave that node alone
            // rather than crash the editor.
            try {
              tr.setNodeAttribute(pos, "id", fresh);
            } catch {
              seen.delete(fresh);
            }
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

const HIGHLIGHT_MS = 1800;

/** Scrolls the image with this id into view and briefly outlines it. */
export function revealImage(imageId: string, root: ParentNode = document) {
  const img = root.querySelector<HTMLElement>(`img[data-image-id="${CSS.escape(imageId)}"]`);
  if (!img) return;
  img.scrollIntoView({ block: "center", behavior: "smooth" });
  img.classList.add("image-highlight");
  setTimeout(() => img.classList.remove("image-highlight"), HIGHLIGHT_MS);
}
