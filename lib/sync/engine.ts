import type { SyncStatus } from "@/types";
import { pushDirtyRows } from "./push";
import { startPullSync, type PullHooks } from "./pull";

// Sync engine (spec.md subtask 14, M3 "real offline/retry + syncStatus").
// Ties push.ts/pull.ts together into an actually-running engine with:
//   - debounced push (local writes already feel instant via SQLite -
//     lib/db/folders.ts/notes.ts - so Firestore no longer needs to)
//   - real online/offline detection (makes the previously-dead "offline"
//     SyncStatus real, per spec.md's "Key Decisions")
//   - capped-backoff retry on genuine push/pull failure, with immediate
//     retry on reconnect and on app resume (visibilitychange)
//   - a single observable `syncStatus`, exposed via a tiny dependency-free
//     subscribe/notify mechanism (no store library is installed yet - see
//     spec.md subtask 15, which will eventually consume this from
//     stores/appStore.ts)
//
// lib/sync/cleanup.ts's tombstone cleanup is deliberately NOT scheduled
// here - subtask 14's text only calls out push/pull/offline/retry/
// syncStatus, and cleanup is an unrelated low-frequency maintenance pass
// with its own (much longer) natural cadence. Scheduling it is out of
// scope for this subtask.
//
// `startSyncEngine`/teardown mirror lib/sync/pull.ts's `startPullSync`
// pattern (a start function returning its own teardown) rather than a
// class, for consistency with the rest of this sync layer. Nothing here is
// wired to real app lifecycle yet (no auth/UI exists) - that's spec.md
// subtask 15's job; this subtask just has to expose functions that
// subtask 15 (and this subtask's own verification harness) can call
// directly.

// --- Tuning constants -------------------------------------------------

/**
 * Debounce window for `scheduleDirtyPush`: repeated calls within this many
 * ms of each other coalesce into a single push pass. 10s, the midpoint of
 * spec.md's suggested 5-15s range - long enough that a burst of rapid edits
 * (e.g. fast typing, which already autosaves to SQLite far more often than
 * this) collapses into one Firestore write pass, short enough that a
 * change is never left unsynced for an alarming amount of time even if the
 * user then walks away mid-burst.
 */
const DEBOUNCE_MS = 10_000;

/**
 * Hard upper bound on how long a continuous burst of edits (each one
 * resetting the debounce timer above) can delay a push pass. Without this,
 * someone typing continuously for minutes would never get a single byte
 * pushed to Firestore until they stopped. This is this module's answer to
 * spec.md's "or on idle" alternative: true idle detection
 * (`requestIdleCallback`) isn't reliably available/meaningful inside a
 * Tauri webview, so instead of waiting for genuine idle, a bounded max-wait
 * on top of the trailing debounce guarantees eventual, regular flushing
 * during sustained activity - 15s, the upper end of spec.md's 5-15s range.
 * (`visibilitychange` -> hidden, below, is the other half of "flush on
 * idle": treat the app losing foreground focus as a good opportunity to
 * flush immediately rather than waiting out either timer.)
 */
const MAX_WAIT_MS = 15_000;

/**
 * Capped-exponential backoff for retrying a genuinely failed push/pull
 * (i.e. failed for a reason other than "we're offline" - see `isOnline()`
 * below and the `syncStatus` state machine doc comment). Starts at 2s -
 * fast enough that a transient/self-correcting failure (e.g. a momentary
 * Firestore hiccup) recovers almost unnoticed - and doubles up to a 60s
 * cap, so a persistent failure (e.g. a real permission/config problem)
 * settles into checking about once a minute instead of hammering Firestore
 * or burning battery on a tight retry loop. Reconnect/app-resume (below)
 * bypass this timer entirely for an immediate retry, so the cap only
 * governs the "still failing, nothing else has told us to try again yet"
 * case.
 */
const BASE_BACKOFF_MS = 2_000;
const CAP_BACKOFF_MS = 60_000;

// --- syncStatus: tiny dependency-free observable ------------------------
//
// `"saved"` - idle, nothing pending, last push/pull activity succeeded.
// `"syncing"` - a push and/or pull is actively in flight right now.
// `"offline"` - the browser/webview reports no network connectivity
//   (`navigator.onLine === false`). Takes priority in the sense that
//   failures encountered while offline are attributed to this, not
//   `"error"` - see `isOnline()` and every catch block below.
// `"error"` - the last push or pull attempt failed for a reason other than
//   being offline, and a capped-backoff retry is scheduled/in-flight.
//
// This is a simplified best-effort combination of two logically-separate
// activities (push and pull each have their own retry loop below) into one
// status value, rather than a fully faithful merge of two independent
// state machines - acceptable here since a future UI badge (spec.md
// subtask 20) only needs one status to show at a time, and push is the
// dominant user-visible activity (pull is background reconciliation of
// data the UI doesn't read from directly yet - see spec.md subtask 15).

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

// --- connectivity ---------------------------------------------------------

/**
 * `navigator.onLine`/the `online`/`offline` window events reflect the OS's
 * network *interface* state (e.g. "Wi-Fi is connected"), not genuine
 * end-to-end reachability of Firestore - a known, unsolved limitation
 * (per SPEC_iter1.md Part 2 "Offline/retry") rather than a bug in this
 * file. A device connected to a Wi-Fi network with no real internet access
 * still reports `onLine === true` here; that case falls through to the
 * ordinary failure/backoff path below instead of the offline path, which
 * is the best this API can do.
 */
function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

// --- push: debounce + backoff -------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let pushBackoffTimer: ReturnType<typeof setTimeout> | null = null;
let pushBackoffMs = BASE_BACKOFF_MS;
let pushInFlight = false;
/** The userId with unflushed dirty work pending, or null if nothing is pending. */
let pendingPushUserId: string | null = null;
/**
 * Bumped by every `scheduleDirtyPush`/`flushDirtyPush`/engine-start call that
 * represents "there is dirty work that needs a push." `attemptPush` captures
 * this value when it starts reading dirty rows and compares it again once
 * `pushDirtyRows` resolves - if it changed in between, a newer edit arrived
 * mid-push that `pushDirtyRows` (which only sees rows dirty at query time)
 * did NOT include, so the push isn't actually done yet. Without this, a push
 * request that arrives while another is already in flight gets silently
 * dropped by the `pushInFlight` early-return below, `pendingPushUserId` gets
 * unconditionally cleared by the in-flight push once it resolves, and
 * `syncStatus` falsely reports "saved" while a row is still dirty in SQLite.
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
 * Schedules a debounced push pass for `userId`. Safe to call on every local
 * dirty write (create/update/delete) - repeated calls within `DEBOUNCE_MS`
 * of each other coalesce into a single underlying `pushDirtyRows` call,
 * since that call re-queries every currently-dirty row at push time rather
 * than pushing a specific row this call was "for".
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
    // Don't wait for the debounce window just to discover we're offline -
    // reflect that immediately. The actual push attempt still happens once
    // the timer fires (or `retryPendingWork` runs on reconnect), and
    // `attemptPush` re-checks connectivity itself either way.
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
 * Runs one push attempt "for real" (not debounced - callers are
 * `flushPush`, the backoff retry timer, and reconnect/resume handling).
 * Offline is checked first and short-circuits without ever calling
 * `pushDirtyRows` at all: Firestore's own write queue can leave a `setDoc`
 * promise hanging indefinitely while offline rather than rejecting it
 * (it's designed to transparently resume once reconnected), which would
 * otherwise leave `syncStatus` stuck on `"syncing"` instead of accurately
 * reporting `"offline"`. `pendingPushUserId` is left set in that case so
 * the `online` handler below retries automatically once connectivity
 * returns - nothing is lost, everything is still safely `dirty` in SQLite.
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
    // A push is already running and will pick up every currently-dirty row
    // (pushDirtyRows re-queries at call time) - nothing more to do this
    // call. `pendingPushUserId` stays set in case a row becomes dirty after
    // the in-flight call has already read the dirty set; the "did a newer
    // request arrive mid-push" check below (via `pushRequestCounter`) is
    // what actually catches that case once the in-flight call resolves,
    // rather than silently dropping this request.
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
      // No newer schedule/flush request arrived while this push was
      // running - every row that was dirty is now pushed, fully caught up.
      pendingPushUserId = null;
      setStatus(isOnline() ? "saved" : "offline");
    } else {
      // A newer edit arrived while `pushDirtyRows` was already running, so
      // it wasn't included in what was just pushed (pushDirtyRows only sees
      // rows dirty at query time). Don't clear `pendingPushUserId` or
      // report "saved" - that row is still dirty in SQLite. Flag a
      // follow-up push instead of waiting on a lucky future
      // online/visibilitychange event - but don't call `attemptPush`
      // recursively HERE: `pushInFlight` is still `true` until the `finally`
      // block below runs, so a recursive call at this point would
      // immediately hit the `pushInFlight` guard above and silently no-op.
      // Deferring the follow-up call to after `pushInFlight` is reset is
      // what actually fixes that.
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

// --- pull: resubscribe + backoff on a fatal listener error ---------------

let pullUnsubscribe: (() => void) | null = null;
let pullBackoffTimer: ReturnType<typeof setTimeout> | null = null;
let pullBackoffMs = BASE_BACKOFF_MS;
let activePullUserId: string | null = null;

function pullHooksFor(): PullHooks {
  // Tracks whether the snapshot batch currently in flight had a per-doc
  // apply error. `onIdle` fires from pull.ts's `.finally()` unconditionally
  // - regardless of whether the paired `.catch()` (`onApplyError`) already
  // ran for this same batch - so without this flag, `onIdle` would
  // immediately clobber the "error" status `onApplyError` just set back to
  // "saved" (if push happens to be idle too), erasing a genuine apply
  // failure within the same tick with no retry ever having happened (only
  // `onListenError`/a dead listener gets a resubscribe). Reset in
  // `onActivity`, which fires once per snapshot that has changes, before
  // that same snapshot's `.then()`/`.catch()`/`.finally()` run in pull.ts -
  // so this closure-scoped flag correctly reflects just the batch that's
  // about to be applied.
  let hadApplyErrorThisBatch = false;

  return {
    onActivity: () => {
      hadApplyErrorThisBatch = false;
      setStatus("syncing");
    },
    onIdle: () => {
      if (hadApplyErrorThisBatch) {
        // Don't clobber the "error" status this same batch just set via
        // onApplyError - a doc failed to apply and there's no automatic
        // retry for that (only a dead listener, via onListenError, gets
        // resubscribed). Leave status as "error" until a future successful
        // batch (or manual retry) clears it.
        return;
      }
      // Pull went quiet without a fatal error - connectivity to Firestore
      // is evidently fine, so reset pull's own backoff too (independent of
      // push's).
      pullBackoffMs = BASE_BACKOFF_MS;
      if (!pushInFlight && !pendingPushUserId && isOnline()) setStatus("saved");
    },
    onApplyError: () => {
      // One doc failed to apply; the listener is still alive per
      // lib/sync/pull.ts's own design (a bad change doesn't stall it) - no
      // resubscribe/backoff needed, just surface the failure.
      hadApplyErrorThisBatch = true;
      setStatus(isOnline() ? "error" : "offline");
    },
    onListenError: (err) => {
      // The listener itself died - Firestore does not auto-retry a fatal
      // listen error, so this side needs its own capped-backoff resubscribe
      // loop, mirroring the push side's.
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

// --- reconnect / app-resume: immediate retry ------------------------------

/**
 * Retries any pending/failed push and pull work immediately, bypassing
 * whatever's left of the debounce window or backoff timer. Called on the
 * `online` window event and on the app regaining foreground focus
 * (`visibilitychange` -> visible) - both are treated the same way, per
 * spec.md subtask 14's "immediate retry on reconnect/app-resume".
 */
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
    // App resumed foreground - same reasoning as reconnect: don't make the
    // user wait out a backoff/debounce window they weren't even watching.
    retryPendingWork();
  } else if (pendingPushUserId && !pushInFlight) {
    // App is going to the background - this module's "or on idle" flush
    // heuristic (see MAX_WAIT_MS above): treat losing foreground focus as
    // a good moment to flush a pending debounced push now rather than
    // possibly waiting up to MAX_WAIT_MS more while nobody's looking.
    flushPush();
  }
}

// --- lifecycle -------------------------------------------------------------

/**
 * Starts the sync engine for `userId`: subscribes to Firestore pull
 * listeners, wires online/offline + app-resume listeners, and attempts an
 * immediate push of anything already dirty (e.g. edits made in an earlier,
 * fully offline session before the engine was running). Returns a teardown
 * function, mirroring lib/sync/pull.ts's `startPullSync`.
 *
 * Not wired to real app lifecycle yet (spec.md subtask 15's job, once
 * auth/hooks exist) - callers today are this subtask's verification
 * harness and, later, that rewire.
 */
/**
 * All engine state above is module-level (a singleton), not per-call - so
 * the teardown closure `startSyncEngine` returns has no identity of its own.
 * Without this counter, calling a STALE teardown (e.g. from a React effect
 * whose cleanup ran late, after a newer effect already called
 * `startSyncEngine` again for a different/same user) would tear down
 * whatever engine is CURRENTLY active rather than being a safe no-op -
 * ripping listeners out from under live work. Each `startSyncEngine` call
 * captures the generation it was started at; its teardown only acts if that
 * generation is still the current one.
 */
let generation = 0;

export function startSyncEngine(userId: string): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("startSyncEngine must be called in a browser/webview context");
  }

  const myGeneration = ++generation;

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
      // A newer startSyncEngine call has already taken over the module-level
      // state - this teardown is stale. Acting on it now would tear down
      // that newer, still-live engine instead of being a safe no-op.
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

    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
