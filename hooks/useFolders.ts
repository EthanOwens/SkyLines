"use client";

import { useEffect } from "react";
import { getFolders } from "@/lib/db/folders";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// Same shape as useNotes, backed by getFolders.
export function useFolders(userId: string | undefined) {
  const setFolders = useAppStore((s) => s.setFolders);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getFolders(userId as string).then((folders) => {
        if (!cancelled && myRequestId === requestId) setFolders(folders);
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, setFolders]);
}
