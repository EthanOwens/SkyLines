import { createHash, randomInt } from "node:crypto";

export const CODE_TTL_MS = 15 * 60 * 1000;
export const COOLDOWN_MS = 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const docId = (email: string) =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex");

export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// Salted with the doc id so identical codes for different emails hash differently.
export const hashCode = (id: string, code: string) =>
  createHash("sha256").update(`${id}:${code}`).digest("hex");

export type SendDecision =
  | { ok: true; sendTimes: number[] }
  | { ok: false; reason: "cooldown"; retryAfterSeconds: number }
  | { ok: false; reason: "too-many-requests" };

/** `sendTimes` are epoch ms of earlier sends; returns the pruned list including `now` when allowed. */
export function decideSend(sendTimes: number[], now: number): SendDecision {
  const recent = sendTimes.filter((t) => now - t < HOUR_MS);
  const last = Math.max(0, ...recent);
  if (recent.length > 0 && now - last < COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryAfterSeconds: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) };
  }
  if (recent.length >= MAX_SENDS_PER_HOUR) return { ok: false, reason: "too-many-requests" };
  return { ok: true, sendTimes: [...recent, now] };
}
