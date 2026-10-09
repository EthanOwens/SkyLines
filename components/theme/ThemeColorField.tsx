"use client";

import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pickerHexToThemeColor, themeColorToPickerHex } from "@/lib/themes/color";
import type { ThemeVariableKey } from "@/lib/themes/types";

interface ThemeColorFieldProps {
  varKey: ThemeVariableKey;
  label: string;
  /** Already resolved by the caller (draft value, else the theme's own). */
  value: string | undefined;
  onChange: (varKey: ThemeVariableKey, value: string) => void;
}

// Color wheel plus hex-alpha input for one theme variable. radius isn't a color
// and has its own control in ThemeEditor.
export function ThemeColorField({ varKey, label, value, onChange }: ThemeColorFieldProps) {
  const pickerHex = themeColorToPickerHex(value);

  function handlePickerChange(hex: string) {
    onChange(varKey, pickerHexToThemeColor(hex));
  }

  function handleHexInputChange(hex: string) {
    onChange(varKey, pickerHexToThemeColor(hex));
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <label className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground" title={label}>
        {label}
      </label>
      <div className="flex shrink-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${label} color`}
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
