import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createTransport } from "nodemailer";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  decideSend,
  docId,
  generateCode,
  hashCode,
  normalizeEmail,
} from "./resetCode";

initializeApp();

const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const secrets = [GMAIL_USER, GMAIL_APP_PASSWORD];

type Reason =
  | "invalid-email"
  | "cooldown"
  | "too-many-requests"
  | "invalid-code"
  | "expired"
  | "too-many-attempts"
  | "weak-password";

const fail = (reason: Reason, extra: Record<string, unknown> = {}) =>
  new HttpsError("failed-precondition", reason, { reason, ...extra });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requestPasswordReset = onCall({ secrets }, async (request) => {
  const raw = request.data?.email;
  const email = typeof raw === "string" ? normalizeEmail(raw) : "";
  if (!EMAIL_RE.test(email)) throw fail("invalid-email");

  const id = docId(email);
  const ref = getFirestore().collection("passwordResets").doc(id);
  const now = Date.now();

  // A user record may not exist; limits still apply so the response can't reveal that.
  let user: Awaited<ReturnType<ReturnType<typeof getAuth>["getUserByEmail"]>> | null = null;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw new HttpsError("internal", "Lookup failed");
  }
  const code = generateCode();

  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const decision = decideSend(snap.data()?.sendTimes ?? [], now);
    if (!decision.ok) {
      throw decision.reason === "cooldown"
        ? fail("cooldown", { retryAfterSeconds: decision.retryAfterSeconds })
        : fail("too-many-requests");
    }
    tx.set(ref, {
      codeHash: user ? hashCode(id, code) : null,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      sendTimes: decision.sendTimes,
    });
  });

  if (!user) return { ok: true };

  try {
    await createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    }).sendMail({
      from: `Skylines <${GMAIL_USER.value()}>`,
      to: email,
      subject: "Your Skylines password reset code",
      text:
        `Your Skylines password reset code is ${code}.\n\n` +
        `It expires in 15 minutes. If you didn't ask for this, ignore this email.`,
    });
  } catch (e) {
    console.error("Sending reset email failed", (e as Error).message);
    throw new HttpsError("internal", "Couldn't send the email");
  }
  return { ok: true };
});

export const confirmPasswordReset = onCall(async (request) => {
  const { email: rawEmail, code, newPassword } = request.data ?? {};
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";
  if (!EMAIL_RE.test(email)) throw fail("invalid-email");

  const id = docId(email);
  const ref = getFirestore().collection("passwordResets").doc(id);

  const uid = await getFirestore().runTransaction<{ error: Reason } | { uid: string }>(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data?.codeHash) throw fail("invalid-code");
    if (Date.now() > data.expiresAt) throw fail("expired");

    if (typeof code !== "string" || hashCode(id, code.trim()) !== data.codeHash) {
      const attempts = (data.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        tx.delete(ref);
        // Throwing rolls back the transaction, so hand the outcome out instead.
        return { error: "too-many-attempts" as const };
      }
      tx.update(ref, { attempts });
      return { error: "invalid-code" as const };
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) throw fail("weak-password");

    let user;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch {
      throw fail("invalid-code");
    }
    tx.delete(ref);
    return { uid: user.uid };
  });

  if ("error" in uid) throw fail(uid.error);
  await getAuth().updateUser(uid.uid, { password: newPassword });
  await getAuth().revokeRefreshTokens(uid.uid);
  return { ok: true };
});
