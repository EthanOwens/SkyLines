"use client";

import { useEffect } from "react";
import { getNotes } from "@/lib/db/notes";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// SQLite has no change feed, so refetch whenever lib/db/events.ts reports a
// write (local or pulled from Firestore).
export function useNotes(userId: string | undefined) {
  const setNotes = useAppStore((s) => s.setNotes);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getNotes(userId as string).then((notes) => {
        if (!cancelled && myRequestId === requestId) setNotes(notes);
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, setNotes]);
}
