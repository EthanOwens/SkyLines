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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Tldraw,
  react,
  type Editor,
  type TLEditorSnapshot,
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

// spec.md M4 subtask 6 ("Per-page canvas confinement, expandable on
// overflow") - a sensible default "page-sized" bound in tldraw page-space
// units, roughly matching a Letter/A4 page's proportions at a 1 page-unit =
// 1px-at-100%-zoom scale (tldraw's own default shapes - e.g. geo shapes - are
// sized on the order of 100-200 units, so ~850x1100 reads as a full page
// rather than a single shape). There's no existing precedent for this size
// anywhere else in the codebase; chosen purely for a "normal document page"
// feel per the spec's own suggestion. This is the FLOOR the confined area
// never shrinks below - see `applyPageCameraConstraints` and its caller in
// `handleMount` below for how it's unioned with actual shape content and
// only ever grows from here.
const DEFAULT_PAGE_BOUNDS = { x: 0, y: 0, w: 850, h: 1100 };

// spec.md M4 subtask 6 - applies (or re-applies) tldraw's camera
// `constraints` with the given `bounds`. Verified against the installed
// @tldraw/tldraw 4.5.12 (node_modules/@tldraw/editor/dist-esm/lib/editor/
// Editor.mjs's `setCameraOptions`): calling this again with a NEW `bounds`
// after mount does take live effect - `setCameraOptions` internally calls
// `this.setCamera(this.getCamera())` right after storing the new options,
// which re-clamps the CURRENT camera position/zoom against the freshly
// updated constraints, so an already-panned/zoomed camera is immediately
// re-clamped into the newly expanded area rather than requiring a manual
// reset. `behavior: 'inside'` (see @tldraw/editor's `TLCameraConstraints` -
// node_modules/@tldraw/editor/dist-cjs/index.d.ts) keeps the ENTIRE bounds
// box clamped within the viewport at all times - i.e. you can pan/zoom
// freely within the page, but can't pan the page fully out of view - which
// is the "bounded, not infinitely pannable... matching a normal document
// page's feel" behavior the spec calls for (confirmed against
// node_modules/tldraw/src/test/commands/setCamera.test.ts's "Inside
// behavior" cases, which show panning far past the bounds gets clamped to
// bounds + padding on every side).
function applyPageCameraConstraints(editor: Editor, bounds: Box) {
  editor.setCameraOptions({
    ...editor.getCameraOptions(),
    constraints: {
      bounds: bounds.toJson(),
      padding: { x: 40, y: 40 },
      origin: { x: 0.5, y: 0 },
      initialZoom: "fit-x-100",
      baseZoom: "default",
      behavior: "inside",
    },
  });
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

  // spec.md M4 subtask 7 ("Page title header on the canvas") - local editing
  // buffer for the inline-editable title header rendered above the confined
  // canvas below, mirroring PageItem.tsx's own `title`/`renaming` local
  // state exactly (same "buffer while editing, commit on blur/Enter" shape).
  // Kept as plain component state (not written into stores/appStore.ts)
  // since it's just an in-progress edit, same as PageItem.tsx's own copy -
  // the shared `pages` array in the store is only touched on commit, via
  // the exact same `updatePage` + `setPages` path PageSidebar.tsx's
  // `refresh()` uses, so both this header and the sidebar's `PageItem` stay
  // in sync through that one shared store field rather than two independent
  // title-editing implementations.
  const [titleDraft, setTitleDraft] = useState(selectedPage?.title || "Untitled");

  // Resyncs the local draft whenever the selected page changes (including a
  // rename that came from PageSidebar/PageItem.tsx, since that updates the
  // same shared `pages` store this reads from) - without this, switching
  // pages or a sidebar-driven rename would leave this input showing a stale
  // title until the user next interacts with it.
  useEffect(() => {
    setTitleDraft(selectedPage?.title || "Untitled");
  }, [selectedPage?.id, selectedPage?.title]);

  async function commitTitle() {
    if (!selectedPage) return;
    const trimmed = titleDraft.trim() || "Untitled";
    setTitleDraft(trimmed);
    if (trimmed !== selectedPage.title) {
      await updatePage(selectedPage.id, { title: trimmed });
      // Reads the live store state right before mapping (rather than the
      // `pages` closed over at render time) - `await updatePage(...)` above
      // yields to the event loop, and PageSidebar.tsx's `refresh()` (a full
      // `getPages(note.id)` refetch, triggered by drag-reorder, add-page,
      // delete, or paste) can land in that window. Mapping over a stale
      // `pages` snapshot here would silently overwrite whatever the sidebar
      // just wrote.
      const freshPages = useAppStore.getState().pages;
      setPages(
        freshPages.map((p) => (p.id === selectedPage.id ? { ...p, title: trimmed } : p)),
      );
    }
  }

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

      // spec.md M4 subtask 6 ("Per-page canvas confinement, expandable on
      // overflow") - set up fresh on every mount, since <Tldraw>'s
      // `key={selectedPage.id}` (see below) fully remounts per page switch,
      // so this needs to run again for each fresh `editor` instance rather
      // than once globally. `confinedBounds` starts at the default
      // page-sized bound and is reassigned (never shrunk - see
      // `Box.Common`'s union semantics below) each time content grows past
      // it, so it only ever expands for the lifetime of this mount.
      let confinedBounds = Box.From(DEFAULT_PAGE_BOUNDS);
      applyPageCameraConstraints(editor, confinedBounds);

      // Reactively tracks the union of the current confined bounds and the
      // page's actual shape content bounds (`editor.getCurrentPageBounds()`
      // - verified via node_modules/@tldraw/editor/dist-cjs/index.d.ts,
      // returns `Box | undefined`, `undefined` when the page has no shapes),
      // re-applying the camera constraints whenever that union grows beyond
      // the currently-applied bounds. Uses tldraw's own fine-grained
      // reactivity (`react()`, re-exported from `@tldraw/state` through
      // `@tldraw/tldraw` - same technique RichTextTool.tsx's
      // `watchForReturnToSelectIdle` already uses for reactive
      // editor-state watching, rather than `editor.store.listen`, since
      // `getCurrentPageBounds()` is a derived/computed signal, not a raw
      // store-change event) - the callback re-runs automatically whenever
      // any signal it reads (here, `getCurrentPageBounds()`) changes, no
      // manual subscription bookkeeping needed. `Box.Common([a, b])` always
      // returns a box that contains both inputs, so unioning against the
      // CURRENT `confinedBounds` (rather than recomputing fresh from
      // `DEFAULT_PAGE_BOUNDS` each time) guarantees this only ever grows,
      // never shrinks back down when shapes are later moved/deleted - per
      // the spec's "if content extends... it extends the confined space"
      // wording, with no shrink-back behavior requested.
      const stopConfinementWatcher = react(
        "canvas confinement: expand bounds to include shape content",
        () => {
          const contentBounds = editor.getCurrentPageBounds();
          if (!contentBounds) return;
          const union = Box.Common([confinedBounds, contentBounds]);
          if (
            union.x !== confinedBounds.x ||
            union.y !== confinedBounds.y ||
            union.w !== confinedBounds.w ||
            union.h !== confinedBounds.h
          ) {
            confinedBounds = union;
            applyPageCameraConstraints(editor, confinedBounds);
          }
        },
      );

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
      } else if (
        note.content &&
        page.id === pages[0]?.id &&
        editor.getCurrentPageShapes().length === 0
      ) {
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
        //
        // `page.id === pages[0]?.id` (spec.md M1 subtask 1 fix follow-up):
        // `note.content` is never cleared after this migration runs (see
        // lib/db/notes.ts - no code path sets it back to null), so it stays
        // truthy for the lifetime of a legacy note. Before `<Tldraw>` had
        // `key={selectedPage.id}` (see below), `onMount` only ever fired
        // once total regardless of page, so this was unreachable more than
        // once. Now that `onMount` genuinely re-fires on every page switch,
        // without this guard EVERY page with 0 shapes and no `canvasData` -
        // including a brand-new blank page just created via the Page
        // sidebar, or any page whose shapes were all deleted - would get a
        // duplicate copy of the old note-level content injected. `content`
        // legitimately only ever belonged to the note's original page (the
        // one that existed before the Page model), so gating on
        // `pages[0]` (the note's first page, per `getPages`'s stable
        // `order_index ASC` ordering - see lib/db/pages.ts) instead of
        // clearing `note.content` post-migration keeps this consistent with
        // this codebase's non-destructive-migration philosophy: `note.content`
        // stays untouched forever (mirroring how `note.canvasData` above is
        // only ever copied FROM, never mutated), while still guaranteeing a
        // second/third/new page can never receive a duplicate injection.
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
        stopConfinementWatcher();
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
    [selectedPage, note.content, pages, setActiveCanvasEditor],
  );

  if (pagesLoading || !selectedPage) {
    return (
      <div className="flex flex-1 h-full w-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="canvas-editor-container relative flex h-full w-full flex-1 flex-col">
      {/* spec.md M4 subtask 7 ("Page title header on the canvas") - renders
          ABOVE the confined canvas area as a separate UI layer/sibling, not
          inside <Tldraw> itself, so it's unaffected by subtask 6's camera
          confinement (that logic lives entirely inside `handleMount`/
          `applyPageCameraConstraints` below and isn't touched here). The
          horizontal rule below the title is a genuine `border-bottom` (per
          the spec's explicit "a border, not `text-decoration: underline`"
          requirement - those render visually differently), not text
          decoration on the input itself. Inline-editable via a plain
          `<input>`, mirroring PageItem.tsx's own inline-rename `<input>`
          pattern (same value/onChange/onBlur/Enter-to-commit/Escape-to-
          revert shape) for a consistent UX with the sidebar's rename UI. */}
      <div className="shrink-0 border-b border-border px-4 py-2">
        <input
          className="w-full bg-transparent text-lg font-semibold text-foreground outline-none"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setTitleDraft(selectedPage.title || "Untitled");
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="canvas-editor-canvas relative flex-1">
      {/* spec.md M2 subtask 4 ("Draw tab rebuild") - hides tldraw's own
          native toolbar/menu/zoom/etc. chrome so this app's own ribbon
          (components/ribbon/Ribbon.tsx's Draw tab) is the sole
          tool-switcher, WITHOUT the `hideUi` prop, which would also suppress
          tldraw's Toasts/Dialogs/A11y layers this app still relies on.
          Instead, this uses tldraw's independently-swappable `components`
          override (see node_modules/tldraw/dist-esm/lib/ui/context/
          components.mjs's `TldrawUiComponentsProvider`, confirmed against
          the installed tldraw 4.5.12), nulling out every chrome slot
          including `StylePanel` (spec.md M6 subtask 9 - previously kept
          alive minus its opacity slider per M5 subtask 10, now fully
          suppressed; verified against node_modules/tldraw/dist-esm/lib/ui/
          TldrawUi.mjs's `StylePanel && ... && jsx(StylePanel, {})` render
          guard, which short-circuits entirely when the slot is `null` - see
          also node_modules/tldraw/dist-cjs/index.d.ts's
          `TLUiComponents.StylePanel?: ComponentType<TLUiStylePanelProps> |
          null`, confirming `null` is the intended way to fully opt a slot
          out rather than just replace its content). A ribbon-native
          replacement for color/fill/dash/size controls is built in the very
          next subtask (M6 subtask 10) - until then there is intentionally no
          UI to restyle a shape, mirroring this exact "hide native chrome
          first, rebuild in ribbon next" pattern already used for the rest of
          tldraw's toolbar/menu chrome above. The canvas itself (shapes,
          selection, editing) is entirely unaffected either way; only the
          surrounding native UI chrome is suppressed. */}
      {/* spec.md M1 subtask 1 (critical bug fix) - `key={selectedPage.id}`
          forces a full remount of <Tldraw> whenever the selected page
          changes. Without this, tldraw's own `onMount` (wrapped internally
          by its `useEvent`) only ever fires once per editor/store instance,
          so `handleMount` above never re-runs on a page switch: the
          `editor.loadSnapshot` call never reloads the newly-selected page's
          `canvasData`, and the `editor.store.listen(...)` autosave closure
          keeps writing to whatever page was selected at first mount,
          forever - silently overwriting the wrong page. Remounting here
          mirrors the identical `key={note.id}` pattern already used one
          level up in app/canvas/page.tsx for note-switching. This is
          guaranteed non-null at this point in the render because of the
          `pagesLoading || !selectedPage` early return above. The tradeoff
          (accepted per spec.md's Key Decision) is a brief re-init flash on
          every page switch, since the outgoing <Tldraw> instance fully
          unmounts (running handleMount's cleanup, which flushes any pending
          debounced save via `pendingSaveRef` to the OUTGOING page) before
          the new instance mounts and runs `handleMount` fresh for the
          incoming page. */}
      <Tldraw
        key={selectedPage.id}
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
          StylePanel: null,
        }}
      />
      </div>
    </div>
  );
}
