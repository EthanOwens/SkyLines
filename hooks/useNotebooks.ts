"use client";

import { useEffect } from "react";
import { getNotebooks } from "@/lib/db/notebooks";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// Same shape as useFolders, including the request-id guard that stops an older
// refetch from overwriting a newer result.
export function useNotebooks(userId: string | undefined) {
  const setNotebooks = useAppStore((s) => s.setNotebooks);
  const setNotebooksLoaded = useAppStore((s) => s.setNotebooksLoaded);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getNotebooks(userId as string).then((notebooks) => {
        if (!cancelled && myRequestId === requestId) {
          setNotebooks(notebooks);
          // Only ever flips to true, so later refetches don't bring back the
          // loading state.
          setNotebooksLoaded(true);
        }
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, setNotebooks, setNotebooksLoaded]);
}
