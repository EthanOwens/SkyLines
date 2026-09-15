// spec.md subtask 14 ("Sticky notes home page"). Sticky note `content` is
// stored as Tiptap JSON (an object like `{ type: "doc", content: [...] }`),
// not plain text, so preview cards need a small plain-text extraction to
// show a "first line of content"-style snippet. Walks `content` arrays
// depth-first, concatenating every node's own `text` field - doesn't need to
// special-case node types (headings, paragraphs, lists, etc. all just nest
// `content` arrays the same way), so this stays a generic tree walk rather
// than an exhaustive per-node-type switch.
type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
};

const DEFAULT_MAX_LENGTH = 80;

export function extractPlainText(doc: object | null | undefined, maxLength = DEFAULT_MAX_LENGTH): string {
  if (!doc) return "";

  const parts: string[] = [];
  function walk(node: TiptapNode) {
    if (typeof node.text === "string") parts.push(node.text);
    // Image is a leaf node with no text/content - fall back to a
    // placeholder so an image-only note doesn't show as "Empty".
    else if (node.type === "image") parts.push("[Image]");
    node.content?.forEach(walk);
  }
  walk(doc as TiptapNode);

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
