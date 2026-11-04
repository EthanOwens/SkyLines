import { FirebaseError } from "firebase/app";

const INVALID_CREDENTIALS = "Invalid email or password.";

const MESSAGES: Record<string, string> = {
  "auth/network-request-failed":
    "Can't reach the sign-in service. Check your internet connection and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/weak-password": "That password is too weak. Try a longer one.",
  "auth/email-already-in-use":
    "An account with this email already exists. Sign in instead, or use Continue with Google if you signed up that way.",
  "auth/invalid-credential": INVALID_CREDENTIALS,
  "auth/wrong-password": INVALID_CREDENTIALS,
  "auth/user-not-found": INVALID_CREDENTIALS,
  "auth/user-disabled": "This account has been disabled.",
};

export function authErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof FirebaseError ? MESSAGES[err.code] : undefined;
  if (message) return message;
  console.error(err);
  return fallback;
}
