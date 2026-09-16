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

import { useRef, useState, useEffect } from "react";
import {
  Camera,
  Plus,
  Pencil,
  Trash2,
  Star,
  ExternalLink,
  StickyNote as StickyNoteIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useAuthContext } from "@/components/AuthProvider";
import {
  getStickyNotes,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
} from "@/lib/db/stickyNotes";
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
  const [openNoteIds, setOpenNoteIds] = useState<Set<string>>(new Set());

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

    // lib/stickyWindow.ts labels pop-out windows "sticky-<id>" - reuse that
    // convention here to figure out which notes currently have a live window.
    void import("@tauri-apps/api/window").then(async ({ getAllWindows }) => {
      const windows = await getAllWindows();
      const ids = windows
        .filter((w) => w.label.startsWith("sticky-"))
        .map((w) => w.label.slice("sticky-".length));
      setOpenNoteIds(new Set(ids));
    });
  }, [open, user]);

  async function handleOpenNote(note: StickyNote) {
    await openStickyNoteWindow(note.id);
  }

  async function handleRenameNote(id: string, title: string) {
    setStickyNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    await updateStickyNote(id, { title });
  }

  async function handleDeleteNote(id: string) {
    setStickyNotes((prev) => prev.filter((n) => n.id !== id));
    await deleteStickyNote(id);
  }

  async function handleToggleFavorite(note: StickyNote) {
    const favorite = !note.favorite;
    setStickyNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, favorite } : n)));
    await updateStickyNote(note.id, { favorite });
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
            <>
              {stickyNotes.some((n) => n.favorite) && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Favorites</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {stickyNotes
                      .filter((n) => n.favorite)
                      .map((note) => (
                        <StickyNoteCard
                          key={note.id}
                          note={note}
                          isOpen={openNoteIds.has(note.id)}
                          onOpen={() => void handleOpenNote(note)}
                          onRename={(title) => void handleRenameNote(note.id, title)}
                          onDelete={() => void handleDeleteNote(note.id)}
                          onToggleFavorite={() => void handleToggleFavorite(note)}
                        />
                      ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stickyNotes.map((note) => (
                  <StickyNoteCard
                    key={note.id}
                    note={note}
                    isOpen={openNoteIds.has(note.id)}
                    onOpen={() => void handleOpenNote(note)}
                    onRename={(title) => void handleRenameNote(note.id, title)}
                    onDelete={() => void handleDeleteNote(note.id)}
                    onToggleFavorite={() => void handleToggleFavorite(note)}
                  />
                ))}
              </div>
            </>
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

interface StickyNoteCardProps {
  note: StickyNote;
  isOpen: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

// Right-click menu mirrors components/sidebar/NoteItem.tsx's ContextMenu/
// DropdownMenuContent reuse pattern (spec.md M4 subtask 8).
function StickyNoteCard({ note, isOpen, onOpen, onRename, onDelete, onToggleFavorite }: StickyNoteCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(note.title || "Untitled");
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = extractPlainText(note.content);

  // Resyncs when the sibling card (favorites section vs. main grid) renames
  // this same note - not depended on `renaming` so it can't clobber an
  // in-progress edit (see PageItem.tsx's identical effect).
  useEffect(() => {
    if (!renaming) setTitle(note.title || "Untitled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.title]);

  function startRename() {
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 10);
  }

  function commitRename() {
    setRenaming(false);
    const trimmed = title.trim() || "Untitled";
    setTitle(trimmed);
    if (trimmed !== note.title) onRename(trimmed);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className="relative flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!renaming) onOpen();
            }}
            onKeyDown={(e) => {
              if (renaming) return;
              if (e.key === "Enter" || e.key === " ") {
                if (e.key === " ") e.preventDefault();
                onOpen();
              }
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: note.topBarColor ?? "var(--primary)" }}
              />
              {renaming ? (
                <input
                  ref={inputRef}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setTitle(note.title);
                      setRenaming(false);
                    }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {title || "Untitled"}
                </span>
              )}
            </div>
            {preview ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">{preview}</span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                <StickyNoteIcon className="h-3 w-3" />
                Empty
              </span>
            )}
            {(note.favorite || isOpen) && (
              <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                {note.favorite && <Star className="h-3 w-3 fill-current text-muted-foreground" />}
                {isOpen && (
                  <button
                    type="button"
                    title="Currently open - click to focus"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen();
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        }
      />
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleFavorite}>
          <Star className={`mr-2 h-4 w-4 ${note.favorite ? "fill-current" : ""}`} />
          {note.favorite ? "Unfavorite" : "Favorite"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </ContextMenu>
  );
}
