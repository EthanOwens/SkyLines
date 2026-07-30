// M5 (spec.md subtask 21): Google sign-in via system-browser + deep-link,
// replacing `signInWithPopup`/`signInWithRedirect`. Google's OAuth actively
// blocks sign-in attempts from embedded/non-standard webviews (the
// "disallowed_useragent" / "This browser or app may not be secure" policy).
// That policy applies to `signInWithRedirect` run inside a Tauri webview
// just as much as `signInWithPopup`, since both keep the user inside the
// embedded WebView2 context Google's policy targets - only the OS's actual
// default browser (which Google trusts) reliably works. This matches
// ../note_taking_app/SPEC_iter1.md's primary recommendation.
//
// Flow chosen: OAuth 2.0 **implicit flow** requesting an `id_token`
// (`response_type=id_token`), NOT PKCE. Reasoning (per spec.md subtask 21):
// PKCE's authorization-code step would still need a *token exchange* call
// to Google's token endpoint, and this project only has access to the
// Firebase-auto-generated "Web application" OAuth client (see below) -
// exchanging a code for tokens with that client type requires a client
// secret, which does not belong in a distributed desktop app and which
// isn't available in this environment anyway. The implicit flow instead
// returns the `id_token` directly in the redirect URI's fragment, with no
// server-side exchange step and no secret required - Firebase's
// `signInWithCredential` only needs that id_token.
//
// *** EXTERNAL BLOCKER - Google Cloud Console configuration required ***
// The OAuth client ID below is the one Firebase auto-provisions for this
// project's Google sign-in ("Web application" type), discovered via
// Firebase's own `accounts:createAuthUri` identitytoolkit endpoint (the
// same lookup `signInWithPopup`/`signInWithRedirect` perform internally) -
// it is NOT fabricated. However, it was verified (via a direct request to
// Google's authorization endpoint with this redirect_uri) that Google's
// OAuth server unconditionally REJECTS a custom URI scheme redirect_uri
// (`skylines://auth-callback`) for "Web application"-type clients, before
// even consulting any configured redirect URI allowlist:
//
//   "You can't sign in to this app because it doesn't comply with
//    Google's OAuth 2.0 policy for keeping apps secure."
//    (authError reason: invalid_request, offending redirect_uri echoed
//    back as `skylines://auth-callback`)
//
// This is a hard client-type restriction, not a missing-allowlist-entry
// problem, so adding the URI to this client's "Authorized redirect URIs"
// in Google Cloud Console will NOT fix it. The user must instead:
//
//   1. Open Google Cloud Console -> APIs & Services -> Credentials, for
//      the GCP project backing this Firebase project (project number
//      914200242478 / project id sky-lines-95986).
//   2. Create a NEW OAuth 2.0 Client ID with application type
//      "Desktop app" (custom URI scheme redirects are only permitted for
//      native client types - Desktop app / iOS / Android / TVs and
//      Limited Input devices - never "Web application").
//   3. Copy that client's Client ID (looks like
//      `<number>-<hash>.apps.googleusercontent.com`) into this repo's
//      `.env.local` as `NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID`. No
//      client secret is needed for the implicit flow used here.
//   4. This is a genuinely new, unverified code path from this
//      environment: if Google's server also rejects `response_type=id_token`
//      for the new Desktop-app client (Google's own docs mostly illustrate
//      Desktop-app clients with `response_type=code` + PKCE rather than the
//      implicit grant), the fallback is PKCE without a client secret -
//      Desktop-app OAuth clients are "public clients" in Google's model, so
//      the `/token` exchange for them is documented to work with just
//      `code_verifier` and no `client_secret`. That would require adding a
//      PKCE code_verifier/code_challenge step here instead; deliberately
//      not implemented preemptively since it can't be verified without a
//      real Desktop-app client ID either.
//
// None of the above can be done from this environment (no Google Cloud
// Console access). See spec.md subtask 21 report for full detail.

const GOOGLE_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID;

// Custom URL scheme this app registers as a deep-link handler (see
// src-tauri/tauri.conf.json `plugins.deep-link` and src-tauri/src/lib.rs).
// Picked arbitrarily but must stay consistent across: this file, the Tauri
// config, and (once the user creates it) the Google Cloud Console OAuth
// client's allowed redirect configuration.
export const GOOGLE_AUTH_REDIRECT_URI = "skylines://auth-callback";
export const DEEP_LINK_SCHEME = "skylines";

function randomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Nonce for the in-flight Google sign-in attempt. Persisted to
// `localStorage` (not just a module-scoped variable) so it survives a full
// process restart: if the user closes the app while the system browser
// still has the Google consent screen open, `tauri-plugin-single-instance`
// only forwards the deep-link callback to an ALREADY-running instance - if
// nothing is running, the OS spawns a brand-new process to handle it, which
// has no in-memory state from the process that generated the nonce. A
// module-scoped variable would always be `null` in that fresh process,
// making this recovery path unconditionally dead. `localStorage` (not
// `sessionStorage`, which WebView2 also clears on a full process/webview
// restart) is what actually persists here. A short TTL keeps a stale,
// never-consumed nonce from lingering indefinitely.
const NONCE_STORAGE_KEY = "skylines.googleAuthNonce";
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes - generous for "user completes Google's consent screen," short enough a stale entry doesn't linger indefinitely

type StoredNonce = { nonce: string; createdAt: number };

function readStoredNonce(): StoredNonce | null {
  try {
    const raw = localStorage.getItem(NONCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNonce;
    if (Date.now() - parsed.createdAt > NONCE_TTL_MS) {
      localStorage.removeItem(NONCE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredNonce(nonce: string): void {
  localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify({ nonce, createdAt: Date.now() }));
}

function clearStoredNonce(): void {
  localStorage.removeItem(NONCE_STORAGE_KEY);
}

// Last deep-link callback URL handed to the caller for processing.
// Module-scoped, alongside the nonce state above, since it's the same "one
// in-flight attempt" concept. `getCurrent()` (tauri-plugin-deep-link)
// returns the same cached URL on every call until a fresh deep-link event
// replaces it - its Rust-side `current` state is never cleared after being
// read. Without this guard, remounting the login page (e.g. after signing
// out and being routed back to /login) would reprocess a stale,
// already-consumed callback and show a spurious "Google sign-in failed"
// nonce-mismatch error to a user who hasn't attempted anything.
let lastProcessedCallbackUrl: string | null = null;

/**
 * True if this callback URL has already been handed to
 * finishGoogleSignIn once. See `lastProcessedCallbackUrl` above.
 */
export function shouldProcessCallbackUrl(url: string): boolean {
  if (url === lastProcessedCallbackUrl) return false;
  lastProcessedCallbackUrl = url;
  return true;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID);
}

/** Builds the Google OAuth 2.0 authorization URL for the implicit id_token flow. */
export function buildGoogleAuthUrl(): string {
  if (!GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error(
      "Google sign-in is not configured: set NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID " +
        "in .env.local (see lib/auth/googleOAuth.ts for the Google Cloud Console setup this requires).",
    );
  }

  const nonce = randomToken();
  writeStoredNonce(nonce);

  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_AUTH_REDIRECT_URI,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    prompt: "select_account",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token.");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json);
}

/**
 * Validates that an id_token's `nonce` claim matches the nonce generated for
 * the most recent `buildGoogleAuthUrl()` call, then clears it (single use).
 * This guards against a stale/replayed callback URL being processed.
 */
export function verifyAndConsumeNonce(idToken: string): boolean {
  const stored = readStoredNonce();
  clearStoredNonce();
  if (!stored) return false;
  try {
    const payload = decodeJwtPayload(idToken);
    return payload.nonce === stored.nonce;
  } catch {
    return false;
  }
}

/** Parses the deep-link callback URL Google redirects to after sign-in. */
export function parseGoogleCallbackUrl(callbackUrl: string): { idToken: string } {
  const url = new URL(callbackUrl);

  // Implicit flow returns id_token in the URL fragment (`#...`), not the
  // query string - but parse both since a query string is used for errors.
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const fragmentParams = new URLSearchParams(fragment);
  const queryParams = url.searchParams;

  const error = fragmentParams.get("error") ?? queryParams.get("error");
  if (error) {
    throw new Error(`Google sign-in failed: ${error}`);
  }

  const idToken = fragmentParams.get("id_token") ?? queryParams.get("id_token");
  if (!idToken) {
    throw new Error("Google sign-in callback did not include an id_token.");
  }

  return { idToken };
}

/** True if a URL looks like our deep-link auth callback (vs. some other deep link). */
export function isGoogleAuthCallbackUrl(url: string): boolean {
  return url.startsWith(GOOGLE_AUTH_REDIRECT_URI);
}
