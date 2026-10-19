// Plain-text preview of Tiptap JSON: a depth-first walk collecting every node's
// text.
type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: { src?: string; id?: string };
};

const DEFAULT_MAX_LENGTH = 80;

export function extractPlainText(doc: object | null | undefined, maxLength = DEFAULT_MAX_LENGTH): string {
  if (!doc) return "";

  const parts: string[] = [];
  function walk(node: TiptapNode) {
    if (typeof node.text === "string") parts.push(node.text);
    // Images have no text, so use a placeholder instead of showing "Empty".
    else if (node.type === "image") parts.push("[Image]");
    node.content?.forEach(walk);
  }
  walk(doc as TiptapNode);

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

// For thumbnails on notes that start with an image.
export function extractFirstImageSrc(doc: object | null | undefined): string | null {
  if (!doc) return null;

  function walk(node: TiptapNode): string | null {
    if (node.type === "image" && node.attrs?.src) return node.attrs.src;
    for (const child of node.content ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(doc as TiptapNode);
}

export function findImageSrc(doc: object | null | undefined, imageId: string): string | null {
  if (!doc) return null;

  function walk(node: TiptapNode): string | null {
    if (node.type === "image" && node.attrs?.id === imageId) return node.attrs.src ?? "";
    for (const child of node.content ?? []) {
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  }
  return walk(doc as TiptapNode);
}
