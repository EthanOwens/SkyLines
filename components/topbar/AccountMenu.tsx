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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthContext } from "@/components/AuthProvider";
import { useAppStore } from "@/stores/appStore";
import { applyTheme, clearThemeOverrides } from "@/lib/themes/apply";
import { setSelectedThemeId as persistSelectedThemeId } from "@/lib/themes/selection";
import { LogOut, Palette, Cloud, CloudOff, Loader2, CheckCircle2 } from "lucide-react";

// "Default" sentinel for the theme radio group - base-ui's RadioGroup value
// must be a real string (not `null`), so the store's `selectedThemeId ===
// null` ("no theme applied") is represented here as this sentinel and
// translated back to `null` in the change handler below. Exported so
// AppShell.tsx's theme-merge effect can filter out any user theme file that
// happens to reuse this reserved id (which would otherwise collide with the
// "Default" radio item and make the user's theme unreachable) using the
// same single source of truth rather than a second hardcoded copy.
export const DEFAULT_THEME_VALUE = "__default__";

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
  const availableThemes = useAppStore((s) => s.availableThemes);
  const selectedThemeId = useAppStore((s) => s.selectedThemeId);
  const setSelectedThemeId = useAppStore((s) => s.setSelectedThemeId);

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

  // Theme picker (spec.md subtask 19): applies the selection immediately
  // (clear any prior overrides first so switching to a theme that overrides
  // fewer variables than the last one doesn't leave stale inline properties
  // behind - see lib/themes/apply.ts's clearThemeOverrides docs) and
  // persists the choice to localStorage.
  function handleThemeChange(value: string) {
    if (value === DEFAULT_THEME_VALUE) {
      clearThemeOverrides();
      persistSelectedThemeId(null);
      setSelectedThemeId(null);
      return;
    }

    const theme = availableThemes.find((t) => t.id === value);
    if (!theme) return;

    clearThemeOverrides();
    applyTheme(theme);
    persistSelectedThemeId(theme.id);
    setSelectedThemeId(theme.id);
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={selectedThemeId ?? DEFAULT_THEME_VALUE}
              onValueChange={handleThemeChange}
            >
              <DropdownMenuRadioItem value={DEFAULT_THEME_VALUE}>
                Default
              </DropdownMenuRadioItem>
              {availableThemes.map((theme) => (
                <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                  {theme.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
