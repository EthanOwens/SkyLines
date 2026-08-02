"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Ribbon shell (spec.md subtask 8, "Ribbon shell"). Tab bar with File/Format
// always shown, and Draw shown only when the currently-open note is a canvas
// note (i.e. the route is /canvas). Each tab's real content is a separate,
// later subtask (File: 9, Format: 10, Draw: 12) - this only builds the shell
// and tab-switching, per this subtask's explicit scope.

type RibbonTab = "file" | "format" | "draw";

// Same trailing-slash normalization AppShell.tsx uses for its own route
// checks (next.config.ts sets `trailingSlash: true` for the static export
// Tauri loads, so usePathname() returns e.g. "/canvas/" not "/canvas").
function normalizePathname(pathname: string | null): string | null {
  if (!pathname) return pathname;
  return pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
}

export function Ribbon() {
  const pathname = usePathname();
  const normalizedPathname = normalizePathname(pathname);
  const isCanvasRoute = normalizedPathname === "/canvas";

  const [activeTab, setActiveTab] = useState<RibbonTab>("file");

  // If the Draw tab is currently active and the route navigates away from
  // /canvas (e.g. the user opens a plain note), fall back to File rather
  // than leaving an unreachable tab selected with no button to reach it.
  const effectiveTab = activeTab === "draw" && !isCanvasRoute ? "file" : activeTab;

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: "file", label: "File" },
    { id: "format", label: "Format" },
    ...(isCanvasRoute ? ([{ id: "draw", label: "Draw" }] as const) : []),
  ];

  return (
    <div className="flex h-24 flex-col border-b border-border bg-background">
      <div className="flex h-9 items-center gap-1 border-b border-border px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-t-md px-3 py-1 text-sm transition-colors",
              effectiveTab === tab.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 px-3 py-2 text-sm text-muted-foreground">
        {effectiveTab === "file" && <div>File tab — coming in subtask 9</div>}
        {effectiveTab === "format" && <div>Format tab — coming in subtask 10</div>}
        {effectiveTab === "draw" && <div>Draw tab — coming in subtask 12</div>}
      </div>
    </div>
  );
}
