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

  const publicRoute = isPublicRoute(pathname);
  // Same trailing-slash normalization as isPublicRoute above (next.config.ts
  // sets trailingSlash: true for the static export).
  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const isRootRoute = normalizedPathname === "/";

  // Only wire the real signed-in user's uid into these hooks off of public
  // routes. Spike routes sign in with real Firebase accounts and drive the
  // sync engine / push logic manually to test it in isolation; since
  // Firebase Auth is a global singleton, AppShell would otherwise pick up
  // that same user and auto-start a second competing sync engine instance
  // (lib/sync/engine.ts's startSyncEngine is a module-level singleton),
  // racing with and clobbering the spike harness's own manual control.
  // Passing `undefined` makes each hook no-op per its own `if (!userId)
  // return;` guard.
  const syncUserId = publicRoute ? undefined : user?.uid;

  useSyncEngine(syncUserId);
  useNotes(syncUserId);
  useFolders(syncUserId);
  useNotebooks(syncUserId);

  const shouldRedirect = !loading && !user && !publicRoute;

  useEffect(() => {
    if (shouldRedirect) router.replace("/login");
  }, [shouldRedirect, router]);

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
      const dest = note.type === "canvas" ? "/canvas" : "/note";
      router.replace(`${dest}?id=${note.id}`);
    });

    return () => {
      cancelled = true;
    };
  }, [loading, user, isRootRoute, router, setSelectedNotebook]);

  if (!publicRoute && (loading || shouldRedirect)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
