// Handles clicks on sticky:<id> links. Link's openOnClick: false only stops its
// window.open; other handleClick props still run, so this can sit alongside it.
// handleClick rather than handleClickOn because a link is a mark, not a node
// (Tiptap's Link uses the same approach).
//
// An editorProps fragment, so each editor can spread it in.
import type { EditorView } from "@tiptap/pm/view";
import { openStickyNoteWindow } from "@/lib/stickyWindow";

export const STICKY_LINK_HREF_PREFIX = "sticky:";

export function extractStickyNoteId(href: string): string | null {
  if (!href.startsWith(STICKY_LINK_HREF_PREFIX)) return null;
  const id = href.slice(STICKY_LINK_HREF_PREFIX.length);
  return id.length > 0 ? id : null;
}

export function stickyLinkClickEditorProps() {
  return {
    handleClick: (_view: EditorView, _pos: number, event: MouseEvent) => {
      if (event.button !== 0) return false;

      const target = event.target;
      if (!(target instanceof Element)) return false;
      const link = target.closest("a");
      if (!link) return false;

      const href = link.getAttribute("href") ?? "";
      const id = extractStickyNoteId(href);
      if (!id) return false;

      void openStickyNoteWindow(id);
      return true;
    },
  };
}
