"use client";

// spec.md subtask 14 ("Sticky notes home page"). A Dialog-based "view"
// listing every sticky note as a collapsed preview card - title, first-line
// text preview, and a top-bar-color swatch - clicking a card opens that
// note's pop-out window (lib/stickyWindow.ts's `openStickyNoteWindow`,
// subtask 8). Built with the same `open`/`onOpenChange` prop shape as
// components/theme/ThemeEditor.tsx so subtask 15's ribbon button can wire it
// up the same way AccountMenu.tsx wires up ThemeEditor's own open state.
//
// Not a full route/page: spec.md only calls this "a new view", and this
// app's established pattern for a secondary UI surface opened from
// somewhere (not a full page route) is a Dialog - see ThemeEditor.tsx.

import { useEffect, useState } from "react";
import { Camera, Plus, StickyNote as StickyNoteIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/components/AuthProvider";
import { getStickyNotes, createStickyNote } from "@/lib/db/stickyNotes";
import { openStickyNoteWindow } from "@/lib/stickyWindow";
import { extractPlainText } from "@/lib/tiptap/extractText";
import { ScreenshotCapture } from "./ScreenshotCapture";
import type { StickyNote } from "@/types";

interface StickyNotesHomeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StickyNotesHome({ open, onOpenChange }: StickyNotesHomeProps) {
  const { user } = useAuthContext();
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [creating, setCreating] = useState(false);
  const [screenshotOpen, setScreenshotOpen] = useState(false);

  // Reload the list every time the dialog opens, same "always fresh on
  // open" seeding pattern ThemeEditor.tsx/LinkOrStickyDialog.tsx already
  // use - `getStickyNotes` already orders by `updatedAt DESC`, so no
  // client-side re-sorting is needed here.
  useEffect(() => {
    if (!open) return;
    if (user) {
      void getStickyNotes(user.uid).then(setStickyNotes);
    } else {
      setStickyNotes([]);
    }
  }, [open, user]);

  async function handleOpenNote(note: StickyNote) {
    await openStickyNoteWindow(note.id);
  }

  async function handleCreateNewStickyNote() {
    if (!user || creating) return;
    setCreating(true);
    try {
      const id = await createStickyNote(user.uid);
      await openStickyNoteWindow(id);
      setStickyNotes(await getStickyNotes(user.uid));
    } finally {
      setCreating(false);
    }
  }

  // A captured screenshot becomes a new sticky note's content as a single
  // Tiptap `image` node - StickyNoteEditor.tsx's editor already has
  // `Image.configure({ inline: false, allowBase64: true })`, so a base64
  // data URL `src` renders straight away with no further conversion.
  async function handleScreenshotCaptured(dataUrl: string) {
    if (!user || creating) return;
    setCreating(true);
    try {
      const content = {
        type: "doc",
        content: [{ type: "image", attrs: { src: dataUrl } }],
      };
      const id = await createStickyNote(user.uid, "Untitled", content);
      await openStickyNoteWindow(id);
      setStickyNotes(await getStickyNotes(user.uid));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] w-full max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Sticky notes</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex w-fit gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!user || creating}
              onClick={() => void handleCreateNewStickyNote()}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New sticky note
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!user || creating}
              onClick={() => setScreenshotOpen(true)}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              Screenshot
            </Button>
          </div>

          {stickyNotes.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {user ? "No sticky notes yet" : "Sign in to view sticky notes"}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {stickyNotes.map((note) => {
                const preview = extractPlainText(note.content);
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => void handleOpenNote(note)}
                    className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: note.topBarColor ?? "var(--primary)" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {note.title || "Untitled"}
                      </span>
                    </div>
                    {preview ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">{preview}</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                        <StickyNoteIcon className="h-3 w-3" />
                        Empty
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      <ScreenshotCapture
        open={screenshotOpen}
        onOpenChange={setScreenshotOpen}
        onCapture={(dataUrl) => void handleScreenshotCaptured(dataUrl)}
      />
    </Dialog>
  );
}
