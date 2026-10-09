// Google sign-in through the system browser and a skylines:// deep link. Google
// blocks OAuth inside embedded webviews, so neither signInWithPopup nor
// signInWithRedirect works in Tauri.
//
// Uses the implicit id_token flow: Firebase's signInWithCredential only needs
// the id_token, and no client secret ships in the app.
//
// Needs a "Desktop app" OAuth client from Google Cloud Console (APIs & Services
// > Credentials) in NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID. Google rejects
// custom-scheme redirect URIs for "Web application" clients, including the one
// Firebase creates. If Google also rejects response_type=id_token for the
// Desktop client, switch to PKCE without a secret (Desktop clients are public
// clients).

const GOOGLE_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID;

// Must match tauri.conf.json's deep-link scheme and the OAuth client's redirect
// configuration.
export const GOOGLE_AUTH_REDIRECT_URI = "skylines://auth-callback";
export const DEEP_LINK_SCHEME = "skylines";

function randomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// In localStorage so it survives a restart: if the app is closed while the
// browser is on Google's consent screen, the deep link starts a fresh process
// with no in-memory state. sessionStorage doesn't survive that either.
const NONCE_STORAGE_KEY = "skylines.googleAuthNonce";
const NONCE_TTL_MS = 10 * 60 * 1000;

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

// getCurrent() keeps returning the last deep link forever, so remember which
// one was handled. Otherwise returning to /login (for example after signing
// out) would replay it and show a spurious nonce error.
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

/** Single use, so a replayed callback URL is rejected. */
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

  // The id_token arrives in the fragment; errors come in the query string.
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
