"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { createNote } from "@/lib/db/notes";
import { createFolder } from "@/lib/db/folders";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import { nextOrderValue } from "@/lib/dnd/sidebar";
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
  LogOut,
  User as UserIcon,
  Cloud,
  CloudOff,
  Loader2,
  CheckCircle2,
} from "lucide-react";

// Triggers use render={<Button />} rather than asChild: the installed
// @base-ui/react has no asChild, and using it nested two <button>s and broke
// their click handlers.

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
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const notes = useAppStore((s) => s.notes);
  const folders = useAppStore((s) => s.folders);
  const [creating, setCreating] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Create in the open notebook; fall back to the default notebook only when
  // none is open.
  async function resolveNotebookId() {
    return selectedNotebookId ?? (await getOrCreateDefaultNotebookId(user.uid));
  }

  async function newNote() {
    if (creating) return;
    setCreating(true);
    try {
      const notebookId = await resolveNotebookId();
      // Create inside the selected folder if there is one, and append after the
      // existing items instead of the default order 0.
      const siblingNoteOrders = notes
        .filter((n) => n.folderId === (selectedFolderId ?? null) && n.notebookId === notebookId)
        .map((n) => n.order);
      const id = await createNote(
        user.uid,
        "canvas",
        notebookId,
        selectedFolderId ?? undefined,
        undefined,
        nextOrderValue(siblingNoteOrders),
      );
      router.push(`/canvas?id=${id}`);
    } finally {
      setCreating(false);
    }
  }

  async function newFolder() {
    const notebookId = await resolveNotebookId();
    // Same as newNote, for folders.
    const siblingFolderOrders = folders
      .filter((f) => f.parentId === (selectedFolderId ?? null) && f.notebookId === notebookId)
      .map((f) => f.order);
    await createFolder(
      user.uid,
      "New Folder",
      notebookId,
      selectedFolderId ?? undefined,
      nextOrderValue(siblingFolderOrders),
    );
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
        {selectedNotebookId ? (
          <FolderTree userId={user.uid} notebookId={selectedNotebookId} />
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No notebook open.
          </p>
        )}
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
