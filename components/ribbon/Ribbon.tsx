"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEditorState } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { setLastOpen } from "@/lib/lastOpen";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Image as ImageIcon, Link as LinkIcon } from "lucide-react";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  TEXT_COLORS,
  applyFontFamily,
  applyFontSize,
  applyTextColor,
  formatActions,
  selectFormatActionState,
} from "./formatActions";

// Ribbon shell (spec.md subtask 8, "Ribbon shell"). Tab bar with File/Format
// always shown, and Draw shown only when the currently-open note is a canvas
// note (i.e. the route is /canvas). Each tab's real content is a separate,
// later subtask (File: 9, Format: 10, Draw: 12) - this only builds the shell
// and tab-switching, per this subtask's explicit scope.

type RibbonTab = "file" | "format" | "draw";

// Same trailing-slash normalization AppShell.tsx uses for its own route
// checks (next.config.ts sets `trailingSlash: true` for the static export
// Tauri loads, so usePathname() returns e.g. "/canvas/" not "/canvas").
function normalizePathname(pathname: string | null): string | null {
  if (!pathname) return pathname;
  return pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
}

// Compact icon button matching EditorToolbar.tsx's pre-existing style
// (ported into the ribbon rather than invented fresh), sized to fit the
// ribbon's fixed h-24 shell.
function FormatBtn({
  onClick,
  active,
  tip,
  children,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  tip: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={onClick}
            disabled={disabled}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

// Format tab's real content (spec.md subtask 10, "Format tab") - ports the
// formatting actions that used to live in components/editor/EditorToolbar.tsx
// (rendered inside RichTextEditor.tsx, above the Tiptap content) into the
// ribbon, plus new font family / font size / text color controls. All
// actions read/write `activeEditor` from stores/appStore.ts, which
// RichTextEditor.tsx keeps in sync with its own `useEditor()` instance -
// see RichTextEditor.tsx's `setActiveEditor` effect for why that indirection
// is needed (Ribbon is a sibling of the note page, not a descendant).
//
// Renders a neutral placeholder when `activeEditor` is null - covers both
// "no note open" (notebook-open placeholder page) and "canvas note open"
// (components/canvas/CanvasEditor.tsx has no Tiptap instance at all; that's
// the Draw tab's job, subtask 12).
function FormatTab() {
  const activeEditor = useAppStore((s) => s.activeEditor);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tiptap's `editor` object instance does not change identity when its
  // internal state changes (bold toggled, selection moved, etc.), and
  // FormatTab lives outside RichTextEditor.tsx's own re-render cycle (it's
  // rendered by AppLayout.tsx as a sibling, not a descendant) - so it needs
  // its own explicit subscription to stay in sync, which `useEditorState` is
  // Tiptap v3's documented mechanism for. The `editor: Editor | null`
  // overload returns `null` when there's no editor instead of throwing, so
  // this stays safe to call across notes closing/canvas routes/the
  // notebook-open placeholder.
  const state = useEditorState({
    editor: activeEditor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  if (!activeEditor || !state) {
    return <div className="flex items-center text-muted-foreground">No formatting available.</div>;
  }

  function insertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeEditor) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        activeEditor.chain().focus().setImage({ src: reader.result }).run();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function setLink() {
    if (!activeEditor) return;
    const prev = state?.link ?? "https://";
    const url = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") {
      activeEditor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      activeEditor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      {formatActions.map((action) => (
        <FormatBtn
          key={action.id}
          tip={action.tip}
          active={action.isActive(state)}
          disabled={action.isDisabled?.(state)}
          onClick={() => action.run(activeEditor)}
        >
          <action.icon className="h-3.5 w-3.5" />
        </FormatBtn>
      ))}

      <Separator orientation="vertical" className="mx-1 h-5" />

      <FormatBtn tip="Insert image" onClick={() => fileInputRef.current?.click()}>
        <ImageIcon className="h-3.5 w-3.5" />
      </FormatBtn>
      <FormatBtn tip="Insert link" active={state.link !== null} onClick={setLink}>
        <LinkIcon className="h-3.5 w-3.5" />
      </FormatBtn>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={insertImage} />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <select
        aria-label="Font family"
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        value={state.fontFamily}
        onChange={(e) => applyFontFamily(activeEditor, e.target.value)}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Font size"
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        value={state.fontSize}
        onChange={(e) => applyFontSize(activeEditor, e.target.value)}
      >
        {FONT_SIZES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div className="flex items-center gap-1">
        {TEXT_COLORS.map((c) => (
          <Tooltip key={c.value || "default"}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => applyTextColor(activeEditor, c.value)}
                  className={cn(
                    "h-5 w-5 rounded-full border",
                    state.color === c.value ? "ring-2 ring-ring ring-offset-1" : "border-border",
                  )}
                  style={{ backgroundColor: c.value || "transparent" }}
                />
              }
            />
            <TooltipContent>{c.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export function Ribbon() {
  const pathname = usePathname();
  const router = useRouter();
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);
  const normalizedPathname = normalizePathname(pathname);
  const isCanvasRoute = normalizedPathname === "/canvas";

  const [activeTab, setActiveTab] = useState<RibbonTab>("file");

  // Shared by both File tab actions (spec.md subtask 9, "File tab"): the
  // notebook picker (app/page.tsx) already has a complete list/create-
  // notebook UI, so both "swap notebook" and "new notebook" just clear the
  // current selection (in-memory store + persisted last-open state) and
  // send the user back to "/" rather than duplicating that UI here. Clearing
  // the persisted state (not just the store) is required - otherwise
  // AppShell.tsx's restore effect would just re-select the same notebook (or
  // navigate straight back into the last note) the next time "/" is
  // reached, defeating the point of swapping.
  function returnToPicker() {
    setSelectedNotebook(null);
    setLastOpen({ notebookId: null, folderId: null, noteId: null });
    router.push("/");
  }

  // If the Draw tab is currently active and the route navigates away from
  // /canvas (e.g. the user opens a plain note), fall back to File rather
  // than leaving an unreachable tab selected with no button to reach it.
  const effectiveTab = activeTab === "draw" && !isCanvasRoute ? "file" : activeTab;

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: "file", label: "File" },
    { id: "format", label: "Format" },
    ...(isCanvasRoute ? ([{ id: "draw", label: "Draw" }] as const) : []),
  ];

  return (
    <div className="flex h-24 flex-col border-b border-border bg-background">
      <div className="flex h-9 items-center gap-1 border-b border-border px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-t-md px-3 py-1 text-sm transition-colors",
              effectiveTab === tab.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 px-3 py-2 text-sm text-muted-foreground">
        {effectiveTab === "file" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={returnToPicker}>
              Swap Notebook
            </Button>
            <Button variant="outline" size="sm" onClick={returnToPicker}>
              New Notebook
            </Button>
          </div>
        )}
        {effectiveTab === "format" && <FormatTab />}
        {effectiveTab === "draw" && (
          <div className="flex items-center">
            Drawing tools are available directly on the canvas below.
          </div>
        )}
      </div>
    </div>
  );
}
