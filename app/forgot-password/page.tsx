"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInWithEmailAndPassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { FirebaseError } from "firebase/app";
import { auth, functions } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/auth/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/PasswordInput";

const RESEND_SECONDS = 60;
const UNREACHABLE = "Couldn't reach the password reset service. Try again later.";

const requestReset = httpsCallable(functions, "requestPasswordReset");
const confirmReset = httpsCallable(functions, "confirmPasswordReset");

function resetErrorMessage(err: unknown): { message: string; retryAfter?: number } {
  const details = err instanceof FirebaseError ? (err as FirebaseError & { details?: unknown }).details : undefined;
  const { reason, retryAfterSeconds } = (details ?? {}) as { reason?: string; retryAfterSeconds?: number };
  switch (reason) {
    case "invalid-code":
      return { message: "That code isn't right." };
    case "expired":
      return { message: "That code has expired. Send a new one." };
    case "too-many-attempts":
      return { message: "Too many wrong codes. Send a new one." };
    case "cooldown": {
      const s = Math.max(1, Math.ceil(retryAfterSeconds ?? RESEND_SECONDS));
      return { message: `Please wait ${s} seconds before requesting another code.`, retryAfter: s };
    }
    case "too-many-requests":
      return { message: "Too many codes requested. Try again in an hour." };
    case "invalid-email":
      return { message: "That email address doesn't look right." };
    case "weak-password":
      return { message: "Password must be at least 6 characters." };
  }
  if (err instanceof FirebaseError && err.code === "auth/network-request-failed") {
    return { message: authErrorMessage(err, UNREACHABLE) };
  }
  console.error(err);
  return { message: UNREACHABLE };
}

function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setError("");
    setLoading(true);
    try {
      await requestReset({ email: email.trim() });
      setResendIn(RESEND_SECONDS);
      setCode("");
      setStep(2);
    } catch (err) {
      const { message, retryAfter } = resetErrorMessage(err);
      setError(message);
      if (retryAfter) {
        setResendIn(retryAfter);
        setStep(2);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length !== 6) return setError("Enter the 6-digit code.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    try {
      await confirmReset({ email: email.trim(), code, newPassword: password });
    } catch (err) {
      setError(resetErrorMessage(err).message);
      setLoading(false);
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/");
    } catch {
      router.replace("/login");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Reset your password</h1>
        </div>

        {step === 1 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
            className="space-y-3"
          >
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              If an account exists for {email.trim()}, we&apos;ve emailed a 6-digit code. It expires in 15
              minutes.
            </p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
            <PasswordInput
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <PasswordInput
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Resetting…" : "Reset password"}
            </Button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                onClick={sendCode}
                disabled={loading || resendIn > 0}
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:no-underline disabled:opacity-60"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setStep(1);
                }}
                disabled={loading}
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}
