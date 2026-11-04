"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  buildGoogleAuthRequest,
  idTokenHasNonce,
  isGoogleSignInConfigured,
} from "@/lib/auth/googleOAuth";

let warnedUnconfigured = false;

// Google sign-in runs through the system browser and a loopback redirect; see
// lib/auth/googleOAuth.ts.
export function GoogleSignInButton({
  disabled,
  onBusyChange,
  onError,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const configured = isGoogleSignInConfigured();

  if (!configured && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      "Google sign-in is not configured: set NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID and NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET.",
    );
  }

  async function handleGoogle() {
    onError("");
    setLoading(true);
    onBusyChange(true);
    let unlisten: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      unlisten?.();
      clearTimeout(timeout);
      setLoading(false);
      onBusyChange(false);
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
        onError(googleError === "access_denied" ? "Google sign-in cancelled." : "Google sign-in failed.");
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
      onError("Google sign-in failed.");
    } finally {
      stop();
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogle}
        disabled={disabled || loading || !configured}
      >
        {loading ? "Waiting for browser…" : "Continue with Google"}
      </Button>
      {!configured && (
        <p className="text-center text-xs text-muted-foreground">
          Google sign-in isn&apos;t set up in this build.
        </p>
      )}
    </div>
  );
}
