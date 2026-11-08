import type { Note } from "@/types";

// History search syntax: plain words match the title; `has:image` needs an
// image in the note; `has:word` (or has:"two words") needs that text in the
// note body. Every term must match.

export type HistoryTerm = { kind: "title" | "image" | "body"; value: string };

export function parseHistoryQuery(query: string): HistoryTerm[] {
  const terms: HistoryTerm[] = [];
  const re = /(has:)?(?:"([^"]*)"|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const value = (m[2] ?? m[3] ?? "").toLowerCase();
    if (!value) continue;
    if (!m[1]) terms.push({ kind: "title", value });
    else if (value === "image" || value === "images") terms.push({ kind: "image", value });
    else terms.push({ kind: "body", value });
  }
  return terms;
}

function collect(node: unknown, texts: string[], found: { image: boolean }): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, texts, found);
  } else if (node && typeof node === "object") {
    for (const [key, val] of Object.entries(node)) {
      if (key === "type" && val === "image") found.image = true;
      else if (key === "text" && typeof val === "string") texts.push(val);
      else collect(val, texts, found);
    }
  }
}

export function noteMatchesHistoryTerms(note: Note, terms: HistoryTerm[]): boolean {
  if (terms.length === 0) return true;
  const texts: string[] = [];
  const found = { image: false };
  collect(note.content, texts, found);
  collect(note.canvasData, texts, found);
  const body = texts.join(" ").toLowerCase();
  const title = (note.title || "Untitled").toLowerCase();

  return terms.every((t) => {
    if (t.kind === "title") return title.includes(t.value);
    if (t.kind === "image") return found.image;
    return body.includes(t.value);
  });
}
