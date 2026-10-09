"use client";

// Ctrl+K dialog shared by RichTextEditor and RichTextShape. A link can be a
// URL, a new sticky note or an existing one; sticky notes are stored as
// sticky:<id> hrefs on the normal Link mark.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { getStickyNotes, createStickyNote } from "@/lib/db/stickyNotes";
import { openStickyNoteWindow } from "@/lib/stickyWindow";
import { extractPlainText, extractFirstImageSrc } from "@/lib/tiptap/extractText";
import type { StickyNote } from "@/types";

interface LinkOrStickyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor | null;
  currentUrl: string | null;
  // Null until auth resolves; only the URL tab works until then.
  userId: string | null;
}

function applyLink(editor: Editor, href: string) {
  if (href === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  } else {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }
}

export function LinkOrStickyDialog({
  open,
  onOpenChange,
  editor,
  currentUrl,
  userId,
}: LinkOrStickyDialogProps) {
  const [urlInput, setUrlInput] = useState("");
  const [search, setSearch] = useState("");
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [creating, setCreating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Prevents running an action twice when a click fires both mousedown and
  // click. Keyboard activation fires only click, so it still runs.
  const handledByMouseDownRef = useRef(false);
  function makeHandlers(action: () => void) {
    return {
      onMouseDown: () => {
        handledByMouseDownRef.current = true;
        action();
      },
      onClick: () => {
        if (handledByMouseDownRef.current) {
          handledByMouseDownRef.current = false;
          return;
        }
        action();
      },
    };
  }

  useEffect(() => {
    if (!open) return;
    setUrlInput(currentUrl ?? "");
    setSearch("");
    if (userId) {
      void getStickyNotes(userId).then(setStickyNotes);
    } else {
      setStickyNotes([]);
    }
  }, [open, currentUrl, userId]);

  const filteredStickyNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stickyNotes;
    return stickyNotes.filter((n) => n.title.toLowerCase().includes(q));
  }, [stickyNotes, search]);

  function handleSubmitUrl() {
    if (!editor) return;
    applyLink(editor, urlInput.trim());
    onOpenChange(false);
  }

  async function handleCreateNewStickyNote() {
    if (!editor || !userId || creating) return;
    setCreating(true);
    try {
      const id = await createStickyNote(userId);
      await openStickyNoteWindow(id);
      applyLink(editor, `sticky:${id}`);
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  }

  function handlePickStickyNote(note: StickyNote) {
    if (!editor) return;
    applyLink(editor, `sticky:${note.id}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
        </DialogHeader>

        {/*
          Actions run on mousedown because a tldraw shape's pointer capture can
          swallow the mouseup, and with it the click. onClick stays wired for
          keyboard Enter/Space.
        */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          {...makeHandlers(() => onOpenChange(false))}
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
            <Button size="sm" {...makeHandlers(handleSubmitUrl)}>
              Insert link
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!userId || creating}
            {...makeHandlers(() => void handleCreateNewStickyNote())}
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
              {...makeHandlers(() => setShowPreview((v) => !v))}
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
                  {...makeHandlers(() => handlePickStickyNote(note))}
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
          <Button variant="outline" {...makeHandlers(() => onOpenChange(false))}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
