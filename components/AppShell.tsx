"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/components/AuthProvider";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useNotes } from "@/hooks/useNotes";
import { useFolders } from "@/hooks/useFolders";
import { useNotebooks } from "@/hooks/useNotebooks";

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

  const publicRoute = isPublicRoute(pathname);

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

  if (!publicRoute && (loading || shouldRedirect)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
