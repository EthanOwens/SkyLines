"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { useAppStore, type NoteHistoryEntry } from "@/stores/appStore";
import { ArrowLeft, ArrowRight, Redo, Settings, Undo } from "lucide-react";

// Quick access toolbar (spec.md subtask 13, "Quick access toolbar"). Full-
// width bar above Sidebar+Ribbon+content (see AppLayout.tsx), matching
// planning.md's "on the very top should be some customizable quick access
// options" description. Back/Forward (spec.md subtask 14) are wired to the
// note-visit history stack in stores/appStore.ts. Undo/Redo still render
// disabled (no onClick wired) - their real behavior, acting on whichever
// editor is focused, is subtask 15's separate, later scope. The settings
// popover's show/hide toggling and its localStorage persistence
// (lib/quickAccessPrefs.ts) is fully real/functional.
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
  const router = useRouter();
  const noteHistory = useAppStore((s) => s.noteHistory);
  const historyIndex = useAppStore((s) => s.historyIndex);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);
  const setIsHistoryNavigation = useAppStore((s) => s.setIsHistoryNavigation);

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

  // Navigates to a history-stack entry (spec.md subtask 14). Sets
  // `isHistoryNavigation` immediately before router.push() so the
  // note/canvas page's load effect knows to skip re-pushing a visit -
  // goBack()/goForward() already moved `historyIndex` to the right place.
  function navigateToEntry(entry: NoteHistoryEntry) {
    setIsHistoryNavigation(true);
    const dest = entry.type === "canvas" ? "/canvas" : "/note";
    router.push(`${dest}?id=${entry.noteId}`);
  }

  function handleBack() {
    const entry = goBack();
    if (entry) navigateToEntry(entry);
  }

  function handleForward() {
    const entry = goForward();
    if (entry) navigateToEntry(entry);
  }

  // Back/Forward (subtask 14) are enabled based on whether there's actually
  // somewhere in the stack to go; Undo/Redo (subtask 15, not this subtask's
  // scope) stay hardcoded disabled.
  const disabledByKey: Record<QuickAccessKey, boolean> = {
    back: historyIndex <= 0,
    forward: historyIndex >= noteHistory.length - 1,
    undo: true,
    redo: true,
  };
  const onClickByKey: Partial<Record<QuickAccessKey, () => void>> = {
    back: handleBack,
    forward: handleForward,
  };

  const visibleItems = QUICK_ACCESS_ITEMS.filter((item) => visibility[item.key]);

  return (
    <div className="flex h-10 w-full items-center justify-between border-b border-border bg-background px-2">
      <div className="flex items-center gap-0.5">
        {visibleItems.map((item) => {
          const disabled = disabledByKey[item.key];
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={disabled}
                      tabIndex={disabled ? -1 : 0}
                      onClick={onClickByKey[item.key]}
                    >
                      <item.icon className="h-4 w-4" />
                    </Button>
                  </span>
                }
              />
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          );
        })}

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
