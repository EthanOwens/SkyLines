import { resolveImageSrc } from "@/lib/images/localImages";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { parseReference, type ReferenceKind } from "@/lib/references/format";
import { getLinkPreview, type LinkPreview } from "@/lib/linkPreview";
import { cachedResolve } from "@/lib/references/useResolvedReference";

const DELAY_MS = 400;
const SELECTOR = ".reference-chip, a[href]";

const KIND_LABELS: Record<ReferenceKind, string> = {
  notebook: "Notebook",
  folder: "Folder",
  note: "Note",
  page: "Page",
  shape: "Text box",
  sticky: "Sticky note",
  image: "Image",
};

function line(card: HTMLElement, className: string, text: string) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  card.appendChild(el);
}

function fillPreview(card: HTMLElement, p: LinkPreview) {
  const body = document.createElement("div");
  body.className = "hover-preview-body";
  const text = document.createElement("div");
  text.className = "hover-preview-main";
  if (p.siteName) line(text, "hover-preview-kind", p.siteName);
  if (p.title) line(text, "hover-preview-title", p.title);
  if (p.description) line(text, "hover-preview-text", p.description);
  body.appendChild(text);
  card.insertBefore(body, card.firstChild);
  if (p.image) {
    const img = document.createElement("img");
    img.src = resolveImageSrc(p.image);
    img.className = p.large ? "hover-preview-image hover-preview-large" : "hover-preview-thumb";
    if (p.large) card.appendChild(img);
    else body.appendChild(img);
  }
  if (p.themeColor) card.style.borderLeft = `4px solid ${p.themeColor}`;
}

async function fillCard(card: HTMLElement, target: Element) {
  const href = target.getAttribute("href");
  if (href) {
    line(card, "hover-preview-url", href);
    return;
  }
  const ref = parseReference(target.getAttribute("data-reference-token") ?? "");
  if (!ref) {
    line(card, "hover-preview-title", "Not found");
    return;
  }
  const resolved = await cachedResolve(
    target.getAttribute("data-reference-token") ?? "",
    ref,
  );
  line(card, "hover-preview-kind", KIND_LABELS[ref.kind]);
  if (!resolved.exists) {
    line(card, "hover-preview-title", "Not found");
    return;
  }
  if (resolved.path.length) line(card, "hover-preview-path", resolved.path.join(" › "));
  line(card, "hover-preview-title", resolved.title || "Untitled");
  if (resolved.previewText) line(card, "hover-preview-text", resolved.previewText);
  else if (resolved.previewImage) {
    const img = document.createElement("img");
    img.src = resolveImageSrc(resolved.previewImage);
    img.className = "hover-preview-image";
    card.appendChild(img);
  }
}

// A plain DOM card rather than a Base UI PreviewCard: chips are node views
// inside tldraw shapes, and the card must never take focus or pointer events.
export const hoverPreviewPlugin = () =>
  new Plugin({
    key: new PluginKey("hoverPreview"),
    view: (view) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let card: HTMLElement | null = null;
      let current: Element | null = null;

      const hide = () => {
        clearTimeout(timer);
        card?.remove();
        card = null;
        current = null;
      };

      const show = async (target: Element) => {
        const next = document.createElement("div");
        next.className = "hover-preview-card";
        next.setAttribute("role", "tooltip");
        try {
          await fillCard(next, target);
        } catch {
          return;
        }
        if (current !== target) return;
        const rect = target.getBoundingClientRect();
        next.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
        document.body.appendChild(next);
        const below = rect.bottom + 6;
        next.style.top = `${below + next.offsetHeight > window.innerHeight ? Math.max(8, rect.top - next.offsetHeight - 6) : below}px`;
        card = next;
        const href = target.getAttribute("href");
        if (href && /^https?:/i.test(href)) {
          // Fetched here, on hover only; the card grows when the result arrives.
          void getLinkPreview(href).then((p) => {
            if (p && card === next) fillPreview(next, p);
          });
        }
      };

      const onOver = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest(SELECTOR) : null;
        if (target === current) return;
        hide();
        if (!target || !view.dom.contains(target)) return;
        current = target;
        timer = setTimeout(() => void show(target), DELAY_MS);
      };

      view.dom.addEventListener("mouseover", onOver);
      view.dom.addEventListener("mouseleave", hide);
      view.dom.addEventListener("mousedown", hide);
      view.dom.addEventListener("keydown", hide);
      return {
        destroy: () => {
          hide();
          view.dom.removeEventListener("mouseover", onOver);
          view.dom.removeEventListener("mouseleave", hide);
          view.dom.removeEventListener("mousedown", hide);
          view.dom.removeEventListener("keydown", hide);
        },
      };
    },
  });
