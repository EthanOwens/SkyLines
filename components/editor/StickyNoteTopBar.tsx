"use client";

// spec.md subtask 9 ("Sticky note top bar"). Renders above the title/editor
// content in StickyNoteEditor.tsx. Chrome: Pin (real OS-level always-on-top,
// over the whole desktop per spec.md's explicit decision -
// `Window.setAlwaysOnTop`, not scoped to this app's own windows), Exit
// (autosave via the caller's `onBeforeExit`, then close this window), and a
// 3-dot menu with Delete and "Change top bar color".
//
// The button row only renders while the OS window is focused (`focused`
// prop). The actual window-focus tracking (a real Tauri
// `Window.onFocusChanged` listener, NOT a DOM focus/blur event - which only
// fires for a specific focusable element, not the whole OS window) lives in
// StickyNoteEditor.tsx, shared with StickyNoteBottomBar.tsx (spec.md
// subtask 10) rather than each bar subscribing to the same Tauri event
// separately.
//
// spec.md subtask 3: losing OS focus no longer resizes the window - instead
// this bar just slims down (height/padding transition) while unfocused, and
// StickyNoteBottomBar fades out. Actually resizing the window down to
// COLLAPSED_HEIGHT is now a manual, independent `collapsed` toggle fired by
// double-clicking this bar's root div (`onToggleCollapsed`), owned by
// StickyNoteEditor.tsx alongside the focus tracking above.
//
// All @tauri-apps/api imports are dynamic (inside effects/handlers), matching
// lib/stickyWindow.ts's existing convention - these APIs assume a live Tauri
// runtime that isn't present at Next.js static-export build/prerender time.

import { useEffect, useState } from "react";
import { Pin, PinOff, X, Minus, MoreVertical, Trash2, Palette } from "lucide-react";
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

// Matches lib/themes/color.ts's own fallback - shown only until the
// `--primary` lookup effect below resolves.
const FALLBACK_PICKER_HEX = "#000000ff";

interface Props {
  note: StickyNote;
  /** Live title (kept in sync with StickyNoteEditor's own input state, unlike the static `note` prop). */
  title: string;
  /** Whether the OS window is currently focused - owned by StickyNoteEditor.tsx (shared with StickyNoteBottomBar.tsx). */
  focused: boolean;
  /** Whether the note is manually collapsed to COLLAPSED_HEIGHT - owned by StickyNoteEditor.tsx. */
  collapsed: boolean;
  /** Toggles `collapsed`, resizing the actual OS window - owned by StickyNoteEditor.tsx. */
  onToggleCollapsed: () => void;
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

export function StickyNoteTopBar({ note, title, focused, collapsed, onToggleCollapsed, onBeforeExit }: Props) {
  const [pinned, setPinned] = useState(note.pinned);
  const [topBarColor, setTopBarColor] = useState(note.topBarColor);
  // Resolved hex for the picker's default when no custom `topBarColor` is
  // set, so it opens on the same color the `var(--primary)` CSS fallback
  // actually renders instead of a disconnected hardcoded black.
  const [defaultColorHex, setDefaultColorHex] = useState(FALLBACK_PICKER_HEX);

  useEffect(() => {
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary");
    setDefaultColorHex(themeColorToPickerHex(primary));
  }, []);

  async function togglePinned() {
    const next = !pinned;
    setPinned(next);
    void updateStickyNote(note.id, { pinned: next });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(next);
  }

  async function handleMinimize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
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
      data-tauri-drag-region
      onDoubleClick={onToggleCollapsed}
      className={`flex shrink-0 items-center gap-1 transition-all duration-200 ease-in-out ${
        focused || collapsed ? "h-10 px-2" : "h-6 px-1"
      }`}
      style={{ background: topBarColor ?? "var(--primary)" }}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary-foreground">
        {title || "Untitled"}
      </span>

      {focused && !collapsed && (
        <div className="flex shrink-0 items-center gap-0.5" onDoubleClick={(e) => e.stopPropagation()}>
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

          <TopBarBtn tip="Minimize" onClick={handleMinimize}>
            <Minus className="h-3.5 w-3.5" />
          </TopBarBtn>

          <TopBarBtn tip="Close" onClick={handleExit}>
            <X className="h-3.5 w-3.5" />
          </TopBarBtn>
        </div>
      )}
    </div>
  );
}
