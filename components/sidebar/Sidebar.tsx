"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { createNote } from "@/lib/db/notes";
import { createFolder } from "@/lib/db/folders";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import { useAppStore } from "@/stores/appStore";
import { FolderTree } from "./FolderTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PanelLeftClose,
  PanelLeftOpen,
  FilePlus,
  FolderPlus,
  LayoutDashboard,
  LogOut,
  User as UserIcon,
  Cloud,
  CloudOff,
  Loader2,
  CheckCircle2,
} from "lucide-react";

// Ported from ../note_taking_app/components/sidebar/Sidebar.tsx (spec.md
// subtask 16). Mutations now go through the SQLite-backed lib/db/notes.ts /
// lib/db/folders.ts instead of lib/firestore/notes.ts / folders.ts, and
// note/canvas links use the query-param routing form (/note?id=...,
// /canvas?id=...) per subtask 5 instead of /note/[id] / /canvas/[id].
//
// One mechanical adaptation beyond that: every `<TooltipTrigger asChild>`/
// `<DropdownMenuTrigger asChild>` from the reference is rewritten as
// `<... render={<Button .../>} />`. The reference's own `asChild` prop
// doesn't exist on the actually-installed `@base-ui/react@1.3.0` (confirmed
// identical in ../note_taking_app's own node_modules and via `tsc`/`next
// build` failing there too - a pre-existing bug in the reference, not
// introduced here); this version's trigger primitives merge onto a child
// element via the `render` prop instead. Verified live in a real Tauri
// window that `render` correctly merges the Button's class/onClick/children
// onto the trigger element (single real `<button>`, no invalid nested
// `<button>`, no runtime error) where `asChild` silently produced two nested
// `<button>` elements and broke the click handler entirely.

function SyncBadge() {
  const status = useAppStore((s) => s.syncStatus);
  if (status === "syncing") return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  if (status === "offline") return <CloudOff className="h-3 w-3 text-yellow-500" />;
  if (status === "error") return <Cloud className="h-3 w-3 text-destructive" />;
  return <CheckCircle2 className="h-3 w-3 text-green-500" />;
}

interface Props {
  user: User;
}

export function Sidebar({ user }: Props) {
  const router = useRouter();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [creating, setCreating] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  async function newNote() {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createNote(user.uid, "note");
      router.push(`/note?id=${id}`);
    } finally {
      setCreating(false);
    }
  }

  async function newCanvas() {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createNote(user.uid, "canvas");
      router.push(`/canvas?id=${id}`);
    } finally {
      setCreating(false);
    }
  }

  async function newFolder() {
    const notebookId = await getOrCreateDefaultNotebookId(user.uid);
    await createFolder(user.uid, "New Folder", notebookId);
  }

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  if (!sidebarOpen) {
    return (
      <div className="flex h-full w-12 flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="right">Open sidebar</TooltipContent>
        </Tooltip>
        <Separator />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" onClick={newNote} className="h-8 w-8" disabled={creating}>
                <FilePlus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="right">New note</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" onClick={newCanvas} className="h-8 w-8" disabled={creating}>
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="right">New canvas</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" onClick={newFolder} className="h-8 w-8">
                <FolderPlus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent side="right">New folder</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar"
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-sm font-semibold text-sidebar-foreground">Skylines</span>
        <div className="flex items-center gap-1">
          <SyncBadge />
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Action bar */}
      <div className="flex items-center gap-1 px-2 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newNote} disabled={creating}>
                <FilePlus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent>New note</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newCanvas} disabled={creating}>
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent>New canvas</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newFolder}>
                <FolderPlus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 px-1">
        <FolderTree userId={user.uid} />
      </ScrollArea>

      <Separator />

      {/* User footer */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-sidebar-accent transition-colors w-full">
              <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sidebar-foreground">
                {user.displayName || user.email}
              </span>
            </button>
          }
        />
        <DropdownMenuContent side="top" align="start" className="w-52">
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {user.email}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
