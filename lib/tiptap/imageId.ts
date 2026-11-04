import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  imageExists,
  isImageToken,
  resolveImageSrc,
  saveDataUrl,
  tokenFromAssetUrl,
} from "@/lib/images/localImages";

// Images get a stable id so they can be referenced (skylines://image/...).
// The plugin also renumbers a pasted copy whose id is already in the document.
export const ImageWithId = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // Copying inside the app serialises the asset URL; keep the token.
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute("src");
          return (src && tokenFromAssetUrl(src)) || src;
        },
      },
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-image-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.id ? { "data-image-id": String(attrs.id) } : {},
      },
    };
  },

  // The img sits in a wrapper so a missing file can be swapped for a
  // placeholder that keeps data-image-id.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      const id = node.attrs.id ? String(node.attrs.id) : null;
      const src = node.attrs.src as string | null;
      const img = document.createElement("img");
      if (id) img.setAttribute("data-image-id", id);
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      const showPlaceholder = () => {
        const ph = document.createElement("div");
        ph.className = "image-missing";
        if (id) ph.setAttribute("data-image-id", id);
        ph.textContent = "Picture is on another device";
        img.replaceWith(ph);
      };
      if (isImageToken(src)) {
        img.src = resolveImageSrc(src);
        img.addEventListener("error", showPlaceholder, { once: true });
        void imageExists(src).then((ok) => ok || showPlaceholder(), () => {});
      } else if (src) {
        img.src = src;
      }
      dom.appendChild(img);
      return { dom };
    };
  },

  addProseMirrorPlugins() {
    return [
      // Moves any pasted or loaded data: picture into a file. Not added to
      // undo history so the swap isn't a step the user sees.
      new Plugin({
        key: new PluginKey("imageToFile"),
        view: (view) => {
          const inFlight = new Set<string>();
          const scan = () => {
            view.state.doc.descendants((node) => {
              const src = node.type.name === "image" ? (node.attrs.src as string | null) : null;
              if (!src?.startsWith("data:") || inFlight.has(src)) return;
              inFlight.add(src);
              saveDataUrl(src)
                .then((token) => {
                  if (view.isDestroyed) return;
                  const tr = view.state.tr.setMeta("addToHistory", false);
                  view.state.doc.descendants((n, pos) => {
                    if (n.type.name === "image" && n.attrs.src === src) {
                      tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: token });
                    }
                  });
                  if (tr.docChanged) view.dispatch(tr);
                })
                .catch((e) => console.error("[images] could not save picture", e))
                .finally(() => inFlight.delete(src));
            });
          };
          scan();
          return { update: scan };
        },
      }),
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
  const img = root.querySelector<HTMLElement>(`[data-image-id="${CSS.escape(imageId)}"]`);
  if (!img) return;
  img.scrollIntoView({ block: "center", behavior: "smooth" });
  img.classList.add("image-highlight");
  setTimeout(() => img.classList.remove("image-highlight"), HIGHLIGHT_MS);
}
