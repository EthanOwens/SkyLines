"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthContext } from "@/components/AuthProvider";
import { useAppStore } from "@/stores/appStore";
import { LogOut, Settings, Cloud, CloudOff, Loader2, CheckCircle2 } from "lucide-react";

// Account icon + dropdown (spec.md subtask 16). Rendered into TopBar.tsx's
// previously-empty right-side slot. This component only ever mounts inside
// AppLayout.tsx's authenticated shell (it's gated on both a selected
// notebook AND a real `user`), so there's no reachable state where this
// dropdown renders while signed out - a "login" action here would be dead
// UI, which is why only "Sign out" is offered (matching the spec's actual
// intent: surface account actions for the currently-signed-in user).
//
// Sync-status line reflects the same `syncStatus` enum Sidebar.tsx's
// SyncBadge already renders live (wired via hooks/useSyncEngine.ts) - kept
// as a human-readable label rather than a precise last-synced-at timestamp,
// since lib/sync/engine.ts doesn't track one and touching its core logic to
// add one is explicitly out of scope for this subtask.
const SYNC_STATUS_DISPLAY: Record<
  string,
  { label: string; icon: typeof Cloud; className: string }
> = {
  syncing: { label: "Syncing…", icon: Loader2, className: "animate-spin text-muted-foreground" },
  offline: { label: "Offline", icon: CloudOff, className: "text-yellow-500" },
  error: { label: "Sync error", icon: Cloud, className: "text-destructive" },
  saved: { label: "Synced", icon: CheckCircle2, className: "text-green-500" },
};

export function AccountMenu() {
  const router = useRouter();
  const { user } = useAuthContext();
  const syncStatus = useAppStore((s) => s.syncStatus);

  if (!user) return null;

  const displayName = user.displayName?.trim();
  const initialSource = displayName || user.email || "?";
  const initial = initialSource.charAt(0).toUpperCase();

  const statusInfo = SYNC_STATUS_DISPLAY[syncStatus] ?? SYNC_STATUS_DISPLAY.saved;
  const StatusIcon = statusInfo.icon;

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90"
          >
            {initial}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            {displayName || user.email}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {user.email}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          <StatusIcon className={`mr-2 h-3 w-3 ${statusInfo.className}`} />
          {statusInfo.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
