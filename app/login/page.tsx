"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/auth/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [devLoginLoading, setDevLoginLoading] = useState(false);

  const anyActionInFlight = loading || googleLoading || devLoginLoading;

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/");
    } catch (err) {
      setError(authErrorMessage(err, "Sign-in failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Sign in to Skylines</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your email or Google account.</p>
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
            <Link
              href={`/forgot-password?email=${encodeURIComponent(email.trim())}`}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
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

        <GoogleSignInButton
          disabled={anyActionInFlight}
          onBusyChange={setGoogleLoading}
          onError={(msg) => {
            setError(msg);
                  }}
        />

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
