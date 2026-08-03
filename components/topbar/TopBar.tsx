"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_VISIBILITY,
  getQuickAccessVisibility,
  setQuickAccessVisibility,
  type QuickAccessVisibility,
} from "@/lib/quickAccessPrefs";
import { ArrowLeft, ArrowRight, Redo, Settings, Undo } from "lucide-react";

// Quick access toolbar (spec.md subtask 13, "Quick access toolbar"). Full-
// width bar above Sidebar+Ribbon+content (see AppLayout.tsx), matching
// planning.md's "on the very top should be some customizable quick access
// options" description. This subtask only builds the UI shell: the 4 buttons
// render disabled (no onClick wired) since their real behavior - a back/
// forward navigation history stack (subtask 14) and undo/redo acting on
// whichever editor is focused (subtask 15) - is explicitly separate, later
// scope. The settings popover's show/hide toggling and its localStorage
// persistence (lib/quickAccessPrefs.ts) IS this subtask's job, and is fully
// real/functional.
//
// Leaves room on the right for the account icon (subtask 16) via a plain
// `justify-between` split rather than building anything there now.

type QuickAccessKey = keyof QuickAccessVisibility;

const QUICK_ACCESS_ITEMS: {
  key: QuickAccessKey;
  label: string;
  icon: typeof ArrowLeft;
}[] = [
  { key: "back", label: "Back", icon: ArrowLeft },
  { key: "forward", label: "Forward", icon: ArrowRight },
  { key: "undo", label: "Undo", icon: Undo },
  { key: "redo", label: "Redo", icon: Redo },
];

export function TopBar() {
  // Initialized to the same default the static-export build-time render
  // produces (`window` is undefined at build time, so
  // getQuickAccessVisibility() would return DEFAULT_VISIBILITY anyway), then
  // re-read from localStorage only after mounting in the browser. This
  // matches lib/lastOpen.ts consumers' established pattern elsewhere in this
  // app and avoids a hydration mismatch: calling getQuickAccessVisibility()
  // eagerly in useState's initializer would make the very first client
  // render reflect the user's stored prefs, which can differ from the
  // baked-in static HTML.
  const [visibility, setVisibility] = useState<QuickAccessVisibility>(DEFAULT_VISIBILITY);

  useEffect(() => {
    setVisibility(getQuickAccessVisibility());
  }, []);

  function toggle(key: QuickAccessKey) {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setQuickAccessVisibility(next);
      return next;
    });
  }

  const visibleItems = QUICK_ACCESS_ITEMS.filter((item) => visibility[item.key]);

  return (
    <div className="flex h-10 w-full items-center justify-between border-b border-border bg-background px-2">
      <div className="flex items-center gap-0.5">
        {visibleItems.map((item) => (
          <Tooltip key={item.key}>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled
                    tabIndex={-1}
                  >
                    <item.icon className="h-4 w-4" />
                  </Button>
                </span>
              }
            />
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Settings className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Quick access toolbar</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {QUICK_ACCESS_ITEMS.map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.key}
                  checked={visibility[item.key]}
                  onCheckedChange={() => toggle(item.key)}
                >
                  {item.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Reserved for the account icon (spec.md subtask 16) - intentionally
          empty for now. */}
      <div />
    </div>
  );
}
