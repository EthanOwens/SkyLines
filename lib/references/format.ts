export type ReferenceKind = "notebook" | "folder" | "note" | "page" | "shape" | "sticky" | "image";

// A shape ID is only unique within its page, so a shape reference carries
// both: `id` is the shape ID and `pageId` its page.
export type Reference =
  | { kind: Exclude<ReferenceKind, "shape" | "image">; id: string }
  | { kind: "shape"; id: string; pageId: string; shapeId: string }
  // `id` is the image node's id, inside either a canvas text box or a sticky note.
  | { kind: "image"; id: string; pageId: string; shapeId: string; stickyId?: undefined }
  | { kind: "image"; id: string; stickyId: string; pageId?: undefined; shapeId?: undefined };

export const REFERENCE_SCHEME = "skylines://";

const SIMPLE_KINDS = ["notebook", "folder", "note", "page", "sticky"] as const;
const SEGMENT = "[^/\\s]+";
const SIMPLE_RE = new RegExp(`^skylines://(${SIMPLE_KINDS.join("|")})/(${SEGMENT})$`);
const SHAPE_RE = new RegExp(`^skylines://shape/(${SEGMENT})/(${SEGMENT})$`);
const IMAGE_SHAPE_RE = new RegExp(`^skylines://image/shape/(${SEGMENT})/(${SEGMENT})/(${SEGMENT})$`);
const IMAGE_STICKY_RE = new RegExp(`^skylines://image/sticky/(${SEGMENT})/(${SEGMENT})$`);

export function formatReference(ref: Reference): string {
  if (ref.kind === "image") {
    return ref.stickyId !== undefined
      ? `${REFERENCE_SCHEME}image/sticky/${ref.stickyId}/${ref.id}`
      : `${REFERENCE_SCHEME}image/shape/${ref.pageId}/${ref.shapeId}/${ref.id}`;
  }
  if (ref.kind === "shape") return `${REFERENCE_SCHEME}shape/${ref.pageId}/${ref.shapeId}`;
  return `${REFERENCE_SCHEME}${ref.kind}/${ref.id}`;
}

export function parseReference(text: string): Reference | null {
  const token = text.trim();
  const imageShape = IMAGE_SHAPE_RE.exec(token);
  if (imageShape) {
    return { kind: "image", id: imageShape[3], pageId: imageShape[1], shapeId: imageShape[2] };
  }
  const imageSticky = IMAGE_STICKY_RE.exec(token);
  if (imageSticky) return { kind: "image", id: imageSticky[2], stickyId: imageSticky[1] };
  const shape = SHAPE_RE.exec(token);
  if (shape) return { kind: "shape", id: shape[2], pageId: shape[1], shapeId: shape[2] };
  const simple = SIMPLE_RE.exec(token);
  if (simple) return { kind: simple[1] as (typeof SIMPLE_KINDS)[number], id: simple[2] };
  return null;
}
