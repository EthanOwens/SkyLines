import type { Reference } from "./format";
import { getNotebookById } from "@/lib/db/notebooks";
import { getFolderById } from "@/lib/db/folders";
import { getNoteById } from "@/lib/db/notes";
import { getPageById, getPages } from "@/lib/db/pages";
import { getStickyNoteById } from "@/lib/db/stickyNotes";
import { extractFirstImageSrc, extractPlainText } from "@/lib/tiptap/extractText";
import type { Folder } from "@/types";

export interface ResolvedReference {
  exists: boolean;
  title: string;
  // Ancestors from the notebook down, excluding the item itself.
  path: string[];
  previewText: string;
  previewImage: string | null;
}

const PREVIEW_LENGTH = 300;
const TITLE_LENGTH = 80;

const NOT_FOUND: ResolvedReference = {
  exists: false,
  title: "",
  path: [],
  previewText: "",
  previewImage: null,
};

type ShapeRecord = {
  id: string;
  typeName: "shape";
  type: string;
  x?: number;
  y?: number;
  props?: { content?: object | null; richText?: object | null; assetId?: string | null };
};

type AssetRecord = { id: string; typeName: "asset"; props?: { src?: string | null } };

type StoreRecord = ShapeRecord | AssetRecord | { typeName: string; id: string };

// Pages hold a TLEditorSnapshot ({ document: { store } }); older saves may be a
// bare TLStoreSnapshot ({ store }).
function snapshotRecords(canvasData: object | null | undefined): StoreRecord[] {
  if (!canvasData) return [];
  const data = canvasData as { document?: { store?: object }; store?: object };
  const store = data.document?.store ?? data.store;
  return store ? (Object.values(store) as StoreRecord[]) : [];
}

function isShape(record: StoreRecord): record is ShapeRecord {
  return record.typeName === "shape";
}

// Rich-text boxes keep Tiptap JSON in `content`; tldraw's built-in text, geo
// and note shapes keep it in `richText`.
function shapeDoc(shape: ShapeRecord): object | null {
  return shape.props?.content ?? shape.props?.richText ?? null;
}

function shapeImage(shape: ShapeRecord, records: StoreRecord[]): string | null {
  const doc = shapeDoc(shape);
  const inline = doc ? extractFirstImageSrc(doc) : null;
  if (inline) return inline;
  const assetId = shape.props?.assetId;
  if (shape.type !== "image" || !assetId) return null;
  const asset = records.find((r) => r.id === assetId && r.typeName === "asset") as
    | AssetRecord
    | undefined;
  return asset?.props?.src ?? null;
}

function shapeTitle(shape: ShapeRecord): string {
  const text = extractPlainText(shapeDoc(shape), TITLE_LENGTH);
  if (text) return text;
  return shape.type === "rich-text" ? "Text box" : shape.type;
}

// Reading order (top to bottom, then left to right) so previews start with
// what the user sees first on the page.
function canvasPreview(canvasData: object | null | undefined) {
  const records = snapshotRecords(canvasData);
  const shapes = records
    .filter(isShape)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const texts: string[] = [];
  let image: string | null = null;
  for (const shape of shapes) {
    const doc = shapeDoc(shape);
    const text = doc ? extractPlainText(doc, PREVIEW_LENGTH) : "";
    if (text) texts.push(text);
    image ??= shapeImage(shape, records);
  }
  return { text: truncate(texts.join(" "), PREVIEW_LENGTH), image };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

async function folderChain(folderId: string | null): Promise<Folder[] | null> {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = await getFolderById(id);
    if (!folder) return null;
    chain.unshift(folder);
    id = folder.parentId;
  }
  return chain;
}

// Path to (and including) a notebook and folder. Null when an ancestor is
// gone, since the item is then unreachable from the tree.
async function containerPath(
  notebookId: string | null,
  folderId: string | null,
): Promise<string[] | null> {
  const folders = await folderChain(folderId);
  if (!folders) return null;
  const notebook = notebookId ? await getNotebookById(notebookId) : null;
  if (notebookId && !notebook) return null;
  return [...(notebook ? [notebook.name] : []), ...folders.map((f) => f.name)];
}

async function notePath(noteId: string) {
  const note = await getNoteById(noteId);
  if (!note) return null;
  const path = await containerPath(note.notebookId, note.folderId);
  return path ? { note, path } : null;
}

// Reads SQLite directly rather than the app store, so it works in sticky and
// image-editor windows too. Database errors propagate, so callers can tell a
// failed read from a missing target.
export async function resolveReference(ref: Reference): Promise<ResolvedReference> {
  switch (ref.kind) {
    case "notebook": {
      const notebook = await getNotebookById(ref.id);
      if (!notebook) return NOT_FOUND;
      return { exists: true, title: notebook.name, path: [], previewText: "", previewImage: null };
    }
    case "folder": {
      const folder = await getFolderById(ref.id);
      if (!folder) return NOT_FOUND;
      const path = await containerPath(folder.notebookId, folder.parentId);
      if (!path) return NOT_FOUND;
      return { exists: true, title: folder.name, path, previewText: "", previewImage: null };
    }
    case "note": {
      const found = await notePath(ref.id);
      if (!found) return NOT_FOUND;
      const { note, path } = found;
      let previewText = extractPlainText(note.content, PREVIEW_LENGTH);
      let previewImage = extractFirstImageSrc(note.content);
      if (!previewText && !previewImage) {
        const [firstPage] = await getPages(note.id);
        const preview = canvasPreview(firstPage?.canvasData);
        previewText = preview.text;
        previewImage = preview.image;
      }
      return { exists: true, title: note.title, path, previewText, previewImage };
    }
    case "page": {
      const page = await getPageById(ref.id);
      if (!page) return NOT_FOUND;
      const found = await notePath(page.noteId);
      if (!found) return NOT_FOUND;
      const preview = canvasPreview(page.canvasData);
      return {
        exists: true,
        title: page.title,
        path: [...found.path, found.note.title],
        previewText: preview.text,
        previewImage: preview.image,
      };
    }
    case "shape": {
      const page = await getPageById(ref.pageId);
      if (!page) return NOT_FOUND;
      const records = snapshotRecords(page.canvasData);
      const shape = records.find((r) => r.id === ref.shapeId && isShape(r)) as
        | ShapeRecord
        | undefined;
      if (!shape) return NOT_FOUND;
      const found = await notePath(page.noteId);
      if (!found) return NOT_FOUND;
      const doc = shapeDoc(shape);
      return {
        exists: true,
        title: shapeTitle(shape),
        path: [...found.path, found.note.title, page.title],
        previewText: doc ? extractPlainText(doc, PREVIEW_LENGTH) : "",
        previewImage: shapeImage(shape, records),
      };
    }
    case "sticky": {
      const sticky = await getStickyNoteById(ref.id);
      if (!sticky) return NOT_FOUND;
      return {
        exists: true,
        title: sticky.title || "Untitled",
        path: [],
        previewText: extractPlainText(sticky.content, PREVIEW_LENGTH),
        previewImage: extractFirstImageSrc(sticky.content),
      };
    }
  }
}
