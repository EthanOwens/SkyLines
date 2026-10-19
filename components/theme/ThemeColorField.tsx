"use client";

import { useRef, type FocusEvent, type MouseEvent } from "react";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pickerHexToThemeColor, themeColorToPickerHex } from "@/lib/themes/color";
import type { ThemeVariableKey } from "@/lib/themes/types";

export type SettingHighlightChange = (varKey: ThemeVariableKey, active: boolean) => void;

// Clicking a control focuses it too, so only :focus-visible counts as focus;
// otherwise a clicked row would stay highlighted after the mouse leaves.
function rowHasKeyboardFocus(row: HTMLElement): boolean {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && row.contains(focused) && focused.matches(":focus-visible");
}

// Handlers for a setting row: hover or keyboard focus highlights the setting in
// the preview. isPinned keeps it highlighted (for example while a popup that
// lives outside the row is open).
export function settingRowHighlightHandlers(
  varKey: ThemeVariableKey,
  onHighlightChange: SettingHighlightChange,
  isPinned: () => boolean = () => false,
) {
  return {
    onMouseEnter: () => onHighlightChange(varKey, true),
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      if (!isPinned() && !rowHasKeyboardFocus(e.currentTarget)) {
        onHighlightChange(varKey, false);
      }
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target.matches(":focus-visible")) onHighlightChange(varKey, true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!isPinned() && !e.currentTarget.matches(":hover")) {
        onHighlightChange(varKey, false);
      }
    },
  };
}

// Info icon whose tooltip shows a setting's description. The visually hidden
// copy carries descriptionId, because the tooltip popup only exists while open
// and the row's control still needs something for aria-describedby to point at.
export function SettingInfo({
  label,
  description,
  descriptionId,
}: {
  label: string;
  description: string;
  descriptionId: string;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`About ${label}`}
              className="inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
    </>
  );
}

interface ThemeColorFieldProps {
  varKey: ThemeVariableKey;
  label: string;
  description: string;
  /** Already resolved by the caller (draft value, else the theme's own). */
  value: string | undefined;
  onChange: (varKey: ThemeVariableKey, value: string) => void;
  onHighlightChange: SettingHighlightChange;
}

// Color wheel plus hex-alpha input for one theme variable. radius isn't a color
// and has its own control in ThemeEditor.
export function ThemeColorField({
  varKey,
  label,
  description,
  value,
  onChange,
  onHighlightChange,
}: ThemeColorFieldProps) {
  const descriptionId = `theme-editor-${varKey}-description`;
  const pickerHex = themeColorToPickerHex(value);

  const rowRef = useRef<HTMLDivElement>(null);
  // Pins the highlight while the picker is open: its popup is portalled outside
  // the row, so moving into it would otherwise count as leaving the row.
  const pickerOpenRef = useRef(false);

  function handlePickerOpenChange(open: boolean) {
    pickerOpenRef.current = open;
    const row = rowRef.current;
    if (!open && row && !row.matches(":hover") && !rowHasKeyboardFocus(row)) {
      onHighlightChange(varKey, false);
    }
  }

  function handlePickerChange(hex: string) {
    onChange(varKey, pickerHexToThemeColor(hex));
  }

  function handleHexInputChange(hex: string) {
    onChange(varKey, pickerHexToThemeColor(hex));
  }

  return (
    <div
      ref={rowRef}
      className="flex items-center justify-between gap-2 py-1"
      {...settingRowHighlightHandlers(varKey, onHighlightChange, () => pickerOpenRef.current)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <label className="truncate text-xs text-sidebar-foreground" title={label}>
          {label}
        </label>
        <SettingInfo label={label} description={description} descriptionId={descriptionId} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DropdownMenu onOpenChange={handlePickerOpenChange}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${label} color`}
                aria-describedby={descriptionId}
                className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md border border-border shadow-sm"
                style={{
                  backgroundImage:
                    "conic-gradient(#ccc 0.25turn, #fff 0.25turn 0.5turn, #ccc 0.5turn 0.75turn, #fff 0.75turn)",
                  backgroundSize: "8px 8px",
                }}
              >
                {/* Lets the checkerboard show through colors with alpha below 1. */}
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: pickerHex }}
                />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto min-w-0 space-y-2 p-2">
            <HexAlphaColorPicker color={pickerHex} onChange={handlePickerChange} />
            <HexColorInput
              prefixed
              alpha
              color={pickerHex}
              onChange={handleHexInputChange}
              className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
