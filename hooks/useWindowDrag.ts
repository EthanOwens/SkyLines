"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const DRAG_THRESHOLD_PX = 4;
const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [role='button']";

// Replaces data-tauri-drag-region for title bars: the native drag starts only
// after the pointer moves, because on macOS a native drag swallows the mouse-up
// and would break click and double-click on the bar.
export function useWindowDrag() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  function onMouseDown(e: ReactMouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    // React events bubble through portals, so mousedowns in portaled menus and
    // pickers would otherwise reach the bar.
    if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
    if (e.target.closest(INTERACTIVE_SELECTOR)) return;

    cleanupRef.current?.();
    const startX = e.screenX;
    const startY = e.screenY;

    // Listening on the document keeps tracking when the pointer leaves the bar
    // before crossing the threshold.
    function handleMove(ev: MouseEvent) {
      if ((ev.buttons & 1) === 0) {
        stop();
        return;
      }
      if (Math.hypot(ev.screenX - startX, ev.screenY - startY) <= DRAG_THRESHOLD_PX) return;
      stop();
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().startDragging(),
      );
    }

    function stop() {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", stop);
      cleanupRef.current = null;
    }

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", stop);
    cleanupRef.current = stop;
  }

  return { onMouseDown };
}
