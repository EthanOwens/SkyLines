"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildGoogleAuthUrl,
  isGoogleAuthCallbackUrl,
  isGoogleSignInConfigured,
  parseGoogleCallbackUrl,
  shouldProcessCallbackUrl,
  verifyAndConsumeNonce,
} from "@/lib/auth/googleOAuth";

// Fixed, self-bootstrapping personal dev-login account (spec.md subtask 2).
// Not security-sensitive - a throwaway account with no real data value,
// matching the TEST_EMAIL/TEST_PASSWORD convention used throughout this
// project's app/spike-*/page.tsx verification routes.
const DEV_EMAIL = "dev@skylines.local";
const DEV_PASSWORD = "DevLogin123!";

// Ported from ../note_taking_app/app/login/page.tsx (spec.md subtask 21),
// rebranded NoteFlow -> Skylines. Email/password sign-in is unchanged
// (`signInWithEmailAndPassword`) per spec.md's explicit "leave as-is".
// Google sign-in replaces `signInWithPopup` with a system-browser +
// deep-link flow - see lib/auth/googleOAuth.ts for why, and for the
// external Google Cloud Console configuration this needs before it can
// work end to end.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [devLoginLoading, setDevLoginLoading] = useState(false);

  const anyActionInFlight = loading || resetLoading || googleLoading || devLoginLoading;

  async function finishGoogleSignIn(callbackUrl: string) {
    try {
      const { idToken } = parseGoogleCallbackUrl(callbackUrl);
      if (!verifyAndConsumeNonce(idToken)) {
        throw new Error("Google sign-in response failed validation (nonce mismatch).");
      }
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      router.replace("/");
    } catch {
      setError("Google sign-in failed.");
      setResetMessage("");
    } finally {
      setGoogleLoading(false);
    }
  }

  useEffect(() => {
    // Handles the deep-link callback while this app instance keeps running
    // (the common case: system browser hands off `skylines://auth-callback`
    // and tauri-plugin-single-instance's `deep-link` feature forwards it
    // here as a `deep-link://new-url` event - see src-tauri/src/lib.rs).
    const unlistenPromise = onOpenUrl((urls) => {
      const callbackUrl = urls.find(isGoogleAuthCallbackUrl);
      if (callbackUrl && shouldProcessCallbackUrl(callbackUrl)) void finishGoogleSignIn(callbackUrl);
    });

    // Handles the case where the app was launched fresh by the deep link
    // (e.g. it had been closed while the browser step was in progress).
    // getCurrent() returns the same cached URL on every call (it's never
    // cleared plugin-side), so this is also guarded by
    // shouldProcessCallbackUrl - otherwise remounting this page later (e.g.
    // after signing out) would reprocess a stale, already-consumed callback.
    void getCurrent().then((urls) => {
      const callbackUrl = urls?.find(isGoogleAuthCallbackUrl);
      if (callbackUrl && shouldProcessCallbackUrl(callbackUrl)) void finishGoogleSignIn(callbackUrl);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResetMessage("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setResetMessage("");
    const targetEmail = email.trim() || window.prompt("Email", "")?.trim() || "";
    if (!targetEmail) return;
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      setResetMessage("Check your email for a password reset link.");
    } catch {
      setError("Could not send reset email. Please check the address and try again.");
    } finally {
      setResetLoading(false);
    }
  }

  async function handleDevLogin() {
    setError("");
    setResetMessage("");
    setDevLoginLoading(true);
    try {
      try {
        await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
      } catch (err) {
        // Only self-bootstrap the account when sign-in failed because it
        // genuinely doesn't exist yet ("auth/user-not-found", or
        // "auth/invalid-credential" on projects with email enumeration
        // protection enabled, which hides whether the account exists).
        // Any other failure (network error, wrong password on an account
        // that already exists correctly, etc.) is rethrown as-is so it
        // isn't masked by an account-creation attempt.
        const code = err instanceof FirebaseError ? err.code : undefined;
        if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
          await createUserWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
        } else {
          throw err;
        }
      }
      router.replace("/");
    } catch (err) {
      console.error(err);
      setError("Dev login failed.");
    } finally {
      setDevLoginLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setResetMessage("");
    if (!isGoogleSignInConfigured()) {
      setError(
        "Google sign-in isn't configured yet (missing NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID).",
      );
      return;
    }
    setGoogleLoading(true);
    try {
      const url = buildGoogleAuthUrl();
      // Opens the URL in the OS's actual default browser, NOT this app's
      // webview - required because Google's OAuth policy blocks sign-in
      // from embedded/non-standard webviews (see lib/auth/googleOAuth.ts).
      await openInBrowser(url);
    } catch {
      setError("Could not open the system browser for Google sign-in.");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to Skylines</p>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="text-right">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={anyActionInFlight}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {resetLoading ? "Sending…" : "Forgot password?"}
            </button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {resetMessage && <p className="text-sm text-muted-foreground">{resetMessage}</p>}
          <Button type="submit" className="w-full" disabled={anyActionInFlight}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs text-muted-foreground">
            <span className="bg-background px-2">or</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={anyActionInFlight}
        >
          {googleLoading ? "Waiting for browser…" : "Continue with Google"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/register" className="underline underline-offset-4">
            Sign up
          </Link>
        </p>

        <div className="relative pt-2">
          <div className="absolute inset-0 flex items-center pt-2">
            <div className="w-full border-t border-dashed border-border" />
          </div>
          <div className="relative flex justify-center text-xs text-muted-foreground">
            <span className="bg-background px-2">dev only</span>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full border border-dashed border-amber-500 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
          onClick={handleDevLogin}
          disabled={anyActionInFlight}
        >
          {devLoginLoading ? "Signing in…" : "Dev Login"}
        </Button>
      </div>
    </div>
  );
}
