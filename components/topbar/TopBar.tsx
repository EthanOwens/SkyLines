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

// Quick access toolbar (spec.md subtask 13, "Quick access toolbar"). Full-
// width bar above Sidebar+Ribbon+content (see AppLayout.tsx), matching
// planning.md's "on the very top should be some customizable quick access
// options" description. Back/Forward (spec.md subtask 14) are wired to the
// note-visit history stack in stores/appStore.ts. Undo/Redo (spec.md
// subtask 15, "Undo/redo wiring") act on whichever editor is currently
// mounted - Tiptap's `activeEditor` if a note is open, else tldraw's
// `activeCanvasEditor` if a canvas is open (the two are mutually exclusive,
// since /note and /canvas are separate routes) - rather than being two
// competing buttons. The settings popover's show/hide toggling and its
// localStorage persistence (lib/quickAccessPrefs.ts) is fully real/
// functional.
//
// The right side of the `justify-between` split renders AccountMenu.tsx
// (subtask 16, "Account icon + dropdown").

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
  // Initialized to the same default the static-export build-time render
  // produces (`window` is undefined at build time, so
  // getQuickAccessVisibility() would return DEFAULT_VISIBILITY anyway), then
  // re-read from localStorage only after mounting in the browser. This
  // matches lib/lastOpen.ts consumers' established pattern elsewhere in this
  // app and avoids a hydration mismatch: calling getQuickAccessVisibility()
  // eagerly in useState's initializer would make the very first client
  // render reflect the user's stored prefs, which can differ from the
  // baked-in static HTML.
  const [visibility, setVisibility] = useState<QuickAccessVisibility>(DEFAULT_VISIBILITY);
  const router = useRouter();
  const noteHistory = useAppStore((s) => s.noteHistory);
  const historyIndex = useAppStore((s) => s.historyIndex);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);
  const setIsHistoryNavigation = useAppStore((s) => s.setIsHistoryNavigation);
  const activeEditor = useAppStore((s) => s.activeEditor);
  const activeCanvasEditor = useAppStore((s) => s.activeCanvasEditor);

  // Reactive Tiptap undo/redo availability (spec.md subtask 15). Mirrors the
  // Format tab's own `useEditorState` usage (Ribbon.tsx) - `editor`'s
  // identity doesn't change on doc updates, so this subscription is what
  // actually re-renders TopBar when canUndo/canRedo flip.
  const tiptapUndoState = useEditorState({
    editor: activeEditor,
    // Guards against a real, observed race during /note <-> /canvas route
    // transitions: Tiptap's `useEditorState` internals can still hold a
    // reference to the just-destroyed previous editor for one more
    // transaction-driven snapshot before `RichTextEditor.tsx`'s unmount
    // effect clears `activeEditor` back to `null` - calling `.can()` on that
    // torn-down instance throws. `isDestroyed` is Tiptap's own documented
    // way to detect this and bail out to the neutral "no undo/redo" state.
    selector: ({ editor }) =>
      editor && !editor.isDestroyed
        ? { canUndo: editor.can().undo(), canRedo: editor.can().redo() }
        : null,
  });

  // Reactive tldraw undo/redo availability (spec.md subtask 15). tldraw's
  // `getCanUndo`/`getCanRedo` are plain getters backed by its own reactive
  // signals store, so `useValue`'s computed-signal form (name + fn + deps)
  // is what actually re-renders TopBar when they flip - a one-time call
  // here would go stale.
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

  // Navigates to a history-stack entry (spec.md subtask 14). Sets
  // `isHistoryNavigation` immediately before router.push() so the
  // note/canvas page's load effect knows to skip re-pushing a visit -
  // goBack()/goForward() already moved `historyIndex` to the right place.
  function navigateToEntry(entry: NoteHistoryEntry) {
    setIsHistoryNavigation(true);
    const dest = entry.type === "canvas" ? "/canvas" : "/note";
    router.push(`${dest}?id=${entry.noteId}`);
  }

  function handleBack() {
    const entry = goBack();
    if (entry) navigateToEntry(entry);
  }

  function handleForward() {
    const entry = goForward();
    if (entry) navigateToEntry(entry);
  }

  // Acts on "whichever editor is currently focused" (spec.md subtask 15) -
  // since /note and /canvas are mutually exclusive routes, this reduces to
  // checking `activeEditor` (Tiptap) first, then `activeCanvasEditor`
  // (tldraw). Reuses formatActions.ts's exact Tiptap undo/redo command.
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

  // Back/Forward (subtask 14) are enabled based on whether there's actually
  // somewhere in the stack to go. Undo/Redo (subtask 15) reflect whichever
  // editor is currently mounted's own reactive canUndo/canRedo state - both
  // stay disabled when neither editor is mounted (e.g. the notebook-open
  // placeholder page).
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
