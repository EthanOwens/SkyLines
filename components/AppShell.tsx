"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/components/AuthProvider";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useNotes } from "@/hooks/useNotes";
import { useFolders } from "@/hooks/useFolders";
import { useNotebooks } from "@/hooks/useNotebooks";
import { getLastOpen } from "@/lib/lastOpen";
import { getNoteById } from "@/lib/db/notes";
import { useAppStore } from "@/stores/appStore";
import { AppLayout } from "@/components/shell/AppLayout";
import { getSelectedThemeId } from "@/lib/themes/selection";
import { applyTheme, clearThemeOverrides } from "@/lib/themes/apply";
import { loadThemes } from "@/lib/themes/loader";
import { BUILTIN_THEMES } from "@/lib/themes/builtin";
import { getSystemTheme } from "@/lib/themes/system";
import { SYSTEM_THEME_VALUE } from "@/components/topbar/AccountMenu";

// New (spec.md subtask 4, "Root app shell"): the actual gatekeeper wiring
// AuthProvider + the sync engine + the data hooks into real app lifecycle,
// closing the "no app shell exists" gap noted throughout this project's
// history. Split out from app/layout.tsx (a server component that can't
// itself call hooks) as its own client component, nested inside
// <AuthProvider><TooltipProvider> there.
//
// Public routes that must never be force-redirected to /login: the
// login/register pages themselves, and every /spike-* throwaway
// verification harness, which manages its own inline sign-in flow and is
// relied on by every future subtask in this dev-loop run for CDP-driven
// verification (see this subtask's brief).
const PUBLIC_ROUTES = ["/login", "/register"];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  // next.config.ts sets `trailingSlash: true` (required for the static
  // export Tauri loads), so `usePathname()` returns e.g. "/register/" with
  // a trailing slash, not "/register" - strip it (except for the root "/")
  // before matching so this doesn't false-negative on the trailing-slash
  // form and incorrectly redirect an exempt route away to /login.
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (PUBLIC_ROUTES.includes(normalized)) return true;
  return normalized.startsWith("/spike-");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);
  const notebooks = useAppStore((s) => s.notebooks);
  const notebooksLoaded = useAppStore((s) => s.notebooksLoaded);
  const setAvailableThemes = useAppStore((s) => s.setAvailableThemes);
  const setUserThemesLoaded = useAppStore((s) => s.setUserThemesLoaded);
  const setSelectedThemeId = useAppStore((s) => s.setSelectedThemeId);

  const publicRoute = isPublicRoute(pathname);
  // Same trailing-slash normalization as isPublicRoute above (next.config.ts
  // sets trailingSlash: true for the static export).
  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const isRootRoute = normalizedPathname === "/";
  // Narrower than `publicRoute` (which also covers /login and /register) -
  // the theme-restore effect below must stay off of every /spike-* CDP
  // verification harness (including app/spike-themes/page.tsx itself, whose
  // own checks assume a clean/default baseline before its buttons are
  // clicked), but there's no reason to also withhold theming from /login or
  // /register, so this is deliberately its own check rather than reusing
  // `publicRoute`.
  const isSpikeRoute = normalizedPathname?.startsWith("/spike-") ?? false;

  // spec.md subtask 8 ("Sticky note pop-out window"): the sticky note route
  // only ever loads inside its own dedicated pop-out Tauri window (see
  // lib/stickyWindow.ts), never inside the main window's sidebar/ribbon
  // shell - still auth-gated like every other real route, but rendered
  // without AppLayout below.
  const isStickyRoute = normalizedPathname === "/sticky";

  // spec.md subtask 12 ("Image editor pop-out shell"). Same reasoning as
  // isStickyRoute above - this route only ever loads inside its own
  // dedicated pop-out Tauri window (see lib/imageEditorWindow.ts), never
  // inside the main window's sidebar/ribbon shell.
  const isImageEditorRoute = normalizedPathname === "/image-editor";

  // Only wire the real signed-in user's uid into these hooks off of public
  // routes. Spike routes sign in with real Firebase accounts and drive the
  // sync engine / push logic manually to test it in isolation; since
  // Firebase Auth is a global singleton, AppShell would otherwise pick up
  // that same user and auto-start a second competing sync engine instance
  // (lib/sync/engine.ts's startSyncEngine is a module-level singleton),
  // racing with and clobbering the spike harness's own manual control.
  // Passing `undefined` makes each hook no-op per its own `if (!userId)
  // return;` guard. Also excluded on `isStickyRoute`/`isImageEditorRoute`:
  // each Tauri WebviewWindow is its own JS runtime, so either pop-out would
  // otherwise boot a second, fully independent sync engine plus live
  // notes/folders/notebooks subscriptions neither StickyNoteEditor.tsx nor
  // ImageEditor.tsx reads.
  const syncUserId =
    publicRoute || isStickyRoute || isImageEditorRoute ? undefined : user?.uid;

  useSyncEngine(syncUserId);
  useNotes(syncUserId);
  useFolders(syncUserId);
  useNotebooks(syncUserId);

  const shouldRedirect = !loading && !user && !publicRoute;

  useEffect(() => {
    if (shouldRedirect) router.replace("/login");
  }, [shouldRedirect, router]);

  // Theme restore (spec.md subtask 19, "Theme picker"; extended by subtask
  // 11 for "System"). Runs once on mount, independent of auth/user - the
  // persisted theme choice is per-device UI state (like lastOpen.ts/
  // quickAccessPrefs.ts), not user data, so there's no reason to gate it on
  // a signed-in user. It IS gated on `isSpikeRoute`, though:
  // applyTheme()/clearThemeOverrides() mutate document.documentElement's
  // inline styles globally, so letting this run on a /spike-* harness would
  // silently reapply a previous session's theme choice there, breaking those
  // harnesses' assumption of a clean/default baseline (see isSpikeRoute's
  // comment above). If the persisted id is SYSTEM_THEME_VALUE or matches a
  // built-in theme, apply it immediately (synchronously available, no disk
  // I/O) to minimize any flash of default styling before this effect even
  // runs React's commit phase. Then asynchronously load user themes, merge
  // them into `availableThemes`, and if the persisted id turns out to match
  // a *user* theme (not found among built-ins or "System"), apply it once
  // that load resolves. If the persisted id matches nothing at all (deleted
  // user theme file, corrupted localStorage, etc.), fall back to no override
  // applied rather than leaving a stale/partial override active.
  useEffect(() => {
    if (isSpikeRoute) return;

    const persistedId = getSelectedThemeId();

    if (persistedId === SYSTEM_THEME_VALUE || !persistedId) {
      // "System" (spec.md subtask 11): re-evaluate the OS's *current*
      // preference on every restore rather than replaying whatever it was
      // when the user first selected "System" - applyTheme() below always
      // reads the live matchMedia state via getSystemTheme(), and
      // AccountMenu.tsx's own matchMedia listener picks up from here once it
      // mounts (gated on `selectedThemeId === SYSTEM_THEME_VALUE`, set here).
      //
      // A falsy `persistedId` (nothing ever persisted - e.g. a brand-new
      // user who has never opened the theme dropdown) is treated the same
      // as an explicit System selection rather than left as untracked
      // `null`/no-override state: the store's initial `selectedThemeId` is
      // `null`, which AccountMenu.tsx's radio group already displays as
      // "System" checked, so this makes that displayed selection actually
      // true (live OS-synced) and persists it explicitly going forward so
      // this same gap doesn't silently recur on every future reload.
      clearThemeOverrides();
      applyTheme(getSystemTheme());
      setSelectedThemeId(SYSTEM_THEME_VALUE);
    } else if (persistedId) {
      const builtin = BUILTIN_THEMES.find((t) => t.id === persistedId);
      if (builtin) {
        clearThemeOverrides();
        applyTheme(builtin);
        setSelectedThemeId(builtin.id);
      }
    }

    let cancelled = false;

    void loadThemes()
      .then(({ themes: userThemes }) => {
        if (cancelled) return;
        // Exclude any user theme whose id collides with either the reserved
        // "__system__" sentinel (AccountMenu.tsx's SYSTEM_THEME_VALUE,
        // which lib/themes/types.ts's isTheme() doesn't itself reject) or a
        // built-in theme's id - either collision would give the radio group
        // two items sharing the same `value`, permanently hiding the user
        // theme behind whichever entry wins the `.find()` lookup, with no
        // error surfaced. Treated the same as any other unusable theme file
        // (silently excluded), matching lib/themes/loader.ts's own handling.
        const usableUserThemes = userThemes.filter(
          (t) => t.id !== SYSTEM_THEME_VALUE && !BUILTIN_THEMES.some((b) => b.id === t.id),
        );
        setAvailableThemes([...BUILTIN_THEMES, ...usableUserThemes]);
        setUserThemesLoaded(true);

        if (!persistedId) return;
        const alreadyBuiltin = BUILTIN_THEMES.some((t) => t.id === persistedId);
        if (alreadyBuiltin) return;

        const userTheme = usableUserThemes.find((t) => t.id === persistedId);
        if (userTheme) {
          clearThemeOverrides();
          applyTheme(userTheme);
          setSelectedThemeId(userTheme.id);
        }
        // Otherwise the persisted id matches neither a built-in nor a user
        // theme (deleted file / corrupted state) - leave Default applied,
        // matching the "no theme applied" state this effect started in.
      })
      .catch(() => {
        // loadThemes() itself never throws per-file (see lib/themes/loader.ts),
        // but disk I/O (e.g. appConfigDir()) could still fail in principle -
        // fall back to built-ins only rather than leaving availableThemes
        // stuck in a half-loaded state.
        if (!cancelled) setUserThemesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isSpikeRoute, setAvailableThemes, setUserThemesLoaded, setSelectedThemeId]);

  // Last-open restore (spec.md subtask 5, extended by subtask 6 "Notebook
  // picker"): once the user is authenticated and landed on the root route
  // (not deep-linked to a specific note/canvas or a /spike-* harness), check
  // for a remembered last-open note and jump straight to it if it still
  // exists. If there's no stored note (either nothing stored at all, or a
  // stored state with `noteId: null` - the "notebook open, no note yet"
  // state the picker itself produces), this falls through to restoring just
  // the notebook selection into the store instead, so app/page.tsx's picker
  // can render the "notebook open" confirmation directly rather than
  // re-showing an already-answered picker. If the notebook was deleted, or
  // nothing at all is stored, the user is left on "/" with the picker's
  // empty state, which the notebook picker (spec.md subtask 6) renders.
  useEffect(() => {
    if (loading || !user || !isRootRoute) return;

    let cancelled = false;

    const lastOpen = getLastOpen();
    if (!lastOpen) return;

    if (!lastOpen.noteId) {
      if (lastOpen.notebookId) setSelectedNotebook(lastOpen.notebookId);
      return;
    }

    void getNoteById(lastOpen.noteId).then((note) => {
      if (cancelled || !note) return;
      // Set selectedNotebookId from the note's own `notebookId` (subtask 7's
      // migration 4 column), not `lastOpen.notebookId` - the latter is null
      // for the common case of a folder-less/root-level note (see
      // lib/lastOpen.ts's recordNoteOpened), which would otherwise leave
      // AppLayout's sidebar+ribbon shell (spec.md subtask 8) un-rendered on
      // a fresh app launch that restores straight into a note.
      //
      // Validate against the live `notebooks` array first (mirrors
      // app/page.tsx's own `selectedNotebook = notebooks.find(...)`
      // fallback) - `note.notebookId` can point at a notebook that no
      // longer exists (e.g. deleted on another device, or a stale
      // folder-less note left behind by deleteNotebook's cascade in
      // lib/db/notebooks.ts), and blindly setting it would scope
      // AppLayout's sidebar/ribbon to a dead notebook id with no visible
      // error. If `notebooks` hasn't loaded yet, it's not yet safe to
      // conclude the id is invalid, so set it optimistically rather than
      // block the restore-and-navigate flow on that fetch - the picker's
      // own safety net still applies if the user ever lands back on "/".
      const notebookIsValid =
        note.notebookId === null ||
        !notebooksLoaded ||
        notebooks.some((n) => n.id === note.notebookId);
      setSelectedNotebook(notebookIsValid ? note.notebookId : null);
      // spec.md subtask 6: every note - regardless of `type` - now opens
      // through the merged free-form-canvas editor (old-format notes are
      // safely inline-migrated there, see CanvasEditor.tsx's header
      // comment), so the last-open-note restore always routes to /canvas.
      router.replace(`/canvas?id=${note.id}`);
    });

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    user,
    isRootRoute,
    router,
    setSelectedNotebook,
    notebooks,
    notebooksLoaded,
  ]);

  if (!publicRoute && (loading || shouldRedirect)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // AppLayout (spec.md subtask 8, part B) provides the persistent
  // sidebar+ribbon shell around page content once a notebook is open - but
  // only for real authenticated, non-public-route renders (the branch above
  // already handled loading/redirect, and public routes like /login and
  // every /spike-* harness manage their own full-page layout and must not
  // get the shell wrapped around them here).
  if (publicRoute || isStickyRoute || isImageEditorRoute) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
