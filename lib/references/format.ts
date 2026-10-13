export type ReferenceKind = "notebook" | "folder" | "note" | "page" | "shape" | "sticky";

// A shape ID is only unique within its page, so a shape reference carries
// both: `id` is the shape ID and `pageId` its page.
export type Reference =
  | { kind: Exclude<ReferenceKind, "shape">; id: string }
  | { kind: "shape"; id: string; pageId: string; shapeId: string };

export const REFERENCE_SCHEME = "skylines://";

const SIMPLE_KINDS = ["notebook", "folder", "note", "page", "sticky"] as const;
const SEGMENT = "[^/\\s]+";
const SIMPLE_RE = new RegExp(`^skylines://(${SIMPLE_KINDS.join("|")})/(${SEGMENT})$`);
const SHAPE_RE = new RegExp(`^skylines://shape/(${SEGMENT})/(${SEGMENT})$`);

export function formatReference(ref: Reference): string {
  if (ref.kind === "shape") return `${REFERENCE_SCHEME}shape/${ref.pageId}/${ref.shapeId}`;
  return `${REFERENCE_SCHEME}${ref.kind}/${ref.id}`;
}

export function parseReference(text: string): Reference | null {
  const token = text.trim();
  const shape = SHAPE_RE.exec(token);
  if (shape) return { kind: "shape", id: shape[2], pageId: shape[1], shapeId: shape[2] };
  const simple = SIMPLE_RE.exec(token);
  if (simple) return { kind: simple[1] as (typeof SIMPLE_KINDS)[number], id: simple[2] };
  return null;
}
