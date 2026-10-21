// Google sign-in through the system browser (Google blocks OAuth inside
// embedded webviews). Authorization-code flow with PKCE and a loopback
// redirect: Rust listens on 127.0.0.1:<port> (google_oauth_listen), the browser
// lands there, and Rust exchanges the code for an id_token
// (google_oauth_exchange). Firebase's signInWithCredential only needs the
// id_token.
//
// Needs a "Desktop app" OAuth client from Google Cloud Console in
// NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID, plus its secret in
// NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET (Google allows installed apps
// to ship it).

export const GOOGLE_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID;
export const GOOGLE_OAUTH_CLIENT_SECRET = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET;

export function isGoogleSignInConfigured(): boolean {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export type GoogleAuthRequest = { url: string; state: string; nonce: string; codeVerifier: string };

export async function buildGoogleAuthRequest(redirectUri: string): Promise<GoogleAuthRequest> {
  if (!GOOGLE_OAUTH_CLIENT_ID) throw new Error("Google sign-in is not configured.");
  const codeVerifier = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const state = randomToken();
  const nonce = randomToken();

  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: base64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
    nonce,
    codeVerifier,
  };
}

export function idTokenHasNonce(idToken: string, nonce: string): boolean {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)).nonce === nonce;
  } catch {
    return false;
  }
}
