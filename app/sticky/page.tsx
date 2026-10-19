"use client";

// Loaded only in a sticky note's own window (see lib/stickyWindow.ts), outside
// the app shell.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getStickyNoteById } from "@/lib/db/stickyNotes";
import { StickyNoteEditor } from "@/components/editor/StickyNoteEditor";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { StickyNote } from "@/types";

// Sticky windows have no OS frame, so without this bar a window whose note is
// missing could be neither moved nor closed.
function StickyMessageScreen({ message }: { message: string }) {
  const windowDrag = useWindowDrag();

  async function handleClose() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <div
        {...windowDrag}
        className="flex h-8 shrink-0 items-center justify-end px-1"
        style={{ background: "var(--primary)" }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-primary-foreground hover:bg-black/10 hover:text-primary-foreground"
                onClick={handleClose}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">{message}</div>
    </div>
  );
}

function StickyPageInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<StickyNote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getStickyNoteById(id)
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch(() => {
        if (!cancelled) setNote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) {
    return <StickyMessageScreen message="No sticky note selected." />;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!note) {
    return <StickyMessageScreen message="Sticky note not found." />;
  }

  return <StickyNoteEditor key={note.id} note={note} />;
}

export default function StickyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <StickyPageInner />
    </Suspense>
  );
}
