"use client";

import { useEffect } from "react";
import { getSyncStatus, scheduleDirtyPush, startSyncEngine, subscribeSyncStatus } from "@/lib/sync/engine";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

// New hook (spec.md subtask 15, M4 "auth + data hooks rewire") wiring
// lib/sync/engine.ts into real app lifecycle - the thing subtask 14
// explicitly deferred ("Not wired to real app lifecycle yet... that's
// spec.md subtask 15's job, once auth/hooks exist").
//
// Deliberately a standalone hook rather than logic added inside
// components/AuthProvider.tsx: subtask 15's text says to port
// AuthProvider/useAuth UNCHANGED (no SQLite/sync coupling), so engine
// start/stop lives here instead, meant to be called "alongside"
// `useAuthContext()`/`useAuth()` once a UI layer exists to call it (subtask
// 16's app shell) - e.g. `const { user } = useAuthContext(); useSyncEngine
// (user?.uid);`. This also keeps engine-start logic in exactly one place,
// per the subtask text's explicit instruction not to duplicate it.
//
// Two responsibilities, both scoped to the same userId-keyed effect so they
// share one lifecycle:
//
//  1. Start/stop the engine (lib/sync/engine.ts's `startSyncEngine`) when a
//     user becomes known/unknown, and mirror its `syncStatus` into
//     stores/appStore.ts (subtask 15 step 6) via `subscribeSyncStatus`.
//
//  2. Turn local SQLite writes into scheduled Firestore pushes (subtask 15
//     step 7): lib/db/folders.ts/notes.ts have no way to call
//     `scheduleDirtyPush` themselves without creating a circular import
//     (lib/sync/engine.ts already imports lib/sync/push.ts/pull.ts, which
//     import lib/db/folders.ts/notes.ts - see lib/db/events.ts's header
//     comment for the full reasoning). Instead, this hook subscribes to
//     lib/db/events.ts's change notification and calls `scheduleDirtyPush`
//     ONLY for `origin === "local"` changes (a genuine local
//     create/update/delete). Changes tagged `"remote"` - pull sync's own
//     `upsertFolderFromRemote`/`upsertNoteFromRemote` writes, and tombstone
//     cleanup's `hardDeleteFolder`/`hardDeleteNote` - are explicitly
//     excluded: those rows already match Firestore (or are already gone),
//     so scheduling a push for them would just be pulling a remote change
//     back out at Firestore, a redundant push-loop this distinction exists
//     specifically to avoid.
export function useSyncEngine(userId: string | undefined) {
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);

  useEffect(() => {
    if (!userId) return;

    setSyncStatus(getSyncStatus());
    const unsubscribeStatus = subscribeSyncStatus(setSyncStatus);
    const stopEngine = startSyncEngine(userId);
    const unsubscribeDataChange = subscribeDataChange((origin) => {
      if (origin === "local") scheduleDirtyPush(userId);
    });

    return () => {
      unsubscribeDataChange();
      unsubscribeStatus();
      stopEngine();
    };
  }, [userId, setSyncStatus]);
}
