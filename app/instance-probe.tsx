"use client";

// M0 nav spike probe (spec.md subtask 3).
//
// This module-scope constant is evaluated exactly once per JS module
// instantiation. A client-side (SPA) navigation via <Link>/router.push does
// NOT re-run this module, so window.__instanceId stays identical across
// such navigations. A full document reload (fresh page load) re-executes
// this module and produces a new id. Comparing window.__instanceId before
// and after a navigation is how the spike distinguishes SPA nav from a full
// reload.
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
