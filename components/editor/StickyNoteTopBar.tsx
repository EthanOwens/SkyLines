"use client";

// Top bar for a sticky note window: Pin (OS-level always on top, over the whole
// desktop), Exit, and a menu with Delete and the bar color. Buttons show only
// while the window is focused; it slims down when unfocused, and
// double-clicking it collapses the window.
//
// Tauri APIs are imported dynamically because no Tauri runtime exists during
// the static export build.

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
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { StickyNote } from "@/types";

// Shown only until the --primary lookup resolves.
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
  // Resolved --primary, so the picker opens on the color the bar actually shows
  // when no custom color is set.
  const [defaultColorHex, setDefaultColorHex] = useState(FALLBACK_PICKER_HEX);
  const windowDrag = useWindowDrag();

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
      {...windowDrag}
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
