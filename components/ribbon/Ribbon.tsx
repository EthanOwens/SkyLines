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
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Image as ImageIcon,
  Link as LinkIcon,
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  ArrowUpRight,
  Type,
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

// Format tab's real content (spec.md subtask 10, "Format tab") - ports the
// formatting actions that used to live in components/editor/EditorToolbar.tsx
// (rendered inside RichTextEditor.tsx, above the Tiptap content) into the
// ribbon, plus new font family / font size / text color controls. All
// actions read/write `activeEditor` from stores/appStore.ts, which
// RichTextEditor.tsx keeps in sync with its own `useEditor()` instance -
// see RichTextEditor.tsx's `setActiveEditor` effect for why that indirection
// is needed (Ribbon is a sibling of the note page, not a descendant).
//
// Always renders the full control set (spec.md M3 subtask 5) - when
// `activeEditor` is null (covers both "no note open", i.e. the
// notebook-open placeholder page, and "canvas note open" since
// components/canvas/CanvasEditor.tsx has no Tiptap instance at all - that's
// the Draw tab's job), every control below is individually disabled and
// reflects a neutral/off state rather than being hidden.
// Neutral/off snapshot rendered (read-only) when there's no `activeEditor`
// to read real state from - keeps every "active" highlight off and every
// `isDisabled` check moot (the controls are already force-disabled below via
// `!activeEditor`), rather than reading fields off a null editor.
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

  // Tiptap's `editor` object instance does not change identity when its
  // internal state changes (bold toggled, selection moved, etc.), and
  // FormatTab lives outside RichTextEditor.tsx's own re-render cycle (it's
  // rendered by AppLayout.tsx as a sibling, not a descendant) - so it needs
  // its own explicit subscription to stay in sync, which `useEditorState` is
  // Tiptap v3's documented mechanism for. The `editor: Editor | null`
  // overload returns `null` when there's no editor instead of throwing, so
  // this stays safe to call across notes closing/canvas routes/the
  // notebook-open placeholder.
  const liveState = useEditorState({
    editor: activeEditor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  // Full control set always renders (spec.md M3 subtask 5) - when there's no
  // focused text box, every control below is individually `disabled` and
  // reflects this neutral/off state instead of being hidden.
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

// Draw tab's real content (spec.md M2 subtask 4, "Draw tab rebuild"). Now
// that CanvasEditor.tsx's `<Tldraw>` `components` override suppresses
// tldraw's own native toolbar/menu/zoom/etc. chrome (but deliberately keeps
// its `StylePanel`, so shape color/fill/stroke controls stay available -
// see that file's comment), this ribbon tab is the ONLY way to switch
// tldraw's active tool - reuses `activeCanvasEditor` from
// stores/appStore.ts (the same store field TopBar.tsx's undo/redo already
// reads the live tldraw `Editor` instance from) rather than threading a new
// prop down from CanvasEditor.tsx, matching this project's established
// pattern for reaching the live tldraw editor from a ribbon-level sibling
// component.
//
// Tool ids below (`select`/`draw`/`eraser`/`geo`/`arrow`/`rich-text`) were
// verified against the installed tldraw 4.5.12 (`node_modules/tldraw/
// dist-esm/lib/...ShapeTool.mjs`'s `static id = "..."` fields, and
// `node_modules/tldraw/dist-esm/lib/tools/EraserTool/EraserTool.mjs` /
// `SelectTool.mjs`), not guessed. The two "geo" shape buttons (rectangle/
// ellipse) additionally set `GeoShapeGeoStyle` before activating the `geo`
// tool, mirroring tldraw's own toolbar implementation
// (node_modules/tldraw/dist-esm/lib/ui/hooks/useTools.mjs's
// `editor.run(() => { editor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
// editor.setCurrentTool("geo"); })`) - `geo` alone is not a distinct
// rectangle/ellipse tool id, it's one tool whose shape is chosen by that
// style.
// spec.md M6 subtask 10 ("Rebuild equivalent color/fill/dash/size controls
// in the ribbon's Draw tab") - the deleted native style panel's controls
// (see `StylePanelWithoutOpacity` in `git show fb6e8ad~1:components/canvas/
// CanvasEditor.tsx`, removed by commit fb6e8ad "removed tlsdraw's native
// floating panel") rebuilt here. Value sets
// (12 colors / 3 fill styles / 4 dash styles / 4 sizes) verified against the
// installed tldraw 4.5.12's `STYLES` export
// (node_modules/tldraw/dist-esm/lib/styles.mjs) - NOT guessed. `hex` below
// is each color's light-mode "solid" swatch value from
// node_modules/@tldraw/tlschema/dist-esm/styles/TLColorStyle.mjs's
// `DefaultColorThemePalette.lightMode` (the same value tldraw's own
// `StylePanelButtonPicker` renders as its swatch background) - kept static
// rather than reactive to the app's light/dark theme, since tldraw's own
// `STYLES.color` list is identical either way and threading canvas dark-mode
// state into the ribbon is out of this subtask's scope (spec.md's Non-Goals:
// "don't touch theming").
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

  // Keep this tab's active-button highlighting in sync with the live tldraw
  // tool, including tool changes that happen OUTSIDE this tab (e.g. the
  // click-to-create rich-text tool's own auto-return-to-`rich-text`
  // mechanisms in RichTextTool.tsx, or a keyboard shortcut). `editor.store`
  // does NOT emit for tool-chart changes (see RichTextTool.tsx's header
  // comment on why tool-chart transitions aren't document/session-store
  // events - they're pure in-memory `StateNode` state), but
  // `getCurrentToolId()` IS a tldraw `@computed` signal (see
  // node_modules/@tldraw/editor/dist-esm/lib/editor/Editor.mjs's
  // `_getCurrentToolId_dec` decorator on it), so tldraw's own `useValue`
  // React hook (re-exported from `@tldraw/state-react` all the way through
  // `@tldraw/tldraw`, same as `react()` in RichTextTool.tsx uses the
  // non-React form of the same reactivity system) is the correct way to
  // subscribe to it here - mirroring RichTextTool.tsx's own established
  // preference for tldraw's fine-grained reactivity over store listeners for
  // this exact kind of state.
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

  // spec.md M6 subtask 10 - same `getSharedStyles().getAsKnownValue(...)`
  // reactive-read pattern as `geoStyle` above, applied to the four core
  // style props the deleted native panel exposed. `getAsKnownValue` reads
  // whichever of the "selected shapes' shared style" / "next shape's style"
  // is currently relevant (mirrors tldraw's own dual-purpose resolution -
  // see `editor.getSharedStyles()`'s doc comment in
  // node_modules/@tldraw/editor/dist-cjs/index.d.ts), and returns `null`
  // when the selection has mixed values for that style or no relevant shape/
  // tool has it at all - same "no highlight" fallback `geoStyle` already
  // relies on.
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

  function setTool(id: string) {
    activeCanvasEditor?.setCurrentTool(id);
  }

  function setGeoTool(geo: "rectangle" | "ellipse") {
    if (!activeCanvasEditor) return;
    activeCanvasEditor.run(() => {
      activeCanvasEditor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
      activeCanvasEditor.setCurrentTool("geo");
    });
  }

  const isGeo = (geo: "rectangle" | "ellipse") => liveToolId === "geo" && geoStyle === geo;

  // spec.md M6 subtask 10 - exactly mirrors tldraw's own native style panel
  // logic (verified against node_modules/tldraw/dist-esm/lib/ui/components/
  // StylePanel/StylePanelContext.mjs's `onValueChange`, the handler every
  // native picker in the now-deleted `StylePanelWithoutOpacity` used): when
  // shapes are selected, restyle them via `setStyleForSelectedShapes` in
  // addition to (not instead of) `setStyleForNextShapes`, so a subsequently
  // drawn shape keeps the same style. `editor.isIn("select")` is the same
  // check the native panel used to decide whether "there's an active
  // selection to restyle" (rather than e.g. checking
  // `getSelectedShapeIds().length`), and `updateInstanceState({
  // isChangingStyle: true })` reproduces the same brief "style is actively
  // being changed" UI flag tldraw's own panel sets (used elsewhere by
  // tldraw internals to suppress hover UI while dragging a style picker) -
  // kept for parity even though nothing in this app's own UI currently
  // reads it.
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
      <FormatBtn tip="Select" active={liveToolId === "select"} onClick={() => setTool("select")}>
        <MousePointer2 className="h-3.5 w-3.5" />
      </FormatBtn>
      <FormatBtn tip="Pencil" active={liveToolId === "draw"} onClick={() => setTool("draw")}>
        <Pencil className="h-3.5 w-3.5" />
      </FormatBtn>
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

      <Separator orientation="vertical" className="mx-1 h-5" />

      <FormatBtn
        tip="Back to text"
        active={liveToolId === "rich-text"}
        onClick={() => setTool("rich-text")}
      >
        <Type className="h-3.5 w-3.5" />
      </FormatBtn>
    </div>
  );
}

export function Ribbon() {
  const pathname = usePathname();
  const activeCanvasEditor = useAppStore((s) => s.activeCanvasEditor);
  const normalizedPathname = normalizePathname(pathname);
  const isCanvasRoute = normalizedPathname === "/canvas";

  const [activeTab, setActiveTab] = useState<RibbonTab>("file");

  // If the Draw tab is currently active and the route navigates away from
  // /canvas (e.g. the user opens a plain note), fall back to File rather
  // than leaving an unreachable tab selected with no button to reach it.
  const effectiveTab = activeTab === "draw" && !isCanvasRoute ? "file" : activeTab;

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: "file", label: "File" },
    { id: "format", label: "Format" },
    ...(isCanvasRoute ? ([{ id: "draw", label: "Draw" }] as const) : []),
  ];

  // spec.md M2 subtask 4 ("Draw tab rebuild") - "Switching to the File or
  // Format tab ... always returns the canvas to the `rich-text` tool."
  // Runs whenever the effective (i.e. actually-displayed) tab settles on
  // something other than Draw - covers both an explicit File/Format click
  // AND the route-navigated-away-from-canvas fallback above, and re-checks
  // `activeCanvasEditor` too (a canvas can mount/unmount independently of
  // tab clicks). Deliberately does nothing while `effectiveTab === "draw"` -
  // that tab's own buttons (including its "Back to text" button) are what
  // drive `setCurrentTool` while Draw itself is active.
  //
  // Guarded against interrupting an in-flight tldraw drag gesture (marquee-
  // select/shape-translate/resize/rotate, including gestures RichTextTool.tsx
  // hands off to real `select` states via `handOffToBrushing`/
  // `handOffToTranslating`) - same reasoning/mechanism as that file's own
  // `watchForReturnToSelectIdle`/`installRichTextToolAutoReturn`: forcing a
  // tool switch mid-gesture is destructive/jarring, so if the user switches
  // to File/Format while mid-drag, this waits (via tldraw's own `react()`
  // fine-grained reactivity, not a store listener - tool-chart transitions
  // aren't document/session-store events) for the gesture to genuinely
  // settle before actually calling `setCurrentTool("rich-text")`.
  useEffect(() => {
    if (effectiveTab === "draw") return;
    if (!activeCanvasEditor) return;

    const isMidGesture = (editor: Editor) =>
      editor.inputs.getIsPointing() ||
      editor.inputs.getIsDragging() ||
      editor.isInAny(
        "select.translating",
        "select.brushing",
        "select.resizing",
        "select.rotating",
      );

    if (!isMidGesture(activeCanvasEditor)) {
      activeCanvasEditor.setCurrentTool("rich-text");
      return;
    }

    const stop = react("ribbon: deferred return to rich-text after in-flight gesture", () => {
      if (isMidGesture(activeCanvasEditor)) return;
      stop();
      activeCanvasEditor.disposables.delete(stop);
      activeCanvasEditor.setCurrentTool("rich-text");
    });
    activeCanvasEditor.disposables.add(stop);

    return () => {
      stop();
      activeCanvasEditor.disposables.delete(stop);
    };
  }, [effectiveTab, activeCanvasEditor]);

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
          <div className="flex items-center text-muted-foreground">No actions available.</div>
        )}
        {effectiveTab === "format" && <FormatTab />}
        {effectiveTab === "draw" && <DrawTab />}
      </div>
    </div>
  );
}
