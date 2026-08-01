"use client";

import { useEffect } from "react";
import { getNotebooks } from "@/lib/db/notebooks";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// Mirrors hooks/useFolders.ts exactly (spec.md subtask 4, "Root app shell"),
// including its request-id race guard: without it, an in-flight refetch
// triggered by an earlier data-change event could resolve AFTER a later one
// and clobber the store with stale notebooks. Backed by lib/db/notebooks.ts's
// `getNotebooks` instead of lib/db/folders.ts's `getFolders`.
export function useNotebooks(userId: string | undefined) {
  const setNotebooks = useAppStore((s) => s.setNotebooks);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getNotebooks(userId as string).then((notebooks) => {
        if (!cancelled && myRequestId === requestId) setNotebooks(notebooks);
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, setNotebooks]);
}
