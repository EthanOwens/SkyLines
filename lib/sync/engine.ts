import type { SyncStatus } from "@/types";
import { pushDirtyRows } from "./push";
import { startPullSync, type PullHooks } from "./pull";

// Sync engine: debounced push, online/offline detection, capped-backoff retry
// (with immediate retry on reconnect and app resume), and one observable
// syncStatus. Tombstone cleanup (lib/sync/cleanup.ts) isn't scheduled here.
//
// Tuning constants.
//
// Rapid edits within this window coalesce into one push pass. SQLite already
// saves locally on every edit.
const DEBOUNCE_MS = 10_000;

/**
 * Upper bound on how long continuous edits can delay a push.
 * requestIdleCallback isn't reliable in a Tauri webview, so a max wait stands
 * in for "push when idle", along with flushing when the app goes to the
 * background.
 */
const MAX_WAIT_MS = 15_000;

/**
 * Retry after a real (not offline) failure: 2s, doubling to a 60s cap.
 * Reconnect and app resume skip the wait.
 */
const BASE_BACKOFF_MS = 2_000;
const CAP_BACKOFF_MS = 60_000;

// syncStatus. "saved": idle and the last activity succeeded. "syncing": push or
// pull in flight. "offline": navigator.onLine is false (failures while offline
// count as offline, not error). "error": the last attempt failed while online
// and a retry is scheduled.
//
// Push and pull each have their own retry loop; this merges them into one
// best-effort value for the status badge.

let status: SyncStatus = "saved";
const statusListeners = new Set<(status: SyncStatus) => void>();

function setStatus(next: SyncStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) listener(status);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/** Subscribes to `syncStatus` changes. Returns an unsubscribe function. */
export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

// Connectivity. navigator.onLine reflects the network interface, not whether
// Firestore is reachable: Wi-Fi without internet still reads as online and goes
// through the normal failure/backoff path.
function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

// Push: debounce and backoff.

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let pushBackoffTimer: ReturnType<typeof setTimeout> | null = null;
let pushBackoffMs = BASE_BACKOFF_MS;
let pushInFlight = false;
/** The userId with unflushed dirty work pending, or null if nothing is pending. */
let pendingPushUserId: string | null = null;
/**
 * Incremented by every request for a push. attemptPush compares it before and
 * after pushDirtyRows: a change means an edit arrived mid-push that the push
 * didn't include, so it isn't done. Without this, that request was dropped and
 * status read "saved" while a row was still dirty.
 */
let pushRequestCounter = 0;

function clearScheduledPush(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
}

/**
 * Safe to call on every write: pushDirtyRows re-queries all dirty rows, so
 * calls within DEBOUNCE_MS coalesce.
 */
export function scheduleDirtyPush(userId: string): void {
  pendingPushUserId = userId;
  pushRequestCounter++;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => flushPush(), DEBOUNCE_MS);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => flushPush(), MAX_WAIT_MS);
  }

  if (!isOnline()) {
    // Show offline right away; the push itself still happens when the timer
    // fires or on reconnect.
    setStatus("offline");
  }
}

/** Immediately flushes any debounced/pending push for `userId`, bypassing the remaining debounce/max-wait window. */
export function flushDirtyPush(userId: string): void {
  pendingPushUserId = userId;
  pushRequestCounter++;
  flushPush();
}

function flushPush(): void {
  clearScheduledPush();
  if (!pendingPushUserId) return;
  void attemptPush(pendingPushUserId);
}

function scheduleBackoffRetry(userId: string): void {
  if (pushBackoffTimer) clearTimeout(pushBackoffTimer);
  pushBackoffTimer = setTimeout(() => {
    pushBackoffTimer = null;
    void attemptPush(userId);
  }, pushBackoffMs);
  pushBackoffMs = Math.min(pushBackoffMs * 2, CAP_BACKOFF_MS);
}

/**
 * Checks offline first and never calls pushDirtyRows then: Firestore's write
 * queue can leave setDoc pending indefinitely offline, which would keep the
 * status on "syncing". pendingPushUserId stays set so reconnect retries.
 */
async function attemptPush(userId: string): Promise<void> {
  if (pushBackoffTimer) {
    clearTimeout(pushBackoffTimer);
    pushBackoffTimer = null;
  }

  if (!isOnline()) {
    setStatus("offline");
    return;
  }

  if (pushInFlight) {
    // The running push re-queries dirty rows, so there's nothing to do now. A
    // row dirtied after its query is caught by the pushRequestCounter check
    // when it finishes.
    return;
  }

  const servicedRequest = pushRequestCounter;
  pushInFlight = true;
  setStatus("syncing");
  let needsFollowUp = false;
  try {
    await pushDirtyRows(userId);
    pushBackoffMs = BASE_BACKOFF_MS;
    if (pushRequestCounter === servicedRequest) {
      // No new request during the push, so everything dirty has been pushed.
      pendingPushUserId = null;
      setStatus(isOnline() ? "saved" : "offline");
    } else {
      // An edit arrived mid-push and wasn't included: don't report "saved".
      // Flag a follow-up push rather than calling attemptPush here, because
      // pushInFlight is still true until finally runs and the call would be
      // ignored.
      needsFollowUp = true;
      setStatus(isOnline() ? "syncing" : "offline");
    }
  } catch (err) {
    console.error("[sync/engine] push failed, scheduling backoff retry", err);
    setStatus(isOnline() ? "error" : "offline");
    scheduleBackoffRetry(userId);
  } finally {
    pushInFlight = false;
    if (needsFollowUp) {
      void attemptPush(userId);
    }
  }
}

// Pull: resubscribe and back off after a fatal listener error.

let pullUnsubscribe: (() => void) | null = null;
let pullBackoffTimer: ReturnType<typeof setTimeout> | null = null;
let pullBackoffMs = BASE_BACKOFF_MS;
let activePullUserId: string | null = null;

function pullHooksFor(): PullHooks {
  // Whether the current batch had an apply error. onIdle always runs after
  // onApplyError for the same batch and would otherwise reset "error" to
  // "saved". Reset in onActivity, which runs before each batch is applied.
  let hadApplyErrorThisBatch = false;

  return {
    onActivity: () => {
      hadApplyErrorThisBatch = false;
      setStatus("syncing");
    },
    onIdle: () => {
      if (hadApplyErrorThisBatch) {
        // Keep "error": a failed apply isn't retried automatically (only a dead
        // listener is resubscribed).
        return;
      }
      // Pull went quiet without a fatal error, so Firestore is reachable: reset
      // pull's backoff.
      pullBackoffMs = BASE_BACKOFF_MS;
      if (!pushInFlight && !pendingPushUserId && isOnline()) setStatus("saved");
    },
    onApplyError: () => {
      // The listener is still alive after a failed apply, so just report it.
      hadApplyErrorThisBatch = true;
      setStatus(isOnline() ? "error" : "offline");
    },
    onListenError: (err) => {
      // Firestore doesn't retry a fatal listen error, so resubscribe with
      // backoff.
      setStatus(isOnline() ? "error" : "offline");
      if (activePullUserId) schedulePullRetry(activePullUserId, err);
    },
  };
}

function schedulePullRetry(userId: string, err: unknown): void {
  console.error("[sync/engine] pull listener failed, scheduling resubscribe", err);
  if (pullBackoffTimer) clearTimeout(pullBackoffTimer);
  pullBackoffTimer = setTimeout(() => {
    pullBackoffTimer = null;
    startOrRestartPull(userId);
  }, pullBackoffMs);
  pullBackoffMs = Math.min(pullBackoffMs * 2, CAP_BACKOFF_MS);
}

function startOrRestartPull(userId: string): void {
  activePullUserId = userId;
  pullUnsubscribe?.();
  pullUnsubscribe = startPullSync(userId, pullHooksFor());
}

// Reconnect and app resume: retry pending push and pull work immediately,
// skipping any remaining debounce or backoff.
function retryPendingWork(): void {
  if (!isOnline()) {
    setStatus("offline");
    return;
  }

  if (pendingPushUserId) {
    if (pushBackoffTimer) {
      clearTimeout(pushBackoffTimer);
      pushBackoffTimer = null;
    }
    clearScheduledPush();
    void attemptPush(pendingPushUserId);
  } else {
    setStatus("saved");
  }

  if (activePullUserId && pullBackoffTimer) {
    clearTimeout(pullBackoffTimer);
    pullBackoffTimer = null;
    startOrRestartPull(activePullUserId);
  }
}

function handleOnline(): void {
  retryPendingWork();
}

function handleOffline(): void {
  setStatus("offline");
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") {
    // App back in the foreground: retry now rather than waiting out a timer.
    retryPendingWork();
  } else if (pendingPushUserId && !pushInFlight) {
    // App going to the background: flush the pending push now.
    flushPush();
  }
}

// Lifecycle.
//
// Starts pull listeners, connectivity and resume listeners, and pushes anything
// already dirty. Returns a teardown function.
//
// Engine state is module-level, so each start records a generation and its
// teardown only acts if that generation is still current. A late cleanup from
// an old React effect is then a no-op instead of stopping the live engine.
let generation = 0;

export function startSyncEngine(userId: string): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("startSyncEngine must be called in a browser/webview context");
  }

  const myGeneration = ++generation;
  setStatus("saved"); // fresh session, don't inherit a stale status from a prior sign-in/out cycle

  startOrRestartPull(userId);

  pendingPushUserId = userId;
  pushRequestCounter++;
  void attemptPush(userId);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  if (!isOnline()) setStatus("offline");

  return () => {
    if (myGeneration !== generation) {
      // A newer startSyncEngine has taken over; tearing down now would stop it.
      return;
    }

    pullUnsubscribe?.();
    pullUnsubscribe = null;
    activePullUserId = null;

    clearScheduledPush();
    if (pushBackoffTimer) {
      clearTimeout(pushBackoffTimer);
      pushBackoffTimer = null;
    }
    if (pullBackoffTimer) {
      clearTimeout(pullBackoffTimer);
      pullBackoffTimer = null;
    }
    pendingPushUserId = null;
    pushBackoffMs = BASE_BACKOFF_MS;
    pullBackoffMs = BASE_BACKOFF_MS;
    setStatus("saved"); // reset before this engine instance's state is torn down, so the next session (if any) starts clean too

    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
