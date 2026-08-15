"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { THEME_VARIABLE_KEYS, type Theme, type ThemeVariableKey } from "@/lib/themes/types";

interface ThemePreviewProps {
  editingTheme: Theme;
  draftVariables: Partial<Record<ThemeVariableKey, string>>;
}

// Fixed dimensions for the bounded mini-canvas and the draggable text box
// inside it, used to clamp the box's position so it can't be dragged out of
// view.
const CANVAS_W = 420;
const CANVAS_H = 280;
const BOX_W = 180;
const BOX_H = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Center-region live preview (spec.md M7 subtask 16). A bounded, hand-built
// mock mini-canvas - NOT a real embedded tldraw instance - that demonstrates
// the theme's variables in miniature: its own background, a "sidebar" strip,
// a "card", and a movable/editable default text box.
//
// Critically, this scopes the draft's CSS variables to ONLY this preview's
// own root element via an inline `style` prop (`--background`, `--card`,
// etc., the exact same names app/globals.css's `@theme` block maps Tailwind
// colors from), rather than calling lib/themes/apply.ts or touching
// `document.documentElement`. That keeps `draftVariables` - an unsaved,
// in-progress draft - from leaking into the real app theme before Save; the
// preview's own markup below then just uses `var(--...)` directly (not
// Tailwind's `bg-background` utilities, since those resolve against
// `:root`'s real variables, not this scoped subtree) so normal CSS
// inheritance does the live-updating for free as draftVariables changes.
export function ThemePreview({ editingTheme, draftVariables }: ThemePreviewProps) {
  const [boxPos, setBoxPos] = useState({ x: 40, y: 100 });
  const [boxText, setBoxText] = useState("Edit me");

  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragOffset.current = { x: e.clientX - boxPos.x, y: e.clientY - boxPos.y };
    },
    [boxPos],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const nextX = clamp(e.clientX - dragOffset.current.x, 0, CANVAS_W - BOX_W);
    const nextY = clamp(e.clientY - dragOffset.current.y, 0, CANVAS_H - BOX_H);
    setBoxPos({ x: nextX, y: nextY });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Build the full set of scoped `--variable: value` inline styles from all
  // 31 ThemeVariableKeys, mirroring the same `draftVariables[key] ??
  // editingTheme.variables[key]` fallback the right sidebar's color editor
  // already uses (ThemeEditor.tsx) so the preview always agrees with what
  // the sidebar is showing as each field's current value.
  const scopedVariableStyle = THEME_VARIABLE_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = draftVariables[key] ?? editingTheme.variables[key];
    if (value !== undefined) {
      acc[`--${key}`] = value;
    }
    return acc;
  }, {});

  return (
    <div
      className="relative overflow-hidden rounded-lg border shadow-sm"
      style={
        {
          ...scopedVariableStyle,
          width: CANVAS_W,
          height: CANVAS_H,
          background: "var(--background)",
          color: "var(--foreground)",
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        } as CSSProperties
      }
    >
      {/* Mock "sidebar" strip, demonstrating --sidebar/--sidebar-foreground. */}
      <div
        className="absolute inset-y-0 left-0 w-14 border-r"
        style={{
          background: "var(--sidebar)",
          color: "var(--sidebar-foreground)",
          borderColor: "var(--sidebar-border)",
        }}
      >
        <div
          className="mx-2 mt-3 h-2 rounded-full"
          style={{ background: "var(--sidebar-primary)" }}
        />
        <div
          className="mx-2 mt-1.5 h-2 w-2/3 rounded-full"
          style={{ background: "var(--sidebar-accent)" }}
        />
      </div>

      {/* Mock "card", demonstrating --card/--card-foreground. */}
      <div
        className="absolute right-3 top-3 rounded-md border px-2 py-1.5 text-[10px]"
        style={{
          background: "var(--card)",
          color: "var(--card-foreground)",
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        Card
      </div>

      {/* Movable, editable default text box - the required demo affordance.
          Position is purely local UI state, not part of the theme itself.
          The drag handle bar (top strip) owns the pointer-drag logic so it
          doesn't fight with the input's own text-selection/caret dragging. */}
      <div
        className="absolute flex flex-col overflow-hidden border shadow-sm"
        style={{
          left: boxPos.x,
          top: boxPos.y,
          width: BOX_W,
          height: BOX_H,
          background: "var(--card)",
          borderColor: "var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          className="h-3 shrink-0 cursor-grab touch-none active:cursor-grabbing"
          style={{ background: "var(--primary)" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <input
          type="text"
          value={boxText}
          onChange={(e) => setBoxText(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
          style={{ color: "var(--card-foreground)" }}
        />
      </div>
    </div>
  );
}
