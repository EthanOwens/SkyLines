"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatReference, parseReference, type Reference } from "./format";
import { resolveReference, type ResolvedReference } from "./resolve";
import { subscribeDataChange } from "@/lib/db/events";
import { STICKY_NOTE_CHANGED_EVENT } from "@/lib/db/stickyNotes";

// One lookup per token, shared by every chip in the window and dropped when
// data changes. Sticky notes are written from other windows, so their Tauri
// event also invalidates; other cross-window edits show on the next mount.
const cache = new Map<string, Promise<ResolvedReference>>();
const listeners = new Set<() => void>();
let version = 0;
let watching = false;

function invalidate() {
  cache.clear();
  version++;
  listeners.forEach((listener) => listener());
}

function watchForChanges() {
  if (watching) return;
  watching = true;
  subscribeDataChange(invalidate);
  import("@tauri-apps/api/event")
    .then(({ listen }) => listen(STICKY_NOTE_CHANGED_EVENT, invalidate))
    .catch(() => {});
}

function subscribe(listener: () => void) {
  watchForChanges();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

function cachedResolve(token: string, ref: Reference): Promise<ResolvedReference> {
  let pending = cache.get(token);
  if (!pending) {
    pending = resolveReference(ref);
    cache.set(token, pending);
    pending.catch(() => {
      if (cache.get(token) === pending) cache.delete(token);
    });
  }
  return pending;
}

/** Undefined until the first lookup finishes. A failed read keeps the last result. */
export function useResolvedReference(ref: Reference | null): ResolvedReference | undefined {
  const currentVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const token = ref ? formatReference(ref) : null;
  const [state, setState] = useState<{ token: string; resolved: ResolvedReference } | null>(null);

  useEffect(() => {
    const parsed = token ? parseReference(token) : null;
    if (!token || !parsed) return;
    let cancelled = false;
    cachedResolve(token, parsed)
      .then((resolved) => {
        if (!cancelled) setState({ token, resolved });
      })
      .catch((error) => console.error("Failed to resolve reference", token, error));
    return () => {
      cancelled = true;
    };
  }, [token, currentVersion]);

  return state && state.token === token ? state.resolved : undefined;
}
