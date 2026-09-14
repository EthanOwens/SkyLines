"use client";

// spec.md subtask 9 ("Sticky note top bar"). Renders above the title/editor
// content in StickyNoteEditor.tsx. Two responsibilities:
//
// 1. Chrome: Pin (real OS-level always-on-top, over the whole desktop per
//    spec.md's explicit decision - `Window.setAlwaysOnTop`, not scoped to
//    this app's own windows), Exit (autosave via the caller's
//    `onBeforeExit`, then close this window), and a 3-dot menu with Delete
//    and "Change top bar color".
// 2. Window focus/blur-driven show/hide + height shrink: the button row
//    only renders while the OS window is focused: a real Tauri window-focus
//    listener (`Window.onFocusChanged`), NOT a DOM focus/blur event (which
//    only fires for a specific focusable element, not the whole OS window).
//    On blur the window is also physically shrunk (`Window.setSize`) down
//    to a thin strip just showing the color bar/title, and restored to its
//    exact prior size (not a hardcoded magic number, since the window is
//    resizable - see stickyWindow.ts) on refocus.
//
// All @tauri-apps/api imports are dynamic (inside effects/handlers), matching
// lib/stickyWindow.ts's existing convention - these APIs assume a live Tauri
// runtime that isn't present at Next.js static-export build/prerender time.

import { useEffect, useRef, useState } from "react";
import { Pin, PinOff, X, MoreVertical, Trash2, Palette } from "lucide-react";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateStickyNote, deleteStickyNote } from "@/lib/db/stickyNotes";
import { themeColorToPickerHex } from "@/lib/themes/color";
import type { StickyNote } from "@/types";

// Collapsed (unfocused) window height in logical pixels - just enough to
// show the color strip/title, no buttons. The full height (whatever the
// window's actual current size is when it loses focus, since subtask 8 made
// the window resizable) is captured live in `originalSizeRef` rather than
// hardcoded, so refocusing always restores the exact prior size.
const COLLAPSED_HEIGHT = 48;

// Matches lib/themes/color.ts's own fallback - shown only until the
// `--primary` lookup effect below resolves.
const FALLBACK_PICKER_HEX = "#000000ff";

interface Props {
  note: StickyNote;
  /** Live title (kept in sync with StickyNoteEditor's own input state, unlike the static `note` prop). */
  title: string;
  /** Flushes any unsaved title/content edits; awaited before the window closes. */
  onBeforeExit: () => Promise<void>;
}

// Small icon button matching this app's established small-chrome
// conventions (e.g. components/ribbon/Ribbon.tsx's `FormatBtn`) - not
// literally reused since this lives in a separate window/bundle, but same
// Tooltip + ghost icon Button shape.
function TopBarBtn({
  onClick,
  tip,
  children,
  active,
}: {
  onClick: () => void;
  tip: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 text-primary-foreground hover:bg-black/10 hover:text-primary-foreground ${
              active ? "bg-black/10" : ""
            }`}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function StickyNoteTopBar({ note, title, onBeforeExit }: Props) {
  const [pinned, setPinned] = useState(note.pinned);
  const [topBarColor, setTopBarColor] = useState(note.topBarColor);
  const [focused, setFocused] = useState(true);
  // Resolved hex for the picker's default when no custom `topBarColor` is
  // set, so it opens on the same color the `var(--primary)` CSS fallback
  // actually renders instead of a disconnected hardcoded black.
  const [defaultColorHex, setDefaultColorHex] = useState(FALLBACK_PICKER_HEX);
  const originalSizeRef = useRef<import("@tauri-apps/api/dpi").LogicalSize | null>(null);

  useEffect(() => {
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary");
    setDefaultColorHex(themeColorToPickerHex(primary));
  }, []);

  // Sets up the real Tauri window-focus listener + shrink/restore + applies
  // the note's persisted `pinned` state to the actual OS window on mount.
  useEffect(() => {
    let cancelled = false;
    let unlistenFocus: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    const isFocusedRef = { current: true };

    async function setup() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      const win = getCurrentWindow();

      const scaleFactor = await win.scaleFactor();
      const initialFocused = await win.isFocused();
      if (cancelled) return;
      isFocusedRef.current = initialFocused;
      setFocused(initialFocused);

      originalSizeRef.current = (await win.outerSize()).toLogical(scaleFactor);

      if (note.pinned) {
        await win.setAlwaysOnTop(true);
      }

      unlistenFocus = await win.onFocusChanged(async ({ payload: isFocused }) => {
        isFocusedRef.current = isFocused;
        setFocused(isFocused);
        if (isFocused) {
          if (originalSizeRef.current) {
            await win.setSize(originalSizeRef.current);
          }
        } else {
          const currentSize = (await win.outerSize()).toLogical(scaleFactor);
          originalSizeRef.current = currentSize;
          await win.setSize(new LogicalSize(currentSize.width, COLLAPSED_HEIGHT));
        }
      });

      // Keeps `originalSizeRef` in sync if the user resizes the window
      // while it's focused, so a subsequent blur/refocus cycle restores the
      // size they actually resized to, not a stale one from before the
      // resize. Resizes caused by our own shrink-on-blur are correctly
      // ignored here since `isFocusedRef` is already false by the time
      // that `setSize` call's resulting event fires.
      unlistenResize = await win.onResized(async () => {
        if (!isFocusedRef.current) return;
        originalSizeRef.current = (await win.outerSize()).toLogical(scaleFactor);
      });
    }

    void setup();

    return () => {
      cancelled = true;
      unlistenFocus?.();
      unlistenResize?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  async function togglePinned() {
    const next = !pinned;
    setPinned(next);
    void updateStickyNote(note.id, { pinned: next });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(next);
  }

  async function handleExit() {
    await onBeforeExit();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  async function handleDelete() {
    await deleteStickyNote(note.id);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  function handleColorChange(hex: string) {
    setTopBarColor(hex);
    void updateStickyNote(note.id, { topBarColor: hex });
  }

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1 px-2"
      style={{ background: topBarColor ?? "var(--primary)" }}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary-foreground">
        {title || "Untitled"}
      </span>

      {focused && (
        <div className="flex shrink-0 items-center gap-0.5">
          <TopBarBtn tip={pinned ? "Unpin" : "Pin on top"} active={pinned} onClick={togglePinned}>
            {pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
          </TopBarBtn>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-primary-foreground hover:bg-black/10 hover:text-primary-foreground"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette className="mr-2 h-4 w-4" />
                  Change top bar color
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="space-y-2 p-2">
                  <HexAlphaColorPicker
                    color={topBarColor ?? defaultColorHex}
                    onChange={handleColorChange}
                  />
                  <HexColorInput
                    prefixed
                    alpha
                    color={topBarColor ?? defaultColorHex}
                    onChange={handleColorChange}
                    className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TopBarBtn tip="Close" onClick={handleExit}>
            <X className="h-3.5 w-3.5" />
          </TopBarBtn>
        </div>
      )}
    </div>
  );
}
