"use client";

// Evaluated once per module instance: client-side navigation keeps the same id,
// a full reload creates a new one. Used by the /spike-a and /spike-b navigation
// checks.
const instanceId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

if (typeof window !== "undefined") {
  (window as unknown as { __instanceId: string }).__instanceId = instanceId;
}

export default function InstanceProbe() {
  return null;
}
