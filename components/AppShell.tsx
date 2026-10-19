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
import { listenForReferenceFollows } from "@/lib/references/navigate";
import { useAppStore } from "@/stores/appStore";
import { AppLayout } from "@/components/shell/AppLayout";
import { getSelectedThemeId } from "@/lib/themes/selection";
import { applyTheme, clearThemeOverrides } from "@/lib/themes/apply";
import { loadThemes } from "@/lib/themes/loader";
import { BUILTIN_THEMES } from "@/lib/themes/builtin";
import { getSystemTheme } from "@/lib/themes/system";
import { SYSTEM_THEME_VALUE } from "@/components/topbar/AccountMenu";

// Wires auth, the sync engine and the data hooks into the app lifecycle. It's a
// client component because app/layout.tsx is a server component.
//
// Public routes are never redirected to /login.
const PUBLIC_ROUTES = ["/login", "/register"];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  // trailingSlash: true makes usePathname() return "/register/", so strip the
  // slash before matching.
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return PUBLIC_ROUTES.includes(normalized);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);
  const setSelectedFolder = useAppStore((s) => s.setSelectedFolder);
  const notebooks = useAppStore((s) => s.notebooks);
  const notebooksLoaded = useAppStore((s) => s.notebooksLoaded);
  const setAvailableThemes = useAppStore((s) => s.setAvailableThemes);
  const setUserThemesLoaded = useAppStore((s) => s.setUserThemesLoaded);
  const setSelectedThemeId = useAppStore((s) => s.setSelectedThemeId);

  const publicRoute = isPublicRoute(pathname);
  // Same trailing-slash normalization as isPublicRoute.
  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const isRootRoute = normalizedPathname === "/";

  // Sticky notes and the image editor open in their own windows: still
  // auth-gated, but rendered without AppLayout.
  const isStickyRoute = normalizedPathname === "/sticky";

  const isImageEditorRoute = normalizedPathname === "/image-editor";

  // No user id on public routes or in pop-out windows: each window is its own
  // JS runtime and would boot its own engine and subscriptions.
  const syncUserId =
    publicRoute || isStickyRoute || isImageEditorRoute ? undefined : user?.uid;

  useSyncEngine(syncUserId);
  useNotes(syncUserId);
  useFolders(syncUserId);
  useNotebooks(syncUserId);

  const shouldRedirect = !loading && !user && !publicRoute;

  // Only the main window has the app's routes, so it follows references for
  // every window, including ones clicked in sticky notes.
  const followsReferences = !!user && !publicRoute && !isStickyRoute && !isImageEditorRoute;
  useEffect(() => {
    if (!followsReferences) return;
    return listenForReferenceFollows(router);
  }, [followsReferences, router]);

  useEffect(() => {
    if (shouldRedirect) router.replace("/login");
  }, [shouldRedirect, router]);

  // Restore the saved theme on mount. It's per-device UI state, so it doesn't
  // wait for a user. Built-in themes and "System" apply immediately to avoid a
  // flash of default styling; user themes apply once they've loaded from disk.
  // An id that matches nothing leaves the default theme in place.
  useEffect(() => {
    const persistedId = getSelectedThemeId();

    if (persistedId === SYSTEM_THEME_VALUE || !persistedId) {
      // A missing saved value counts as "System", which is what the account
      // menu already shows, and is saved so the choice is explicit from now on.
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
        // Drop user themes whose id collides with "__system__" or a built-in
        // theme: duplicate radio values would hide them without any error.
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
      })
      .catch(() => {
        // Disk I/O can still fail; fall back to built-in themes only.
        if (!cancelled) setUserThemesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [setAvailableThemes, setUserThemesLoaded, setSelectedThemeId]);

  // On "/", reopen the last note if it still exists. Otherwise restore just the
  // notebook selection so the picker can show it.
  useEffect(() => {
    if (loading || !user || !isRootRoute) return;

    let cancelled = false;

    const lastOpen = getLastOpen();
    if (!lastOpen) return;

    if (!lastOpen.noteId) {
      if (lastOpen.notebookId) {
        setSelectedNotebook(lastOpen.notebookId);
        // Only set when a folder reference was followed.
        if (lastOpen.folderId) setSelectedFolder(lastOpen.folderId);
      }
      return;
    }

    void getNoteById(lastOpen.noteId).then((note) => {
      if (cancelled || !note) return;
      // Use the note's own notebookId: lastOpen.notebookId is null for notes
      // without a folder. Check it against the loaded notebooks, because it can
      // point at a deleted notebook; if notebooks haven't loaded yet, set it
      // optimistically.
      const notebookIsValid =
        note.notebookId === null ||
        !notebooksLoaded ||
        notebooks.some((n) => n.id === note.notebookId);
      setSelectedNotebook(notebookIsValid ? note.notebookId : null);
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
    setSelectedFolder,
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

  // AppLayout wraps only authenticated, non-public pages.
  if (publicRoute || isStickyRoute || isImageEditorRoute) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
