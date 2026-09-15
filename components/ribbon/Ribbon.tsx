"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useEditorState } from "@tiptap/react";
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  react,
  useValue,
  type Editor,
  type StyleProp,
  type TLDefaultColorStyle,
  type TLDefaultDashStyle,
  type TLDefaultFillStyle,
  type TLDefaultSizeStyle,
} from "@tldraw/tldraw";
import { switchToToolExplicitly } from "@/components/canvas/RichTextTool";
import { StickyNotesHome } from "@/components/sticky/StickyNotesHome";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Image as ImageIcon,
  Link as LinkIcon,
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  TEXT_COLORS,
  applyFontFamily,
  applyFontSize,
  applyTextColor,
  formatActions,
  selectFormatActionState,
  type FormatActionState,
} from "./formatActions";

// Tab bar: File/Format always shown, Draw only when the open note is a
// canvas note (route is /canvas).

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
  className,
}: {
  onClick: () => void;
  active?: boolean;
  tip: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className={cn("h-7 w-7", className)}
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

// Formatting actions read/write `activeEditor` from stores/appStore.ts,
// which RichTextEditor.tsx keeps in sync with its own Tiptap instance
// (Ribbon is a sibling, not a descendant, so needs this indirection).
// Always renders the full control set - disabled/neutral when there's no
// `activeEditor` (no note open, or a canvas note with no Tiptap instance),
// rather than hiding controls.
const NEUTRAL_FORMAT_STATE: FormatActionState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  heading1: false,
  heading2: false,
  heading3: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockquote: false,
  link: null,
  canUndo: false,
  canRedo: false,
  fontFamily: "",
  fontSize: "",
  color: "",
  highlight: null,
};

function FormatTab() {
  const activeEditor = useAppStore((s) => s.activeEditor);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tiptap's `editor` instance doesn't change identity on internal state
  // changes (bold toggled, selection moved), so this needs its own
  // subscription (`useEditorState`) to stay in sync from outside
  // RichTextEditor.tsx's own re-render cycle.
  const liveState = useEditorState({
    editor: activeEditor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  const state = activeEditor && liveState ? liveState : NEUTRAL_FORMAT_STATE;
  const disabledAll = !activeEditor || !liveState;

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
          disabled={disabledAll || action.isDisabled?.(state)}
          onClick={() => activeEditor && action.run(activeEditor)}
        >
          <action.icon className="h-3.5 w-3.5" />
        </FormatBtn>
      ))}

      <Separator orientation="vertical" className="mx-1 h-5" />

      <FormatBtn
        tip="Insert image"
        disabled={disabledAll}
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </FormatBtn>
      <FormatBtn tip="Insert link" active={state.link !== null} disabled={disabledAll} onClick={setLink}>
        <LinkIcon className="h-3.5 w-3.5" />
      </FormatBtn>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={insertImage} />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <select
        aria-label="Font family"
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        value={state.fontFamily}
        disabled={disabledAll}
        onChange={(e) => activeEditor && applyFontFamily(activeEditor, e.target.value)}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Font size"
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        value={state.fontSize}
        disabled={disabledAll}
        onChange={(e) => activeEditor && applyFontSize(activeEditor, e.target.value)}
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
                  disabled={disabledAll}
                  onClick={() => activeEditor && applyTextColor(activeEditor, c.value)}
                  className={cn(
                    "h-5 w-5 rounded-full border disabled:cursor-not-allowed disabled:opacity-50",
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

// Draw tab: the sole tldraw tool-switcher, since CanvasEditor.tsx's
// `<Tldraw>` suppresses the native toolbar/style panel chrome. Reuses
// `activeCanvasEditor` from stores/appStore.ts. Colors/fills/dashes/sizes
// below mirror tldraw's own `STYLES` values; swatch hexes are each color's
// light-mode value (kept static, not theme-reactive - out of scope here).
const DRAW_COLORS: { label: string; value: TLDefaultColorStyle; hex: string }[] = [
  { label: "Black", value: "black", hex: "#1d1d1d" },
  { label: "Grey", value: "grey", hex: "#9fa8b2" },
  { label: "Light violet", value: "light-violet", hex: "#e085f4" },
  { label: "Violet", value: "violet", hex: "#ae3ec9" },
  { label: "Blue", value: "blue", hex: "#4465e9" },
  { label: "Light blue", value: "light-blue", hex: "#4ba1f1" },
  { label: "Yellow", value: "yellow", hex: "#f1ac4b" },
  { label: "Orange", value: "orange", hex: "#e16919" },
  { label: "Green", value: "green", hex: "#099268" },
  { label: "Light green", value: "light-green", hex: "#4cb05e" },
  { label: "Light red", value: "light-red", hex: "#f87777" },
  { label: "Red", value: "red", hex: "#e03131" },
];

const DRAW_FILLS: { label: string; value: TLDefaultFillStyle }[] = [
  { label: "None", value: "none" },
  { label: "Semi", value: "semi" },
  { label: "Solid", value: "solid" },
];

const DRAW_DASHES: { label: string; value: TLDefaultDashStyle }[] = [
  { label: "Draw", value: "draw" },
  { label: "Dashed", value: "dashed" },
  { label: "Dotted", value: "dotted" },
  { label: "Solid", value: "solid" },
];

const DRAW_SIZES: { label: string; value: TLDefaultSizeStyle }[] = [
  { label: "Small", value: "s" },
  { label: "Medium", value: "m" },
  { label: "Large", value: "l" },
  { label: "Extra large", value: "xl" },
];

// Small CSS-drawn icons (no matching lucide-react icon for tldraw's own
// fill/dash concepts) rendered at the same h-3.5 w-3.5 size as the other
// Draw tab icons above.
function FillIcon({ variant }: { variant: TLDefaultFillStyle }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2"
        fill={variant === "none" ? "none" : "currentColor"}
        fillOpacity={variant === "solid" ? 1 : variant === "semi" ? 0.35 : 0}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DashIcon({ variant }: { variant: TLDefaultDashStyle }) {
  const dashArray =
    variant === "dashed" ? "3 2" : variant === "dotted" ? "0.1 2.2" : undefined;
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d={variant === "draw" ? "M2 10.5c1.5-5 3-6.5 4-2s2 5.5 3 1 2.5-5.5 4-1.5" : "M2 8h12"}
        fill="none"
        stroke="currentColor"
        strokeWidth={variant === "dotted" ? 2.25 : 1.5}
        strokeLinecap={variant === "dotted" || variant === "draw" ? "round" : "butt"}
        strokeDasharray={dashArray}
      />
    </svg>
  );
}

function DrawTab() {
  const activeCanvasEditor = useAppStore((s) => s.activeCanvasEditor);

  // `getCurrentToolId()` is a tldraw signal, not a store event, so this
  // needs `useValue` (not `editor.store.listen`) to stay in sync with tool
  // changes that happen outside this tab too.
  const liveToolId = useValue(
    "ribbon draw tab: current tool id",
    () => activeCanvasEditor?.getCurrentToolId() ?? null,
    [activeCanvasEditor],
  );
  const geoStyle = useValue(
    "ribbon draw tab: current geo style",
    () => activeCanvasEditor?.getSharedStyles().getAsKnownValue(GeoShapeGeoStyle) ?? null,
    [activeCanvasEditor],
  );

  // Same reactive-read pattern as `geoStyle` above, for the other three
  // style props the deleted native panel exposed. `getAsKnownValue` returns
  // null on a mixed/no-relevant-shape selection - same "no highlight"
  // fallback as `geoStyle`.
  const colorStyle = useValue(
    "ribbon draw tab: current color style",
    () => activeCanvasEditor?.getSharedStyles().getAsKnownValue(DefaultColorStyle) ?? null,
    [activeCanvasEditor],
  );
  const fillStyle = useValue(
    "ribbon draw tab: current fill style",
    () => activeCanvasEditor?.getSharedStyles().getAsKnownValue(DefaultFillStyle) ?? null,
    [activeCanvasEditor],
  );
  const dashStyle = useValue(
    "ribbon draw tab: current dash style",
    () => activeCanvasEditor?.getSharedStyles().getAsKnownValue(DefaultDashStyle) ?? null,
    [activeCanvasEditor],
  );
  const sizeStyle = useValue(
    "ribbon draw tab: current size style",
    () => activeCanvasEditor?.getSharedStyles().getAsKnownValue(DefaultSizeStyle) ?? null,
    [activeCanvasEditor],
  );

  if (!activeCanvasEditor) {
    return <div className="flex items-center text-muted-foreground">No canvas available.</div>;
  }

  // Every deliberate tool switch must go through `switchToToolExplicitly`
  // (not a raw `setCurrentTool`) - see RichTextTool.tsx for why.
  function setTool(id: string) {
    if (!activeCanvasEditor) return;
    switchToToolExplicitly(activeCanvasEditor, id);
  }

  function setGeoTool(geo: "rectangle" | "ellipse") {
    if (!activeCanvasEditor) return;
    activeCanvasEditor.run(() => {
      activeCanvasEditor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
      switchToToolExplicitly(activeCanvasEditor, "geo");
    });
  }

  const isGeo = (geo: "rectangle" | "ellipse") => liveToolId === "geo" && geoStyle === geo;

  // Mirrors tldraw's own native style panel logic: restyle selected shapes
  // AND the next-shape style, so a subsequently drawn shape keeps it too.
  function setStyle<T>(style: StyleProp<T>, value: T) {
    if (!activeCanvasEditor) return;
    activeCanvasEditor.run(() => {
      if (activeCanvasEditor.isIn("select")) {
        activeCanvasEditor.setStyleForSelectedShapes(style, value);
      }
      activeCanvasEditor.setStyleForNextShapes(style, value);
      activeCanvasEditor.updateInstanceState({ isChangingStyle: true });
    });
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      <FormatBtn tip="Select" active={liveToolId === "rich-text"} onClick={() => setTool("rich-text")}>
        <MousePointer2 className="h-3.5 w-3.5" />
      </FormatBtn>
      <div className="flex items-center">
        <FormatBtn tip="Pencil" active={liveToolId === "draw"} onClick={() => setTool("draw")}>
          <Pencil className="h-3.5 w-3.5" />
        </FormatBtn>
        {/* Quick color caret next to the Pencil button - separate trigger
            from the full color grid below, same DRAW_COLORS/setStyle. */}
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-5 shrink-0 px-0"
                      aria-label="Pencil color"
                    >
                      <ChevronDown className="h-2.5 w-2.5" />
                    </Button>
                  }
                />
              }
            />
            <DropdownMenuContent align="start" className="w-auto min-w-0 p-1.5">
              <div className="grid grid-cols-4 gap-1">
                {DRAW_COLORS.map((c) => (
                  <Tooltip key={c.value}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => setStyle(DefaultColorStyle, c.value)}
                          className={cn(
                            "h-5 w-5 rounded-full border border-border",
                            colorStyle === c.value && "ring-2 ring-ring ring-offset-1",
                          )}
                          style={{ backgroundColor: c.hex }}
                        />
                      }
                    />
                    <TooltipContent>{c.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent>Pencil color</TooltipContent>
        </Tooltip>
      </div>
      <FormatBtn tip="Eraser" active={liveToolId === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser className="h-3.5 w-3.5" />
      </FormatBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <FormatBtn tip="Rectangle" active={isGeo("rectangle")} onClick={() => setGeoTool("rectangle")}>
        <Square className="h-3.5 w-3.5" />
      </FormatBtn>
      <FormatBtn tip="Ellipse" active={isGeo("ellipse")} onClick={() => setGeoTool("ellipse")}>
        <Circle className="h-3.5 w-3.5" />
      </FormatBtn>
      <FormatBtn tip="Arrow" active={liveToolId === "arrow"} onClick={() => setTool("arrow")}>
        <ArrowUpRight className="h-3.5 w-3.5" />
      </FormatBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div className="flex items-center gap-1">
        {DRAW_COLORS.map((c) => (
          <Tooltip key={c.value}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setStyle(DefaultColorStyle, c.value)}
                  className={cn(
                    "h-5 w-5 rounded-full border border-border",
                    colorStyle === c.value && "ring-2 ring-ring ring-offset-1",
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              }
            />
            <TooltipContent>{c.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {DRAW_FILLS.map((f) => (
        <FormatBtn
          key={f.value}
          tip={`Fill: ${f.label}`}
          active={fillStyle === f.value}
          onClick={() => setStyle(DefaultFillStyle, f.value)}
        >
          <FillIcon variant={f.value} />
        </FormatBtn>
      ))}

      <Separator orientation="vertical" className="mx-1 h-5" />

      {DRAW_DASHES.map((d) => (
        <FormatBtn
          key={d.value}
          tip={`Stroke: ${d.label}`}
          active={dashStyle === d.value}
          onClick={() => setStyle(DefaultDashStyle, d.value)}
        >
          <DashIcon variant={d.value} />
        </FormatBtn>
      ))}

      <Separator orientation="vertical" className="mx-1 h-5" />

      {DRAW_SIZES.map((s) => (
        <FormatBtn
          key={s.value}
          tip={`Size: ${s.label}`}
          active={sizeStyle === s.value}
          onClick={() => setStyle(DefaultSizeStyle, s.value)}
          className="w-8 text-xs font-medium"
        >
          {s.value.toUpperCase()}
        </FormatBtn>
      ))}
    </div>
  );
}

export function Ribbon() {
  const pathname = usePathname();
  const activeCanvasEditor = useAppStore((s) => s.activeCanvasEditor);
  const normalizedPathname = normalizePathname(pathname);
  const isCanvasRoute = normalizedPathname === "/canvas";

  const [activeTab, setActiveTab] = useState<RibbonTab>("file");
  const [stickyHomeOpen, setStickyHomeOpen] = useState(false);

  // If the Draw tab is currently active and the route navigates away from
  // /canvas (e.g. the user opens a plain note), fall back to File rather
  // than leaving an unreachable tab selected with no button to reach it.
  const effectiveTab = activeTab === "draw" && !isCanvasRoute ? "file" : activeTab;

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: "file", label: "File" },
    { id: "format", label: "Format" },
    ...(isCanvasRoute ? ([{ id: "draw", label: "Draw" }] as const) : []),
  ];

  // Switching to File/Format always returns the canvas to the `rich-text`
  // tool - deferred while a drag gesture is in flight or a selection is
  // non-empty (would otherwise strand resize/rotate/Delete on the wrong
  // tool), matching RichTextTool.tsx's own watcher logic.
  useEffect(() => {
    if (effectiveTab === "draw") return;
    if (!activeCanvasEditor) return;

    const shouldDeferReturnToRichText = (editor: Editor) =>
      editor.inputs.getIsPointing() ||
      editor.inputs.getIsDragging() ||
      editor.isInAny(
        "select.translating",
        "select.brushing",
        "select.resizing",
        "select.rotating",
      ) ||
      (editor.isIn("select") && editor.getSelectedShapeIds().length > 0);

    if (!shouldDeferReturnToRichText(activeCanvasEditor)) {
      switchToToolExplicitly(activeCanvasEditor, "rich-text");
      return;
    }

    const stop = react("ribbon: deferred return to rich-text after in-flight gesture", () => {
      if (shouldDeferReturnToRichText(activeCanvasEditor)) return;
      stop();
      activeCanvasEditor.disposables.delete(stop);
      switchToToolExplicitly(activeCanvasEditor, "rich-text");
    });
    activeCanvasEditor.disposables.add(stop);

    return () => {
      stop();
      activeCanvasEditor.disposables.delete(stop);
    };
  }, [effectiveTab, activeCanvasEditor]);

  return (
    <div className="flex h-24 flex-col border-b border-border bg-background">
      <StickyNotesHome open={stickyHomeOpen} onOpenChange={setStickyHomeOpen} />
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
        {/* Not a RibbonTab - opens the StickyNotesHome dialog (subtask 14)
            rather than swapping in ribbon-panel content, since a dialog
            doesn't fit the tab/panel shape the other tabs use. */}
        <button
          type="button"
          onClick={() => setStickyHomeOpen(true)}
          className="ml-auto rounded-t-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          Sticky notes
        </button>
      </div>
      <div className="flex-1 px-3 py-2 text-sm text-muted-foreground">
        {effectiveTab === "file" && (
          <div className="flex items-center text-muted-foreground">No actions available.</div>
        )}
        {effectiveTab === "format" && <FormatTab />}
        {effectiveTab === "draw" && <DrawTab />}
      </div>
    </div>
  );
}
