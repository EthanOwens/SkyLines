"use client";

import { useAuthContext } from "@/components/AuthProvider";
import { useAppStore } from "@/stores/appStore";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Ribbon } from "@/components/ribbon/Ribbon";

// Persistent app shell (spec.md subtask 8, part B: "Wire the persistent
// shell (sidebar + ribbon + content outlet)"). Sits INSIDE AppShell.tsx's
// auth-gating - by the time this renders, AppShell has already confirmed a
// real signed-in user on a non-public route, so this only handles the
// notebook-scoped layout concern: once a notebook is open
// (selectedNotebookId set), render Sidebar + Ribbon around the page content;
// until then (the picker's list/create-notebook state), render children
// full-screen with no sidebar/ribbon to scope them to.
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId);

  if (!selectedNotebookId || !user) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen">
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col">
        <Ribbon />
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
