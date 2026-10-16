import type { Reference } from "./format";

export interface SearchQuery {
  kinds: Reference["kind"][];
  has: string[];
  text: string;
  unknownKinds: string[];
}

const KIND_ALIASES: Record<string, Reference["kind"]> = {
  notebook: "notebook",
  folder: "folder",
  note: "note",
  page: "page",
  text_box: "shape",
  textbox: "shape",
  "text-box": "shape",
  image: "image",
  sticky: "sticky",
  sticky_note: "sticky",
};

// Whitespace-separated words; a quoted phrase may sit inside a word (has:"a b").
const TOKEN = /(?:[^\s"']|"[^"]*"?|'[^']*'?)+/g;

const unquote = (s: string) => s.replace(/"([^"]*)"?|'([^']*)'?/g, (_, a, b) => a ?? b);

export function parseSearchQuery(q: string): SearchQuery {
  const out: SearchQuery = { kinds: [], has: [], text: "", unknownKinds: [] };
  const words: string[] = [];
  for (const token of q.match(TOKEN) ?? []) {
    const m = /^(is|has):(.*)$/i.exec(token);
    const value = m ? unquote(m[2]).trim().toLowerCase() : "";
    if (!m || !value) words.push(unquote(token));
    else if (m[1].toLowerCase() === "has") out.has.push(value);
    else if (KIND_ALIASES[value]) out.kinds.push(KIND_ALIASES[value]);
    else out.unknownKinds.push(value);
  }
  out.text = words.join(" ").toLowerCase();
  return out;
}
