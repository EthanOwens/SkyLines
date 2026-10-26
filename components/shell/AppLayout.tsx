"use client";

import { useAuthContext } from "@/components/AuthProvider";
import { useAppStore } from "@/stores/appStore";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Ribbon } from "@/components/ribbon/Ribbon";
import { AccountMenu } from "@/components/topbar/AccountMenu";
import { TopBar } from "@/components/topbar/TopBar";

// Inside AppShell's auth gate. Wraps pages in the sidebar and ribbon once a
// notebook is open; before that (the picker), children render full-screen.
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId);

  if (!user) return <>{children}</>;

  if (!selectedNotebookId) {
    return (
      <>
        <div className="fixed right-3 top-3 z-50">
          <AccountMenu />
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar user={user} />
        <div className="flex flex-1 flex-col">
          <Ribbon />
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
