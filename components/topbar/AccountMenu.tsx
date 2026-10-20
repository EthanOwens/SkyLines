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

// The "System" theme: applies the light or dark theme to match the OS and keeps
// following it. Stored as this sentinel rather than null so the effect below
// can tell it apart from an explicit theme. Exported so AppShell can drop user
// themes that reuse the id.
export const SYSTEM_THEME_VALUE = "__system__";

// Only mounts for a signed-in user inside the app shell, so the only account
// action is Sign out. The engine doesn't track a last-synced time, so sync
// status is shown as a label.
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
  const syncFailures = useAppStore((s) => s.syncFailures);
  const availableThemes = useAppStore((s) => s.availableThemes);
  const selectedThemeId = useAppStore((s) => s.selectedThemeId);
  const setSelectedThemeId = useAppStore((s) => s.setSelectedThemeId);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  // Follows OS light/dark changes while "System" is selected; the cleanup
  // removes the listener on any other selection. Placed above the early return
  // because hooks must always run.
  //
  // null counts as "System" too: it's the initial store value, and the radio
  // group already shows it as "System".
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
  const firstFailure = syncFailures[0];
  const statusLabel = firstFailure
    ? `Couldn't sync: ${firstFailure.name || "Untitled"} (${firstFailure.reason === "too-big" ? "too big" : "rejected"})` +
      (syncFailures.length > 1 ? ` and ${syncFailures.length - 1} more` : "")
    : statusInfo.label;

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  // Clear old overrides first, so a theme that sets fewer variables doesn't
  // leave stale ones behind. "System" stores the sentinel so the effect above
  // keeps it in sync with the OS.
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
            {statusLabel}
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
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            SkyLines v{process.env.NEXT_PUBLIC_APP_VERSION} ({process.env.NEXT_PUBLIC_BUILD_COMMIT})
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeEditor open={themeEditorOpen} onOpenChange={setThemeEditorOpen} />
    </>
  );
}
