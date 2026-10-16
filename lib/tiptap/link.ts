import { getMarkRange } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { find } from "linkifyjs";

const bare = (url: string) => url.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** True when a link's text is just its own URL (ignoring scheme and a trailing slash). */
export function isAutoTextLink(text: string, href: string): boolean {
  return bare(text) === bare(href);
}

/** The href linkify gives clipboard text that is exactly one URL, else null. */
export function singleUrlHref(text: string): string | null {
  const link = find(text, { defaultProtocol: "http" }).find((l) => l.isLink && l.value === text);
  return link ? link.href : null;
}

/**
 * The link mark when the text selection lies inside one web link whose whole
 * text is its own URL.
 */
export function selectedAutoTextLink(state: EditorState): Mark | null {
  const { from, to, empty } = state.selection;
  const type = state.schema.marks.link;
  if (empty || !type || !(state.selection instanceof TextSelection)) return null;
  const range = getMarkRange(state.doc.resolve(from + 1), type);
  if (!range || range.to < to) return null;
  const mark = state.doc.nodeAt(from)?.marks.find((m) => m.type === type);
  if (!mark) return null;
  const text = state.doc.textBetween(range.from, range.to);
  return isAutoTextLink(text, mark.attrs.href) ? mark : null;
}

/**
 * Replaces from..to with `text` linked to `href`, keeping `marks` other than
 * link. The cursor lands after it with the link mark off, so typing doesn't extend it.
 */
export function replaceWithLinkedText(
  tr: Transaction,
  from: number,
  to: number,
  text: string,
  href: string,
  marks: readonly Mark[],
): Transaction {
  const type = tr.doc.type.schema.marks.link;
  const kept = marks.filter((m) => m.type !== type);
  tr.replaceWith(from, to, tr.doc.type.schema.text(text, [...kept, type.create({ href })]));
  return tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks(kept);
}
