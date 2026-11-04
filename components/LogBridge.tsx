"use client";

import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const MAX_LEN = 2000;

function stringify(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

export function LogBridge() {
  useEffect(() => {
    const label = getCurrentWebviewWindow().label;
    const send = (level: "error" | "warn", parts: unknown[]) => {
      const line = `[${label}] ${parts.map(stringify).join(" ")}`.slice(0, MAX_LEN);
      // Failures are swallowed: logging must never raise its own errors.
      import("@tauri-apps/plugin-log")
        .then((log) => log[level](line))
        .catch(() => {});
    };

    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args: unknown[]) => {
      origError.apply(console, args);
      send("error", args);
    };
    console.warn = (...args: unknown[]) => {
      origWarn.apply(console, args);
      send("warn", args);
    };
    const onError = (e: ErrorEvent) =>
      send("error", ["Uncaught", e.error ?? e.message]);
    const onRejection = (e: PromiseRejectionEvent) =>
      send("error", ["Unhandled rejection", e.reason]);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
