"use client";

import { useEffect } from "react";
import { getNotes } from "@/lib/db/notes";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// Rewired from ../note_taking_app/hooks/useNotes.ts (spec.md subtask 15) to
// read from the SQLite layer (lib/db/notes.ts, subtask 9) instead of
// Firestore's `subscribeNotes`/`onSnapshot`. SQLite has no realtime push
// model of its own, so this mirrors the original hook's
// "subscribe once, keep the store updated, clean up on unmount" shape using
// lib/db/events.ts's change-notification instead: fetch on mount/userId
// change, then re-fetch every time ANY folders/notes write lands (local
// edit or a remote pull-sync upsert) rather than receiving pushed diffs.
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
