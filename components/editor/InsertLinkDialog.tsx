"use client";

// Ctrl+K dialog shared by RichTextEditor and RichTextShape. Inserts a web link
// or a reference chip (pasted token, tree pick, sticky note or a new sticky).

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { Editor } from "@tiptap/react";
import { XIcon, List, LayoutGrid } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReferencePicker } from "./ReferencePicker";
import { parseReference, type Reference } from "@/lib/references/format";
import { getStickyNotes, createStickyNote } from "@/lib/db/stickyNotes";
import { openStickyNoteWindow } from "@/lib/stickyWindow";
import { extractPlainText, extractFirstImageSrc } from "@/lib/tiptap/extractText";
import type { StickyNote } from "@/types";

interface InsertLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor | null;
  currentUrl: string | null;
  // Null until auth resolves; only the URL tab works until then.
  userId: string | null;
}

type SavedSelection = { from: number; to: number };

// Actions apply to the selection captured when the dialog opened, which may
// have moved since (for example through a content sync on the canvas).
function restoreSelection(editor: Editor, saved: SavedSelection | null) {
  if (saved) editor.commands.setTextSelection(saved);
}

function applyLink(editor: Editor, href: string, saved: SavedSelection | null) {
  restoreSelection(editor, saved);
  if (href === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  } else {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }
}

// isActive("link") can't be used here: the Link mark is inclusive, so it also
// reports true at a link's edges, where the user is adding text rather than
// editing that link.
function isCursorStrictlyInsideLink(editor: Editor) {
  const { selection, schema } = editor.state;
  const linkType = schema.marks.link;
  if (!selection.empty || !linkType) return false;
  const { nodeBefore, nodeAfter } = selection.$from;
  const before = nodeBefore && linkType.isInSet(nodeBefore.marks);
  const after = nodeAfter && linkType.isInSet(nodeAfter.marks);
  return !!before && !!after && before.eq(after);
}

// With nothing selected and the cursor not inside a link, there's no text to
// link, so the URL itself goes in as new link text.
function applyUrl(editor: Editor, href: string, saved: SavedSelection | null) {
  restoreSelection(editor, saved);
  if (
    href !== "" &&
    editor.state.selection.empty &&
    !isCursorStrictlyInsideLink(editor) &&
    editor.can().setLink({ href })
  ) {
    editor
      .chain()
      .focus()
      .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
      // Typing straight after the inserted URL shouldn't extend the link.
      .unsetMark("link")
      .run();
    return;
  }
  applyLink(editor, href, null);
}

// The dialog is portalled, but React events still bubble through the React
// tree to its host. On the canvas that's tldraw's .tl-canvas handlers, which
// would capture the pointer and end the text box's editing session.
function stopReactPropagation(e: SyntheticEvent) {
  e.stopPropagation();
}

export function InsertLinkDialog({
  open,
  onOpenChange,
  editor,
  currentUrl,
  userId,
}: InsertLinkDialogProps) {
  const [urlInput, setUrlInput] = useState("");
  const [search, setSearch] = useState("");
  const [treeSearch, setTreeSearch] = useState("");
  const [refInput, setRefInput] = useState("");
  const [refError, setRefError] = useState(false);
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [creating, setCreating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const savedSelectionRef = useRef<SavedSelection | null>(null);
  useEffect(() => {
    if (!open || !editor) return;
    const { from, to } = editor.state.selection;
    savedSelectionRef.current = { from, to };
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    const insertsNewLink =
      !!editor && editor.state.selection.empty && !isCursorStrictlyInsideLink(editor);
    setUrlInput(insertsNewLink ? "" : (currentUrl ?? ""));
    setSearch("");
    setTreeSearch("");
    setRefInput("");
    setRefError(false);
    if (userId) {
      void getStickyNotes(userId).then(setStickyNotes);
    } else {
      setStickyNotes([]);
    }
  }, [open, currentUrl, userId, editor]);

  const filteredStickyNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stickyNotes;
    return stickyNotes.filter((n) => n.title.toLowerCase().includes(q));
  }, [stickyNotes, search]);

  // Closing without inserting anything. Base UI's own focus return is off
  // (finalFocus={false}) because the element focused before opening, such as
  // a bubble menu button, may be gone by now.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && editor && editor.isEditable) {
      const saved = savedSelectionRef.current;
      const chain = editor.chain().focus();
      if (saved) chain.setTextSelection(saved);
      chain.run();
    }
    onOpenChange(nextOpen);
  }

  function handleSubmitUrl() {
    if (!editor) return;
    applyUrl(editor, urlInput.trim(), savedSelectionRef.current);
    onOpenChange(false);
  }

  function insertReference(ref: Reference) {
    if (!editor) return;
    restoreSelection(editor, savedSelectionRef.current);
    editor.chain().focus().insertReference(ref).run();
    onOpenChange(false);
  }

  function handleSubmitReference() {
    const ref = parseReference(refInput);
    if (!ref) {
      setRefError(true);
      return;
    }
    insertReference(ref);
  }

  async function handleCreateNewStickyNote() {
    if (!editor || !userId || creating) return;
    setCreating(true);
    try {
      const id = await createStickyNote(userId);
      await openStickyNoteWindow(id);
      insertReference({ kind: "sticky", id });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      style={{ display: "contents" }}
      onPointerDown={stopReactPropagation}
      onPointerUp={stopReactPropagation}
      onMouseDown={stopReactPropagation}
      onMouseUp={stopReactPropagation}
      onClick={stopReactPropagation}
      onDoubleClick={stopReactPropagation}
      onTouchStart={stopReactPropagation}
      onTouchEnd={stopReactPropagation}
      onKeyDown={stopReactPropagation}
      onKeyUp={stopReactPropagation}
    >
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" showCloseButton={false} finalFocus={false}>
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
          </DialogHeader>

          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2"
            onClick={() => handleOpenChange(false)}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>

          <div className="flex flex-col gap-2">
            <label htmlFor="link-or-sticky-url" className="text-xs font-medium text-muted-foreground">
              URL
            </label>
            <div className="flex gap-2">
              <input
                id="link-or-sticky-url"
                type="text"
                autoFocus
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitUrl();
                  }
                }}
                placeholder="https://"
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button size="sm" onClick={handleSubmitUrl}>
                Insert link
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <label htmlFor="link-or-sticky-ref" className="text-xs font-medium text-muted-foreground">
              Paste a reference
            </label>
            <div className="flex gap-2">
              <input
                id="link-or-sticky-ref"
                type="text"
                value={refInput}
                onChange={(e) => {
                  setRefInput(e.target.value);
                  setRefError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitReference();
                  }
                }}
                placeholder="skylines://"
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button size="sm" onClick={handleSubmitReference}>
                Insert
              </Button>
            </div>
            {refError && (
              <div role="alert" className="text-xs text-destructive">
                Not a valid reference. Use Copy reference in a right-click menu.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <label htmlFor="link-or-sticky-tree-search" className="text-xs font-medium text-muted-foreground">
              Notes and text boxes
            </label>
            <input
              id="link-or-sticky-tree-search"
              type="text"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <ReferencePicker search={treeSearch} onPick={insertReference} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!userId || creating}
              onClick={() => void handleCreateNewStickyNote()}
            >
              Create new sticky note
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label htmlFor="link-or-sticky-search" className="text-xs font-medium text-muted-foreground">
                Existing sticky notes
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                title={showPreview ? "Show titles only" : "Show mini previews"}
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? <List /> : <LayoutGrid />}
                <span className="sr-only">Toggle preview</span>
              </Button>
            </div>
            <input
              id="link-or-sticky-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sticky notes..."
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="flex max-h-40 flex-col overflow-y-auto">
              {filteredStickyNotes.length === 0 && (
                <div className="px-1 py-2 text-xs text-muted-foreground">
                  {userId ? "No sticky notes found" : "Sign in to view sticky notes"}
                </div>
              )}
              {filteredStickyNotes.map((note) => {
                const rawPreview = showPreview ? extractPlainText(note.content) : "";
                // Strip extractPlainText's "[Image]" placeholders from the
                // preview.
                const preview = rawPreview.replace(/\[Image\]\s*/g, "").trim();
                const imageSrc = showPreview && !preview ? extractFirstImageSrc(note.content) : null;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => insertReference({ kind: "sticky", id: note.id })}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {imageSrc && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageSrc} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{note.title || "Untitled"}</span>
                      {showPreview && preview && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{preview}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
