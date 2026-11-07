"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createNote } from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import { autoColorForNewNote } from "@/lib/colors/autoColor";
import { nextOrderValue } from "@/lib/dnd/sidebar";
import { useAppStore } from "@/stores/appStore";

export function useCreateNote(uid: string) {
  const router = useRouter();
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const notes = useAppStore((s) => s.notes);
  const [creating, setCreating] = useState(false);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      // Fall back to the default notebook only when none is open.
      const notebookId = selectedNotebookId ?? (await getOrCreateDefaultNotebookId(uid));
      // Create inside the selected folder if there is one, and append after the
      // existing items instead of the default order 0.
      const siblingNoteOrders = notes
        .filter((n) => n.folderId === (selectedFolderId ?? null) && n.notebookId === notebookId)
        .map((n) => n.order);
      const auto = await autoColorForNewNote(uid, notebookId);
      const id = await createNote(
        uid,
        "canvas",
        notebookId,
        selectedFolderId ?? undefined,
        undefined,
        nextOrderValue(siblingNoteOrders),
        auto.color,
        auto.firstPageColor,
      );
      router.push(`/canvas?id=${id}`);
    } finally {
      setCreating(false);
    }
  }

  return { create, creating };
}
