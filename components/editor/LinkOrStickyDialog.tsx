"use client";

// spec.md subtask 11 ("Ctrl+K dialog"). Replaces the bare
// `window.prompt("URL", prev)` both RichTextEditor.tsx (full-page notes) and
// RichTextShape.tsx (canvas shape) used to call directly from their own
// `setLink()` - shared here so the actual `setLink`/`unsetLink`/
// `extendMarkRange` chain (identical in both callers) isn't duplicated.
//
// Offers three ways to end up with a link: paste a URL (exact prior
// behavior), create a brand-new sticky note (creates the row, opens its
// pop-out window immediately, embeds `sticky:<id>` at the cursor), or pick an
// existing sticky note from a searchable list (embeds `sticky:<id>` the same
// way). Per spec.md's explicit sequencing note, `sticky:<id>` is just applied
// through the existing Tiptap Link mark - a later subtask (12) is
// responsible for giving that href scheme its own click/render behavior;
// until then it behaves like (and looks like) a normal link.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { XIcon } from "lucide-react";
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
import type { StickyNote } from "@/types";

interface LinkOrStickyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor | null;
  // The link URL currently under the cursor/selection, if editing an
  // existing link - pre-fills the URL input, mirroring
  // `window.prompt("URL", prev)`'s previous `prev` argument.
  currentUrl: string | null;
  // The signed-in user's id - required to list/create sticky notes. `null`
  // while auth hasn't resolved yet, in which case the sticky-note tabs are
  // simply unusable (the URL tab still works).
  userId: string | null;
}

// Applies `href` (a real URL, or a `sticky:<id>` reference) to the editor's
// current selection via the exact chain both callers previously ran inline,
// then closes the dialog. Shared here so it's identical for the URL submit,
// "create new sticky note", and "pick existing sticky note" paths.
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

  // Guards against double-firing when a real click DOES land both events
  // (possible outside the canvas-shape scenario this file's header comment
  // describes - e.g. this dialog opened somewhere else, or the upstream
  // pointer-capture bug going away). onMouseDown runs the action and flags
  // it as handled; the following onClick (real pointer clicks always fire
  // both) sees the flag and skips. A keyboard Enter/Space activation only
  // ever fires onClick, never onMouseDown, so it still runs the action -
  // that's the actual point of keeping onClick at all. Single shared ref is
  // fine even for the mapped sticky-note buttons below since only one
  // button can be mid-interaction at a time.
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

  // Re-seed the URL input and reload the sticky-note list every time the
  // dialog opens, same "always fresh on open" seeding pattern
  // ThemeEditor.tsx's own dialog-open effect uses.
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

        {/* Opened over a tldraw canvas shape, whose own pointer capture can
            steal the mouseup that would normally follow a click here,
            silently swallowing onClick - onMouseDown fires reliably instead,
            so every action in this dialog runs from onMouseDown. onClick is
            still wired to the same action (guarded via makeHandlers) so
            keyboard Enter/Space activation, which only ever fires onClick,
            keeps working. */}
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
          <label htmlFor="link-or-sticky-search" className="text-xs font-medium text-muted-foreground">
            Existing sticky notes
          </label>
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
            {filteredStickyNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                {...makeHandlers(() => handlePickStickyNote(note))}
                className="truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {note.title || "Untitled"}
              </button>
            ))}
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
