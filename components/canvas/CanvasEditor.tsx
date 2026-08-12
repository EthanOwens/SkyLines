"use client";

// Adapted from ../note_taking_app/components/canvas/CanvasEditor.tsx
// (spec.md subtask 18, M4 "canvas editor"). One change from the reference:
//
//   No manual `setSyncStatus("syncing"/"saved"/"error")` calls around the
//   snapshot autosave. The reference toggled `syncStatus` itself because it
//   wrote straight to Firestore. Here, saves go through lib/db/pages.ts's
//   `updatePage` (spec.md M6 subtask 16 - this component now reads/writes
//   the note's currently-selected Page, not the note itself; see below),
//   which writes to local SQLite and (via the change-notification ->
//   useSyncEngine.ts chain wired in subtask 15) automatically schedules a
//   real, debounced Firestore push - the real `syncStatus` in
//   stores/appStore.ts already reflects that actual push activity, so this
//   component no longer needs to fake it. The 800ms debounce on the
//   snapshot autosave is kept unchanged from the reference (distinct from
//   the rich text editor's 600ms - tldraw's `store.listen` callback fires
//   very frequently during canvas interaction, so this debounce matters
//   even more here).

import { useCallback, useEffect, useRef } from "react";
import {
  DefaultStylePanel,
  StylePanelArrowKindPicker,
  StylePanelArrowheadPicker,
  StylePanelColorPicker,
  StylePanelDashPicker,
  StylePanelFillPicker,
  StylePanelFontPicker,
  StylePanelGeoShapePicker,
  StylePanelLabelAlignPicker,
  StylePanelSection,
  StylePanelSizePicker,
  StylePanelSplinePicker,
  StylePanelTextAlignPicker,
  Tldraw,
  type Editor,
  type TLEditorSnapshot,
  type TLUiStylePanelProps,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { createPage, getPages, updatePage } from "@/lib/db/pages";
import { useAppStore } from "@/stores/appStore";
import type { Note } from "@/types";
import { RichTextShapeUtil, type RichTextShape } from "./RichTextShape";
import { RichTextTool, installRichTextToolAutoReturn } from "./RichTextTool";

// spec.md subtask 1 ("RichTextShape") - registers the custom shape type via
// tldraw's `shapeUtils` prop. Defined as a module-level constant (rather
// than inline in the JSX below) so it's referentially stable across
// re-renders - <Tldraw> re-creates its internal shape registry if this
// array's identity changes.
const shapeUtils = [RichTextShapeUtil];

// spec.md subtask 2 ("Click-to-create tool") - registers the custom
// click-to-create tool via tldraw's `tools` prop (see Tldraw.tsx's
// `mergeArraysAndReplaceDefaults('id', tools, allDefaultTools)`, which adds
// this alongside - not instead of - tldraw's own select/draw/etc. tools).
// Same referential-stability reasoning as `shapeUtils` above.
const tools = [RichTextTool];

// Module-level (i.e. survives across this component's own remounts, not
// just re-renders) in-flight guard for the "note has zero pages, lazily
// create a default one" self-healing path below, keyed by `note.id`. React
// Strict Mode's dev-mode double-invoke-then-cleanup-then-invoke-again
// pattern means two independent effect invocations can both call
// `getPages(note.id)`, both see it come back empty (the first invocation's
// `createPage` hasn't resolved/committed yet), and would otherwise both call
// `createPage` - producing two duplicate empty pages for the same note. This
// map lets a second concurrent invocation for the SAME note find and await
// the first invocation's in-flight creation promise instead of starting its
// own; only one `createPage` call ever actually runs per note. Mirrors the
// `pushInFlight` guard pattern in lib/sync/engine.ts.
const inFlightDefaultPageCreation = new Map<string, Promise<string>>();

// spec.md M5 subtask 10 ("Remove tldraw's built-in opacity slider") - tldraw
// 4.5.12 (verified via node_modules/tldraw/dist-esm) has no sub-component-
// level override slot for just the opacity control within its default style
// panel; the `components` prop's `StylePanel` slot only lets you replace the
// panel wholesale (see node_modules/tldraw/dist-cjs/index.d.ts's
// `TLUiComponents.StylePanel?: ComponentType<TLUiStylePanelProps> | null`).
// However, tldraw DOES export `DefaultStylePanel` (the outer
// container/wrapper - keyboard handling, pointer-out styling reset, mobile
// class, etc.) as a component that accepts a `children` override instead of
// rendering its own default content when children are passed (see
// node_modules/tldraw/dist-esm/lib/ui/components/StylePanel/
// DefaultStylePanel.mjs: `children ?? <DefaultStylePanelContent />`), plus
// every individual picker sub-component `DefaultStylePanelContent` itself is
// built from (`StylePanelColorPicker`, `StylePanelFillPicker`, etc. - see
// node_modules/tldraw/dist-esm/lib/ui/components/StylePanel/
// DefaultStylePanelContent.mjs's named exports). So instead of hand-rolling
// the whole panel, this reconstructs `DefaultStylePanelContent`'s exact
// section layout via those exported pickers, just omitting
// `StylePanelOpacityPicker` (the only omission), and passes it as
// `DefaultStylePanel`'s `children`. Every other control (color, fill, dash,
// size, font, text/label align, geo shape, arrow kind/heads, spline) keeps
// its exact stock tldraw component and behavior.
function StylePanelWithoutOpacity(props: TLUiStylePanelProps) {
  return (
    <DefaultStylePanel {...props}>
      <StylePanelSection>
        <StylePanelColorPicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelFillPicker />
        <StylePanelDashPicker />
        <StylePanelSizePicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelFontPicker />
        <StylePanelTextAlignPicker />
        <StylePanelLabelAlignPicker />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelGeoShapePicker />
        <StylePanelArrowKindPicker />
        <StylePanelArrowheadPicker />
        <StylePanelSplinePicker />
      </StylePanelSection>
    </DefaultStylePanel>
  );
}

interface Props {
  note: Note;
}

export function CanvasEditor({ note }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether a debounced save is pending (i.e. the store changed but
  // the 800ms timer hasn't fired yet), so it can be flushed synchronously on
  // unmount below. This component is keyed by note.id (see
  // app/canvas/page.tsx), so an unmount always corresponds to leaving this
  // exact note - no risk of flushing to the wrong note here.
  const pendingSaveRef = useRef(false);
  const setActiveCanvasEditor = useAppStore((s) => s.setActiveCanvasEditor);

  // spec.md M6 subtask 16: the canvas editor now operates on one of the
  // note's Pages, not on the note itself. `pages` + `selectedPageId` used to
  // be plain component-local state here; spec.md subtask 17 ("Page
  // sidebar") lifted them into stores/appStore.ts instead (still NOT part
  // of the global `noteHistory` back/forward stack, per the spec's Key
  // Decision that page-switching stays note-scoped/local UI state), so the
  // new `PageSidebar` component (rendered as this component's sibling in
  // app/canvas/page.tsx) can read/write the very same "which page is
  // selected" value - selecting a row there needs to actually change what
  // this component renders.
  const pages = useAppStore((s) => s.pages);
  const setPages = useAppStore((s) => s.setPages);
  const selectedPageId = useAppStore((s) => s.selectedPageId);
  const setSelectedPageId = useAppStore((s) => s.setSelectedPageId);
  const pagesLoading = useAppStore((s) => s.pagesLoading);
  const setPagesLoading = useAppStore((s) => s.setPagesLoading);

  useEffect(() => {
    let cancelled = false;
    setPagesLoading(true);
    setPages([]);
    setSelectedPageId(null);

    (async () => {
      let notePages = await getPages(note.id);

      // Defensive self-healing (spec.md subtask 16): every note created via
      // `createNote` (subtask 14) atomically gets a default first page, but
      // notes that existed before that shipped currently have ZERO page
      // rows. Rather than crash or render a broken blank canvas, lazily
      // create a single default page the moment such a note is opened here
      // - mirroring `createNote`'s own "always ≥1 page" invariant, just
      // applied at read-time.
      //
      // This MUST NOT silently drop the note's pre-existing content (see
      // app/note/page.tsx's header comment, which documents that its
      // `/note?id=...` -> `/canvas?id=...` redirect for old-format notes is
      // only safe because this component performs an inline migration on
      // mount). Two cases:
      //   - `note.canvasData` truthy: the note already has a tldraw
      //     snapshot but was never given a page (e.g. it predates subtask
      //     16's Page model) - copy it straight onto the new page below.
      //   - `note.canvasData` falsy but `note.content` truthy: a true
      //     old-format `type: "note"` row (real Tiptap content, no canvas
      //     data yet). `createPage` alone can't run tldraw editor commands
      //     to wrap that into a RichTextShape, so that half of the
      //     migration is deferred to `handleMount` below (see its comment),
      //     which persists the result onto this same page via `updatePage`
      //     once the editor is available.
      //
      // `inFlightDefaultPageCreation` (module-level, see its comment above)
      // makes the actual `createPage` call itself race-safe against React
      // Strict Mode's double-invoke-then-cleanup-then-invoke-again pattern -
      // without it, two concurrent invocations of this effect for the same
      // note could both observe `getPages` returning empty and both call
      // `createPage`, producing two duplicate default pages.
      if (notePages.length === 0) {
        let creation = inFlightDefaultPageCreation.get(note.id);
        if (!creation) {
          creation = (async () => {
            const newPageId = await createPage(note.id, note.userId, "Untitled", 0);
            if (note.canvasData) {
              await updatePage(newPageId, { canvasData: note.canvasData });
            }
            return newPageId;
          })();
          inFlightDefaultPageCreation.set(note.id, creation);
          void creation.finally(() => {
            inFlightDefaultPageCreation.delete(note.id);
          });
        }
        await creation;
        notePages = await getPages(note.id);
      }

      if (cancelled) return;
      setPages(notePages);
      setSelectedPageId(notePages[0]?.id ?? null);
      setPagesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [note.id, note.userId]);

  const selectedPage =
    pages.find((p) => p.id === selectedPageId) ?? pages[0] ?? null;

  const handleMount = useCallback(
    (editor: Editor) => {
      const page = selectedPage;
      // Guarded defensively for type-narrowing only - the <Tldraw> below is
      // never rendered until `selectedPage` is non-null (see the
      // `pagesLoading`/`!selectedPage` early return further down), so this
      // should be unreachable in practice.
      if (!page) return;

      // Exposes the live tldraw `editor` instance to TopBar.tsx's top-bar
      // Undo/Redo (spec.md subtask 15, "Undo/redo wiring") via
      // stores/appStore.ts, mirroring RichTextEditor.tsx's `setActiveEditor`
      // pattern for Tiptap. Cleared back to `null` in the cleanup function
      // returned below (tldraw's `onMount` contract) so TopBar correctly
      // falls back to a neutral/disabled state once this canvas unmounts.
      setActiveCanvasEditor(editor);

      // spec.md subtask 2 ("Click-to-create tool") - makes the rich-text
      // tool the default/primary interaction on mount (design guidance:
      // "set this new tool as the DEFAULT active tool when a canvas note
      // first mounts"), instead of leaving tldraw's own `select` as the
      // default. tldraw's `<TldrawEditor>` hardcodes `initialState="select"`
      // internally (see Tldraw.tsx) with no prop to override it, so this is
      // switched right after mount instead - the same place/pattern
      // `editor.loadSnapshot` below already uses for other one-time
      // post-mount setup. Users can still switch to `select`/`draw`/etc. via
      // the toolbar (or `editor.setCurrentTool(...)`) exactly like any other
      // tldraw tool - this only changes what's active by default.
      editor.setCurrentTool("rich-text");

      // See RichTextTool.tsx's header comment for why this is needed
      // (tldraw's own framework force-switches `currentTool` to `select`
      // any time a shape enters edit mode - this keeps the rich-text tool
      // "sticky" across repeated click-to-create actions the way spec.md's
      // "just works, no reselecting a tool" requirement needs).
      const uninstallRichTextToolAutoReturn = installRichTextToolAutoReturn(editor);

      // Load persisted snapshot from the SELECTED PAGE (spec.md subtask 16),
      // not from the note itself - the page's own `canvasData` is now the
      // source of truth once it's populated. `note.canvasData` copies onto
      // a lazily-created page directly (no editor needed for a straight
      // object copy - see the `getPages`/`createPage` effect above), so by
      // the time this runs `page.canvasData` already reflects it if it
      // existed.
      //
      // The remaining case - a true old-format `type: "note"` row with real
      // Tiptap `content` and no `canvasData` at all (see app/note/page.tsx's
      // header comment) - can't be resolved above because wrapping it into a
      // RichTextShape needs a live tldraw `editor`. This is the same
      // minimal, idempotent inline migration spec.md subtask 6 originally
      // added (wrap `note.content` into a single RichTextShape, then
      // persist), just now targeting this page via `updatePage` instead of
      // the note via `updateNote`: once persisted, `page.canvasData` is
      // truthy on every subsequent open, so this branch never runs twice
      // for the same page.
      if (page.canvasData) {
        try {
          editor.loadSnapshot(page.canvasData as TLEditorSnapshot);
        } catch {
          // Snapshot incompatible — start fresh
        }
      } else if (note.content && editor.getCurrentPageShapes().length === 0) {
        // `page` is captured from this component's own React state, so it
        // stays stale (still reflecting canvasData: null) across React
        // Strict Mode's dev-mode double-invoke of onMount, which reuses the
        // SAME underlying tldraw editor/store instance for both
        // invocations - confirmed live via CDP in an earlier subtask.
        // Checking the live editor's own current shape count (not just the
        // stale `page`/`note` props) is what makes this idempotent: a
        // second invocation sees a non-empty page and skips, instead of
        // creating a second overlapping RichTextShape from the same
        // content.
        editor.createShape<RichTextShape>({
          type: "rich-text",
          x: 40,
          y: 40,
          props: { w: 480, h: 320, content: note.content as object },
        });
        const snapshot = editor.getSnapshot();
        void updatePage(page.id, { canvasData: snapshot as unknown as object });
      }

      // Listen for changes and auto-save
      const unlisten = editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          pendingSaveRef.current = true;
          saveTimer.current = setTimeout(() => {
            const snapshot = editor.getSnapshot();
            void updatePage(page.id, { canvasData: snapshot as unknown as object });
            pendingSaveRef.current = false;
          }, 800);
        },
        { source: "user", scope: "document" },
      );

      return () => {
        setActiveCanvasEditor(null);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unlisten();
        uninstallRichTextToolAutoReturn();
        // Flush any pending debounced save on unmount, so navigating away
        // within the 800ms debounce window doesn't silently drop the edit.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          const snapshot = editor.getSnapshot();
          void updatePage(page.id, { canvasData: snapshot as unknown as object });
        }
      };
    },
    [selectedPage, note.content, setActiveCanvasEditor],
  );

  if (pagesLoading || !selectedPage) {
    return (
      <div className="flex flex-1 h-full w-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="canvas-editor-container relative flex-1 h-full w-full">
      {/* spec.md M2 subtask 4 ("Draw tab rebuild") - hides tldraw's own
          native toolbar/menu/zoom/etc. chrome so this app's own ribbon
          (components/ribbon/Ribbon.tsx's Draw tab) is the sole
          tool-switcher, WITHOUT the `hideUi` prop, which suppresses tldraw's
          ENTIRE UI including the `StylePanel` (shape stroke color/fill/
          stroke-width/opacity/dash/arrowhead controls) - there is no
          replacement for that UI anywhere else in this app, so `hideUi`
          would leave users with no way to restyle a shape once created.
          Instead, this uses tldraw's independently-swappable `components`
          override (see node_modules/tldraw/dist-esm/lib/ui/context/
          components.mjs's `TldrawUiComponentsProvider`, confirmed against
          the installed tldraw 4.5.12), nulling out every chrome slot EXCEPT
          `StylePanel`, which renders `StylePanelWithoutOpacity` above (spec.md
          M5 subtask 10) - tldraw's own style panel minus just the opacity
          slider. The canvas itself (shapes, selection, editing) is entirely
          unaffected either way; only the surrounding native UI chrome (minus
          the style panel's opacity control) is suppressed. */}
      <Tldraw
        shapeUtils={shapeUtils}
        tools={tools}
        onMount={handleMount}
        components={{
          Toolbar: null,
          MenuPanel: null,
          ZoomMenu: null,
          MainMenu: null,
          NavigationPanel: null,
          HelpMenu: null,
          ActionsMenu: null,
          PageMenu: null,
          HelperButtons: null,
          QuickActions: null,
          StylePanel: StylePanelWithoutOpacity,
        }}
      />
    </div>
  );
}
