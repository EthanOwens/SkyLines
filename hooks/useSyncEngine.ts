"use client";

import { useEffect } from "react";
import {
  getSyncFailures,
  getSyncStatus,
  scheduleDirtyPush,
  startSyncEngine,
  subscribeSyncFailures,
  subscribeSyncStatus,
} from "@/lib/sync/engine";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// Ties the sync engine to the signed-in user.
//
// 1. Starts and stops the engine with the user id, and mirrors its status into
// the store.
//
// 2. Turns local SQLite writes into scheduled pushes. lib/db can't call the
// engine itself without a circular import, so this listens to lib/db/events.ts
// instead. Only "local" changes are pushed; "remote" changes (pulled rows,
// tombstone cleanup) already match Firestore, and pushing them would loop.
export function useSyncEngine(userId: string | undefined) {
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setSyncFailures = useAppStore((s) => s.setSyncFailures);

  useEffect(() => {
    if (!userId) return;

    setSyncStatus(getSyncStatus());
    const unsubscribeStatus = subscribeSyncStatus(setSyncStatus);
    setSyncFailures(getSyncFailures());
    const unsubscribeFailures = subscribeSyncFailures(setSyncFailures);
    const stopEngine = startSyncEngine(userId);
    const unsubscribeDataChange = subscribeDataChange((origin) => {
      if (origin === "local") scheduleDirtyPush(userId);
    });

    return () => {
      unsubscribeDataChange();
      unsubscribeStatus();
      unsubscribeFailures();
      stopEngine();
    };
  }, [userId, setSyncStatus, setSyncFailures]);
}
