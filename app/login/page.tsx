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

// Self-bootstrapping dev login account. It holds no real data.
const DEV_EMAIL = "dev@skylines.local";
const DEV_PASSWORD = "DevLogin123!";

// Google sign-in runs through the system browser and a deep link; see
// lib/auth/googleOAuth.ts.
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
    // Deep-link callback while the app is running (forwarded by the
    // single-instance plugin).
    const unlistenPromise = onOpenUrl((urls) => {
      const callbackUrl = urls.find(isGoogleAuthCallbackUrl);
      if (callbackUrl && shouldProcessCallbackUrl(callbackUrl)) void finishGoogleSignIn(callbackUrl);
    });

    // Callback that launched the app fresh. getCurrent() keeps returning the
    // same URL, so shouldProcessCallbackUrl guards against reprocessing it on a
    // later mount.
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
        // Only create the account when sign-in failed because it doesn't exist
        // ("auth/invalid-credential" when email enumeration protection hides
        // that). Rethrow every other error.
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
      // Must be the OS browser: Google blocks OAuth inside embedded webviews.
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
