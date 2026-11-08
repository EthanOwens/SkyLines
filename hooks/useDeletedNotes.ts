"use client";

import { useEffect, useState } from "react";
import { getDeletedNotes } from "@/lib/db/notes";
import { subscribeDataChange } from "@/lib/db/events";
import { HISTORY_RETENTION_MS } from "@/lib/sync/cleanup";
import type { Note } from "@/types";

/** Notes deleted within the retention window, kept fresh like useNotes. */
export function useDeletedNotes(userId: string | undefined): Note[] {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getDeletedNotes(userId as string, Date.now() - HISTORY_RETENTION_MS).then((rows) => {
        if (!cancelled && myRequestId === requestId) setNotes(rows);
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return userId ? notes : [];
}
