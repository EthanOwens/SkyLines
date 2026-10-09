"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { THEME_VARIABLE_KEYS, type Theme, type ThemeVariableKey } from "@/lib/themes/types";

interface ThemePreviewProps {
  editingTheme: Theme;
  draftVariables: Partial<Record<ThemeVariableKey, string>>;
  /** Setting whose elements get outlined; nothing is outlined when null. */
  hoveredKey?: ThemeVariableKey | null;
}

type PreviewElement =
  | "root"
  | "sidebarStrip"
  | "sidebarPrimaryBar"
  | "sidebarAccentBar"
  | "card"
  | "cardText"
  | "textBox"
  | "textBoxHandle"
  | "textBoxInput";

const ELEMENTS_BY_KEY: Partial<Record<ThemeVariableKey, readonly PreviewElement[]>> = {
  background: ["root"],
  foreground: ["root"],
  border: ["root"],
  radius: ["root"],
  card: ["card", "textBox"],
  "card-foreground": ["cardText", "textBoxInput"],
  primary: ["textBoxHandle"],
  sidebar: ["sidebarStrip"],
  "sidebar-border": ["sidebarStrip"],
  "sidebar-foreground": ["sidebarStrip"],
  "sidebar-primary": ["sidebarPrimaryBar"],
  "sidebar-accent": ["sidebarAccentBar"],
};

// A fixed color rather than a theme variable, so it stays visible whatever the
// theme being edited looks like.
const HIGHLIGHT_COLOR = "#ff2d95";

// Drawn inside the element, because the preview root clips anything past its
// edges and several elements sit flush against them.
const HIGHLIGHT_STYLE: CSSProperties = {
  outline: `2px solid ${HIGHLIGHT_COLOR}`,
  outlineOffset: -2,
};

// The text box is clamped inside these bounds.
const CANVAS_W = 420;
const CANVAS_H = 280;
const BOX_W = 180;
const BOX_H = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// A hand-built mini canvas, not a tldraw instance. The draft's variables are
// set inline on this root only, so the unsaved draft never touches the real
// theme. Children use var(--...) directly, because Tailwind's utilities resolve
// against :root.
export function ThemePreview({ editingTheme, draftVariables, hoveredKey = null }: ThemePreviewProps) {
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

  const highlighted = new Set(hoveredKey ? ELEMENTS_BY_KEY[hoveredKey] ?? [] : []);
  const highlight = (element: PreviewElement) =>
    highlighted.has(element) ? HIGHLIGHT_STYLE : undefined;

  // Same draft-then-theme fallback as the color editor, so they always agree.
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
          ...highlight("sidebarStrip"),
        }}
      >
        <div
          className="mx-2 mt-3 h-2 rounded-full"
          style={{ background: "var(--sidebar-primary)", ...highlight("sidebarPrimaryBar") }}
        />
        <div
          className="mx-2 mt-1.5 h-2 w-2/3 rounded-full"
          style={{ background: "var(--sidebar-accent)", ...highlight("sidebarAccentBar") }}
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
          ...highlight("card"),
        }}
      >
        {/* Outlined outside the glyphs, inside the card's padding. */}
        <span style={highlight("cardText") && { ...HIGHLIGHT_STYLE, outlineOffset: 1 }}>
          Card
        </span>
      </div>

      {/*
        Position is local UI state. The handle bar owns dragging so it doesn't
        fight the input's text selection.
      */}
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
          ...highlight("textBox"),
        }}
      >
        <div
          className="h-3 shrink-0 cursor-grab touch-none active:cursor-grabbing"
          style={{ background: "var(--primary)", ...highlight("textBoxHandle") }}
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
          style={{ color: "var(--card-foreground)", ...highlight("textBoxInput") }}
        />
      </div>

      {/*
        The root's own outline would be painted under its positioned children,
        and the sidebar strip covers its left edge, so it gets an overlay on top.
      */}
      {highlighted.has("root") && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ borderRadius: "inherit", boxShadow: `inset 0 0 0 2px ${HIGHLIGHT_COLOR}` }}
        />
      )}
    </div>
  );
}
