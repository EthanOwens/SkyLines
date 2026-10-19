"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorState } from "@tiptap/react";
import { useValue } from "@tldraw/tldraw";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_VISIBILITY,
  getQuickAccessVisibility,
  setQuickAccessVisibility,
  type QuickAccessVisibility,
} from "@/lib/quickAccessPrefs";
import { useAppStore, type NoteHistoryEntry } from "@/stores/appStore";
import { ArrowLeft, ArrowRight, Redo, Settings, Undo } from "lucide-react";
import { AccountMenu } from "./AccountMenu";

// Quick access toolbar above the sidebar, ribbon and content. Back/Forward walk
// the note history in the store.
//
// Undo/Redo act on whatever has focus. activeCanvasEditor (tldraw) is set while
// any canvas note is open; activeEditor (Tiptap) only while a text shape is
// being edited, so both can be set at once. The Tiptap editor wins when set.

type QuickAccessKey = keyof QuickAccessVisibility;

const QUICK_ACCESS_ITEMS: {
  key: QuickAccessKey;
  label: string;
  icon: typeof ArrowLeft;
}[] = [
  { key: "back", label: "Back", icon: ArrowLeft },
  { key: "forward", label: "Forward", icon: ArrowRight },
  { key: "undo", label: "Undo", icon: Undo },
  { key: "redo", label: "Redo", icon: Redo },
];

export function TopBar() {
  // Starts at the default and reads localStorage after mount, so the first
  // client render matches the static HTML (no hydration mismatch).
  const [visibility, setVisibility] = useState<QuickAccessVisibility>(DEFAULT_VISIBILITY);
  const router = useRouter();
  const noteHistory = useAppStore((s) => s.noteHistory);
  const historyIndex = useAppStore((s) => s.historyIndex);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);
  const setIsHistoryNavigation = useAppStore((s) => s.setIsHistoryNavigation);
  const activeEditor = useAppStore((s) => s.activeEditor);
  const activeCanvasEditor = useAppStore((s) => s.activeCanvasEditor);

  // The editor's identity doesn't change on doc updates, so subscribe to
  // canUndo/canRedo.
  const tiptapUndoState = useEditorState({
    editor: activeEditor,
    // Tiptap can still hand the selector a just-destroyed editor during a route
    // change, and .can() throws on it.
    selector: ({ editor }) =>
      editor && !editor.isDestroyed
        ? { canUndo: editor.can().undo(), canRedo: editor.can().redo() }
        : null,
  });

  // useValue so canUndo/canRedo stay live; a one-time read would go stale.
  const canvasCanUndo = useValue(
    "topbar-canvas-can-undo",
    () => activeCanvasEditor?.getCanUndo() ?? false,
    [activeCanvasEditor],
  );
  const canvasCanRedo = useValue(
    "topbar-canvas-can-redo",
    () => activeCanvasEditor?.getCanRedo() ?? false,
    [activeCanvasEditor],
  );

  const canUndo = activeEditor ? (tiptapUndoState?.canUndo ?? false) : canvasCanUndo;
  const canRedo = activeEditor ? (tiptapUndoState?.canRedo ?? false) : canvasCanRedo;

  useEffect(() => {
    setVisibility(getQuickAccessVisibility());
  }, []);

  function toggle(key: QuickAccessKey) {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setQuickAccessVisibility(next);
      return next;
    });
  }

  // Set isHistoryNavigation before navigating so the page doesn't push a new
  // history entry; goBack/goForward already moved the index.
  function navigateToEntry(entry: NoteHistoryEntry) {
    setIsHistoryNavigation(true);
    router.push(`/canvas?id=${entry.noteId}`);
  }

  function handleBack() {
    const entry = goBack();
    if (entry) navigateToEntry(entry);
  }

  function handleForward() {
    const entry = goForward();
    if (entry) navigateToEntry(entry);
  }

  // Tiptap first (only set while a shape is being edited), then tldraw.
  function handleUndo() {
    if (activeEditor) {
      activeEditor.chain().focus().undo().run();
    } else if (activeCanvasEditor) {
      activeCanvasEditor.undo();
    }
  }

  function handleRedo() {
    if (activeEditor) {
      activeEditor.chain().focus().redo().run();
    } else if (activeCanvasEditor) {
      activeCanvasEditor.redo();
    }
  }

  const disabledByKey: Record<QuickAccessKey, boolean> = {
    back: historyIndex <= 0,
    forward: historyIndex >= noteHistory.length - 1,
    undo: !canUndo,
    redo: !canRedo,
  };
  const onClickByKey: Partial<Record<QuickAccessKey, () => void>> = {
    back: handleBack,
    forward: handleForward,
    undo: handleUndo,
    redo: handleRedo,
  };

  const visibleItems = QUICK_ACCESS_ITEMS.filter((item) => visibility[item.key]);

  return (
    <div className="flex h-10 w-full items-center justify-between border-b border-border bg-background px-2">
      <div className="flex items-center gap-0.5">
        {visibleItems.map((item) => {
          const disabled = disabledByKey[item.key];
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={disabled}
                      tabIndex={disabled ? -1 : 0}
                      onClick={onClickByKey[item.key]}
                    >
                      <item.icon className="h-4 w-4" />
                    </Button>
                  </span>
                }
              />
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Settings className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Quick access toolbar</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {QUICK_ACCESS_ITEMS.map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.key}
                  checked={visibility[item.key]}
                  onCheckedChange={() => toggle(item.key)}
                >
                  {item.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AccountMenu />
    </div>
  );
}
