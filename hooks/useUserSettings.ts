"use client";

import { useCallback, useEffect } from "react";
import { getUserSettings, updateUserSettings, type UserSettingsValues } from "@/lib/db/userSettings";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";

/**
 * Keeps the store's userSettings in step with SQLite (local writes and pulls
 * both notify). Mounted once, next to the other data hooks.
 */
export function useLoadUserSettings(userId: string | undefined) {
  const setUserSettings = useAppStore((s) => s.setUserSettings);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let requestId = 0;

    function refetch() {
      const myRequestId = ++requestId;
      void getUserSettings(userId as string).then((settings) => {
        if (!cancelled && myRequestId === requestId) setUserSettings(settings);
      });
    }

    refetch();
    const unsubscribe = subscribeDataChange(() => refetch());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, setUserSettings]);
}

/**
 * The signed-in user's settings (defaults until loaded) and a setter. The write
 * is tagged local, so useSyncEngine schedules the push.
 */
export function useUserSettings(userId: string | undefined) {
  const settings = useAppStore((s) => s.userSettings);
  const setUserSettings = useAppStore((s) => s.setUserSettings);

  const update = useCallback(
    async (partial: Partial<UserSettingsValues>) => {
      if (!userId) return;
      // Optimistic, so a switch moves immediately; the refetch after the write
      // replaces it with the stored row.
      const current = useAppStore.getState().userSettings;
      if (current && current.userId === userId) setUserSettings({ ...current, ...partial });
      await updateUserSettings(userId, partial);
    },
    [userId, setUserSettings],
  );

  const active = settings && settings.userId === userId ? settings : null;
  return {
    autoColor: active?.autoColor ?? true,
    colorBookend: active?.colorBookend ?? true,
    colorHighlight: active?.colorHighlight ?? false,
    loaded: active !== null,
    update,
  };
}
