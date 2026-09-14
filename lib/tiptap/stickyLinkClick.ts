// spec.md subtask 12 ("Sticky note embed rendering"). Both
// components/editor/RichTextEditor.tsx and components/canvas/RichTextShape.tsx
// insert sticky-note references as a plain Tiptap `Link` mark with a
// `sticky:<id>` href (spec.md subtask 11's bridging convention), and both
// already configure `Link.configure({ openOnClick: false })`, which fully
// disables Link's OWN click handling (see @tiptap/extension-link's
// clickHandler.ts - `openOnClick: false` just skips its `window.open` call,
// it doesn't stop the click event or prevent other plugins' `handleClick`
// props from running). This adds click interception SPECIFICALLY for
// `sticky:` hrefs on top of that, via ProseMirror's `handleClick` editorProp
// - the exact same mechanism (not `handleClickOn`, which iterates DOM NODES
// around the click and is meant for node-view-style click targets; a link is
// a MARK on a text node, not a distinct node, so Tiptap's own Link extension
// itself uses `handleClick`, checking `event.target`/`closest("a")` - see
// node_modules/@tiptap/extension-link/dist/index.js's `clickHandler`) that
// extension's own (disabled) click handling uses, so this exactly reuses its
// convention rather than introducing a different interception mechanism for
// no reason. Multiple plugins' `handleClick` props all run per click
// (ProseMirror stops at the first one that returns `true`), so this can
// coexist with Link's own now-inert handler with no conflict.
//
// Exported as a single `editorProps` fragment (not a full custom Extension)
// since both call sites already pass a plain `editorProps` object to
// `useEditor`/`useTiptapEditor` - spreading this in is the smallest change
// that avoids duplicating the click-interception logic itself in both files,
// per spec.md's explicit instruction. Deliberately not hardcoded to either
// call site (no assumptions about surrounding editorProps) so it's trivially
// reusable by components/editor/StickyNoteEditor.tsx too (subtask 13).
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
