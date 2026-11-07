"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Popover } from "@base-ui/react/popover";
import { converter, formatHex, parse } from "culori";
import { Check, Copy } from "lucide-react";
import { normalizeHex } from "@/lib/colors/notePalette";

const toHsv = converter("hsv");

const WHEEL_SIZE = 140;

// Hue by angle, saturation by radius, at full brightness. conic-gradient's
// 90deg start puts red on the right, matching atan2's zero angle.
const WHEEL_BACKGROUND =
  "radial-gradient(circle closest-side, #fff, transparent), conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";

interface NoteColorPopoverProps {
  trigger: ReactElement;
  /** Current color as "#rrggbb". */
  hex: string;
  isOverridden: boolean;
  onPick: (hex: string) => void;
  onResetToHue: () => void;
}

// Popover with a color wheel, an editable hex box and a Copy button.
export function NoteColorPopover({
  trigger,
  hex,
  isOverridden,
  onPick,
  onResetToHue,
}: NoteColorPopoverProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(hex);
  const [copied, setCopied] = useState(false);

  useEffect(() => setText(hex), [hex]);

  function pickFromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    onPick(formatHex({ mode: "hsv", h: hue, s, v: 1 }));
  }

  function handleTextChange(value: string) {
    setText(value);
    const normalized = normalizeHex(value);
    if (normalized) onPick(normalized);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("Copy color failed", err);
    }
  }

  const hsv = toHsv(parse(hex) ?? parse("#000000")!);
  const angle = ((hsv.h ?? 0) * Math.PI) / 180;
  const radius = (hsv.s ?? 0) * (WHEEL_SIZE / 2);
  const markerX = WHEEL_SIZE / 2 + Math.cos(angle) * radius;
  const markerY = WHEEL_SIZE / 2 + Math.sin(angle) * radius;

  return (
    <Popover.Root>
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="center" sideOffset={6} className="isolate z-50">
          <Popover.Popup
            data-note-color-popover=""
            className="flex w-44 flex-col items-center gap-2 rounded-lg bg-popover p-2.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none"
          >
            <div
              ref={wheelRef}
              data-note-color-wheel=""
              className="relative shrink-0 cursor-crosshair touch-none rounded-full"
              style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, background: WHEEL_BACKGROUND }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                pickFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) pickFromPointer(e);
              }}
            >
              <span
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40"
                style={{ left: markerX, top: markerY, backgroundColor: hex }}
              />
            </div>

            <div className="flex w-full items-center gap-1.5">
              <input
                aria-label="Hex color"
                data-note-color-hex=""
                value={text}
                spellCheck={false}
                onChange={(e) => handleTextChange(e.target.value)}
                onBlur={() => setText(hex)}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <button
                type="button"
                aria-label="Copy hex"
                onClick={() => void handleCopy()}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-xs hover:bg-accent"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                Copy
              </button>
            </div>

            {isOverridden && (
              <button
                type="button"
                data-note-color-reset-hue=""
                onClick={onResetToHue}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Reset to hue
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
