"use client";

import { useEffect, useState } from "react";
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
import { getSystemTheme, watchSystemThemeChanges } from "@/lib/themes/system";
import { ThemeEditor } from "@/components/theme/ThemeEditor";
import { LogOut, Palette, Cloud, CloudOff, Loader2, CheckCircle2 } from "lucide-react";

// "System" sentinel for the theme radio group (spec.md subtask 11, "Rename
// 'Default' theme to 'System'" - formerly `DEFAULT_THEME_VALUE`/"Default",
// which just cleared theme overrides). Selecting it now applies
// `LIGHT_THEME`/`DARK_THEME` based on the OS's live `prefers-color-scheme`
// setting and stores this sentinel (not `null`) as `selectedThemeId`, so a
// dedicated effect below can tell "System is the active selection" apart
// from "an explicit theme is active" and gate its `matchMedia` listener
// accordingly. Exported so AppShell.tsx's theme-merge effect can filter out
// any user theme file that happens to reuse this reserved id (which would
// otherwise collide with the "System" radio item and make the user's theme
// unreachable) using the same single source of truth rather than a second
// hardcoded copy.
export const SYSTEM_THEME_VALUE = "__system__";

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
  // Open/closed state for the Theme Editor (spec.md M7 subtask 12), kept
  // local to this component since no other part of the app needs to read or
  // trigger it - it's opened solely from the "Edit themes..." item below.
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  // Keeps "System" dynamically in sync with the OS while it remains the
  // active selection (spec.md subtask 11's key decision: a live
  // `matchMedia` listener, not a one-time read at selection time). Gated on
  // `selectedThemeId === SYSTEM_THEME_VALUE` so the listener is torn down
  // (via this effect's cleanup) the moment the user switches to a different,
  // explicit theme - re-running this effect on every `selectedThemeId`
  // change naturally removes the old listener before any new one is
  // attached, so there's never more than one live listener, and none at all
  // once "System" is no longer selected or this component unmounts. Placed
  // above the `if (!user) return null` guard below since hooks must run
  // unconditionally on every render.
  //
  // `null` is also treated as "System" here (not just SYSTEM_THEME_VALUE):
  // `null` is the store's actual initial value (stores/appStore.ts) for any
  // user who has never touched the theme picker, and the radio group below
  // already renders it as "System" checked (`value={selectedThemeId ??
  // SYSTEM_THEME_VALUE}`) - without this, that visual selection would be a
  // lie, since neither the live matchMedia listener nor the initial
  // getSystemTheme() application would ever run for that state.
  useEffect(() => {
    if (selectedThemeId !== SYSTEM_THEME_VALUE && selectedThemeId !== null) return;

    const mql = watchSystemThemeChanges();
    if (!mql) return;

    function handleOSPreferenceChange() {
      clearThemeOverrides();
      applyTheme(getSystemTheme());
    }

    mql.addEventListener("change", handleOSPreferenceChange);
    return () => {
      mql.removeEventListener("change", handleOSPreferenceChange);
    };
  }, [selectedThemeId]);

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
  //
  // "System" (spec.md subtask 11) applies whichever of LIGHT_THEME/
  // DARK_THEME currently matches the OS's `prefers-color-scheme` setting,
  // and persists/stores SYSTEM_THEME_VALUE itself (not `null`) so the effect
  // below can recognize "System is active" and keep it live-synced.
  function handleThemeChange(value: string) {
    if (value === SYSTEM_THEME_VALUE) {
      clearThemeOverrides();
      applyTheme(getSystemTheme());
      persistSelectedThemeId(SYSTEM_THEME_VALUE);
      setSelectedThemeId(SYSTEM_THEME_VALUE);
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
    <>
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
                value={selectedThemeId ?? SYSTEM_THEME_VALUE}
                onValueChange={handleThemeChange}
              >
                <DropdownMenuRadioItem value={SYSTEM_THEME_VALUE}>
                  System
                </DropdownMenuRadioItem>
                {availableThemes.map((theme) => (
                  <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                    {theme.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setThemeEditorOpen(true)}>
                Edit themes...
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeEditor open={themeEditorOpen} onOpenChange={setThemeEditorOpen} />
    </>
  );
}
