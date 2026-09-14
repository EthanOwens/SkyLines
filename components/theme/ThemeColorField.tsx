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
  /** The variable's current value - already resolved by the caller from
   * draftVariables, falling back to the loaded theme's own value. */
  value: string | undefined;
  onChange: (varKey: ThemeVariableKey, value: string) => void;
}

// A single color-wheel field: a swatch button that opens a react-colorful
// wheel + a hex-alpha text input, bound to one ThemeVariableKey (spec.md M7
// subtask 15). Reused for all 30 non-`radius` keys - `radius` is a CSS
// length, not a color, and gets its own text input in ThemeEditor.tsx
// instead of this component.
export function ThemeColorField({ varKey, label, value, onChange }: ThemeColorFieldProps) {
  const pickerHex = themeColorToPickerHex(value);

  function handlePickerChange(hex: string) {
    onChange(varKey, pickerHexToThemeColor(hex));
  }

  // HexColorInput hands back a bare hex string (no leading "#" guarantee
  // issues - the component always includes it), same shape the wheel emits,
  // so it can share the same conversion path.
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
                {/* Semi-transparent overlay so the checkerboard shows
                    through variables that store an alpha < 1 (e.g. the dark
                    theme's border/input colors). */}
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
