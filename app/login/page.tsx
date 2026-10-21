"use client";

import { useState } from "react";
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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  buildGoogleAuthRequest,
  idTokenHasNonce,
  isGoogleSignInConfigured,
} from "@/lib/auth/googleOAuth";

// Google sign-in runs through the system browser and a loopback redirect; see
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

  async function handleGoogle() {
    setError("");
    setResetMessage("");
    if (!isGoogleSignInConfigured()) {
      setError(
        "Google sign-in isn't configured yet (missing NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID or NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET).",
      );
      return;
    }
    setGoogleLoading(true);
    let unlisten: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      unlisten?.();
      clearTimeout(timeout);
      setGoogleLoading(false);
    };
    try {
      const redirect = new Promise<string>((resolve, reject) => {
        void listen<string>("google-oauth:redirect", (e) => resolve(e.payload)).then((fn) => {
          unlisten = fn;
        });
        // Matches the Rust listener's own 5-minute limit.
        timeout = setTimeout(() => reject(new Error("timeout")), 5 * 60 * 1000);
      });
      redirect.catch(() => {});
      const port = await invoke<number>("google_oauth_listen");
      const redirectUri = `http://127.0.0.1:${port}`;
      const req = await buildGoogleAuthRequest(redirectUri);
      // Must be the OS browser: Google blocks OAuth inside embedded webviews.
      await openInBrowser(req.url);

      const params = new URLSearchParams(await redirect);
      const googleError = params.get("error");
      const code = params.get("code");
      if (params.get("state") !== req.state || googleError || !code) {
        if (googleError) console.error("Google sign-in error:", googleError);
        setError(googleError === "access_denied" ? "Google sign-in cancelled." : "Google sign-in failed.");
        return;
      }
      const idToken = await invoke<string>("google_oauth_exchange", {
        code,
        codeVerifier: req.codeVerifier,
        redirectUri,
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
      });
      if (!idTokenHasNonce(idToken, req.nonce)) throw new Error("nonce mismatch");
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      router.replace("/");
    } catch (err) {
      console.error("Google sign-in failed:", err instanceof Error ? err.message : err);
      setError("Google sign-in failed.");
    } finally {
      stop();
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
          <PasswordInput
            autoComplete="current-password"
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

        {process.env.NODE_ENV === "development" && (
          <DevLogin
            disabled={anyActionInFlight}
            loading={devLoginLoading}
            onLoadingChange={setDevLoginLoading}
            onError={(msg) => {
              setError(msg);
              setResetMessage("");
            }}
          />
        )}
      </div>
    </div>
  );
}

// Only rendered when NODE_ENV is "development", so release builds drop the
// credentials.
function DevLogin({
  disabled,
  loading,
  onLoadingChange,
  onError,
}: {
  disabled: boolean;
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  // Self-bootstrapping account. It holds no real data.
  const email = "dev@skylines.local";
  const password = "DevLogin123!";

  async function handleDevLogin() {
    onError("");
    onLoadingChange(true);
    try {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        // Only create the account when sign-in failed because it doesn't exist
        // ("auth/invalid-credential" when email enumeration protection hides
        // that). Rethrow every other error.
        const code = err instanceof FirebaseError ? err.code : undefined;
        if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      router.replace("/");
    } catch (err) {
      console.error(err);
      onError("Dev login failed.");
    } finally {
      onLoadingChange(false);
    }
  }

  return (
    <>
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
        disabled={disabled}
      >
        {loading ? "Signing in…" : "Dev Login"}
      </Button>
    </>
  );
}
