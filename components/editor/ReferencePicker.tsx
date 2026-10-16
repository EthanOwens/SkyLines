"use client";

// Read-only tree of everything a reference can point at: notebooks > folders >
// notes > pages > text boxes > images. Pages load when a note is expanded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { getPages } from "@/lib/db/pages";
import { getNotebooks } from "@/lib/db/notebooks";
import { getFolders } from "@/lib/db/folders";
import { getNotes } from "@/lib/db/notes";
import { getStickyNotes } from "@/lib/db/stickyNotes";
import { extractPlainText } from "@/lib/tiptap/extractText";
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible";
import type { Reference } from "@/lib/references/format";
import type { Folder, Note, Notebook, Page } from "@/types";

interface TreeNode {
  key: string;
  label: string;
  // Absent on the Sticky notes group, which isn't pickable.
  ref?: Reference;
  // Present when the children are already known.
  children?: TreeNode[];
  // Present on nodes whose children need a database read.
  load?: () => Promise<TreeNode[]>;
}

type DocNode = { type?: string; attrs?: { id?: string }; content?: DocNode[] };

function imageIds(doc: DocNode | null | undefined, out: string[] = []): string[] {
  if (!doc) return out;
  if (doc.type === "image" && doc.attrs?.id) out.push(doc.attrs.id);
  doc.content?.forEach((c) => imageIds(c, out));
  return out;
}

function textBoxNodes(page: Page): TreeNode[] {
  const data = page.canvasData as { document?: { store?: object }; store?: object } | null | undefined;
  const store = data?.document?.store ?? data?.store;
  if (!store) return [];
  const shapes = (Object.values(store) as { id: string; typeName: string; type?: string; props?: { content?: object | null } }[])
    .filter((r) => r.typeName === "shape" && r.type === "rich-text");
  return shapes.map((shape) => {
    const doc = shape.props?.content as DocNode | null | undefined;
    const images = imageIds(doc).map((imageId, i) => ({
      key: `image:${page.id}:${shape.id}:${imageId}`,
      label: `Image ${i + 1}`,
      ref: { kind: "image", id: imageId, pageId: page.id, shapeId: shape.id } as Reference,
    }));
    return {
      key: `shape:${page.id}:${shape.id}`,
      label: extractPlainText(doc, 60) || "Text box",
      ref: { kind: "shape", id: shape.id, pageId: page.id, shapeId: shape.id },
      children: images,
    };
  });
}

function pageNodes(pages: Page[]): TreeNode[] {
  return [...pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => ({
      key: `page:${page.id}`,
      label: page.title || "Untitled",
      ref: { kind: "page", id: page.id },
      children: textBoxNodes(page),
    }));
}

function noteNode(note: Note): TreeNode {
  return {
    key: `note:${note.id}`,
    label: note.title || "Untitled",
    ref: { kind: "note", id: note.id },
    load: async () => pageNodes(await getPages(note.id)),
  };
}

function folderNode(folder: Folder, folders: Folder[], notes: Note[]): TreeNode {
  return {
    key: `folder:${folder.id}`,
    label: folder.name,
    ref: { kind: "folder", id: folder.id },
    children: levelNodes(folder.id, folder.notebookId, folders, notes),
  };
}

function levelNodes(
  parentId: string | null,
  notebookId: string | null,
  folders: Folder[],
  notes: Note[],
): TreeNode[] {
  const subFolders = folders
    .filter((f) => f.parentId === parentId && (parentId || f.notebookId === notebookId))
    .sort((a, b) => a.order - b.order);
  const levelNotes = notes
    .filter((n) => n.folderId === parentId && (parentId || n.notebookId === notebookId))
    .sort((a, b) => a.order - b.order);
  return [...subFolders.map((f) => folderNode(f, folders, notes)), ...levelNotes.map(noteNode)];
}

const KIND_LABELS: Record<Reference["kind"], string> = {
  notebook: "notebook",
  folder: "folder",
  note: "note",
  page: "page",
  shape: "text box",
  image: "image",
  sticky: "sticky note",
};

interface Props {
  search: string;
  onPick: (ref: Reference) => void;
  // Sticky windows have no loaded store; with this set and an empty store, the tree reads SQLite.
  userId?: string | null;
}

export function ReferencePicker({ search, onPick, userId }: Props) {
  const storeNotebooks = useAppStore((s) => s.notebooks);
  const storeFolders = useAppStore((s) => s.folders);
  const storeNotes = useAppStore((s) => s.notes);
  const [db, setDb] = useState<{ notebooks: Notebook[]; folders: Folder[]; notes: Note[] } | null>(null);
  const storeEmpty = storeNotebooks.length === 0;
  useEffect(() => {
    if (!storeEmpty || !userId) return;
    void Promise.all([getNotebooks(userId), getFolders(userId), getNotes(userId)])
      .then(([notebooks, folders, notes]) => setDb({ notebooks, folders, notes }))
      .catch((err) => console.error("Reference tree load failed", err));
  }, [storeEmpty, userId]);
  const notebooks = storeEmpty && db ? db.notebooks : storeNotebooks;
  const folders = storeEmpty && db ? db.folders : storeFolders;
  const notes = storeEmpty && db ? db.notes : storeNotes;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, TreeNode[]>>({});
  const q = search.trim().toLowerCase();

  const roots = useMemo<TreeNode[]>(
    () =>
      [...notebooks]
        .sort((a, b) => a.order - b.order)
        .map((nb) => ({
          key: `notebook:${nb.id}`,
          label: nb.name,
          ref: { kind: "notebook", id: nb.id },
          children: levelNodes(null, nb.id, folders, notes),
        })),
    [notebooks, folders, notes],
  );
  const tree = useMemo<TreeNode[]>(
    () =>
      userId
        ? [
            ...roots,
            {
              key: "sticky-group",
              label: "Sticky notes",
              load: async () =>
                (await getStickyNotes(userId)).map((n) => ({
                  key: `sticky:${n.id}`,
                  label:
                    n.title ||
                    extractPlainText(n.content).replace(/\[Image\]/g, "").trim().slice(0, 60) ||
                    "Untitled",
                  ref: { kind: "sticky", id: n.id } as Reference,
                })),
            },
          ]
        : roots,
    [roots, userId],
  );

  const kidsOf = useCallback((n: TreeNode) => n.children ?? loaded[n.key], [loaded]);
  const matches = useCallback(
    (n: TreeNode): boolean =>
      n.label.toLowerCase().includes(q) || (kidsOf(n) ?? []).some(matches),
    [q, kidsOf],
  );

  // Keys already loaded or being loaded, so each note is fetched once.
  const requestedRef = useRef<Set<string>>(new Set());
  const loadNode = useCallback((node: TreeNode) => {
    if (!node.load || requestedRef.current.has(node.key)) return;
    requestedRef.current.add(node.key);
    void node
      .load()
      .then((kids) => setLoaded((l) => ({ ...l, [node.key]: kids })))
      .catch(() => requestedRef.current.delete(node.key));
  }, []);

  // Search covers everything, so the first search loads every note's pages.
  useEffect(() => {
    if (!q) return;
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => {
        loadNode(n);
        if (n.children) walk(n.children);
      });
    walk(tree);
  }, [q, tree, loadNode]);

  function toggle(node: TreeNode, next: boolean) {
    setOpen((o) => ({ ...o, [node.key]: next }));
    if (next) loadNode(node);
  }

  function renderNode(node: TreeNode, depth: number) {
    if (q && !matches(node)) return null;
    const kids = kidsOf(node);
    const ref = node.ref;
    const expandable = !!node.load || (kids?.length ?? 0) > 0;
    const isOpen = !!open[node.key] || (q !== "" && !!kids?.some(matches));
    return (
      <Collapsible key={node.key} open={isOpen} onOpenChange={(v) => toggle(node, v)}>
        <div
          className="flex items-center rounded-md hover:bg-accent hover:text-accent-foreground"
          style={{ paddingLeft: depth * 12 }}
        >
          <button
            type="button"
            aria-label={isOpen ? "Collapse" : "Expand"}
            disabled={!expandable}
            onClick={() => toggle(node, !isOpen)}
            className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground disabled:invisible"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
          <button
            type="button"
            data-ref-row={ref?.kind}
            onClick={() => (ref ? onPick(ref) : toggle(node, !isOpen))}
            className="min-w-0 flex-1 truncate py-1 text-left text-sm"
          >
            {node.label}
          </button>
          {ref && (
            <span className="shrink-0 pr-2 text-xs text-muted-foreground">
              {KIND_LABELS[ref.kind]}
            </span>
          )}
        </div>
        <CollapsiblePanel>{kids?.map((k) => renderNode(k, depth + 1))}</CollapsiblePanel>
      </Collapsible>
    );
  }

  const rows = tree.map((r) => renderNode(r, 0)).filter(Boolean);
  return (
    <div className="flex max-h-48 flex-col overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-1 py-2 text-xs text-muted-foreground">Nothing found</div>
      ) : (
        rows
      )}
    </div>
  );
}
