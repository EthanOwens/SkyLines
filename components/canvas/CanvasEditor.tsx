"use client";

// Saves go through lib/db/pages.ts's `updatePage`, which writes to local
// SQLite and schedules a debounced Firestore push via the sync engine - no
// manual syncStatus toggling needed here.

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

// Module-level constants so <Tldraw> sees stable identities across
// re-renders (it re-creates internal registries otherwise).
const shapeUtils = [RichTextShapeUtil];
const tools = [RichTextTool];
// Defensive backstop: even with RichTextTool.tsx's own tool-state fix,
// disable tldraw's native double-click-creates-a-text-shape behavior so a
// future edge case can never surface a native shape instead of ours.
const tldrawOptions = { createTextOnCanvasDoubleClick: false };

// Module-level (survives remounts) in-flight guard for the "note has zero
// pages, lazily create a default one" self-healing path below, keyed by
// note.id - prevents React Strict Mode's double-invoke from creating two
// duplicate default pages for the same note.
const inFlightDefaultPageCreation = new Map<string, Promise<string>>();

// Default "page-sized" bound in tldraw page-space units (roughly a
// Letter/A4 page's proportions at 1 unit = 1px@100%). The floor the
// confined area never shrinks below - see `applyPageCameraConstraints` and
// its caller in `handleMount`.
const DEFAULT_PAGE_BOUNDS = { x: 0, y: 0, w: 850, h: 1100 };

// `behavior: 'inside'` keeps the whole bounds box clamped within the
// viewport - pannable within the page, but not fully out of view.
// `setCameraOptions` re-clamps the current camera immediately, so calling
// this again with a larger `bounds` after mount takes effect live.
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
  // Whether a debounced save is pending, so it can be flushed synchronously
  // on unmount (this component is keyed by note.id, so unmount always means
  // leaving this exact note).
  const pendingSaveRef = useRef(false);
  const setActiveCanvasEditor = useAppStore((s) => s.setActiveCanvasEditor);

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

      // Notes that predate the Page model have zero page rows - lazily
      // create a default one on open instead of crashing/rendering blank.
      // Must not drop pre-existing content: if `note.canvasData` is
      // truthy, copy it onto the new page; if only `note.content` is
      // truthy (old Tiptap-only note), that half of the migration needs a
      // live editor and is deferred to `handleMount` below.
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

  // Local editing buffer for the inline title header, mirroring
  // PageItem.tsx's own rename input - committed on blur/Enter via the same
  // `updatePage` + `setPages` path the sidebar uses, so both stay in sync.
  const [titleDraft, setTitleDraft] = useState(selectedPage?.title || "Untitled");

  useEffect(() => {
    setTitleDraft(selectedPage?.title || "Untitled");
  }, [selectedPage?.id, selectedPage?.title]);

  async function commitTitle() {
    if (!selectedPage) return;
    const trimmed = titleDraft.trim() || "Untitled";
    setTitleDraft(trimmed);
    if (trimmed !== selectedPage.title) {
      await updatePage(selectedPage.id, { title: trimmed });
      // Read fresh store state rather than the `pages` closed over at
      // render time - PageSidebar's own refresh could land in the await
      // above and would otherwise get clobbered.
      const freshPages = useAppStore.getState().pages;
      setPages(
        freshPages.map((p) => (p.id === selectedPage.id ? { ...p, title: trimmed } : p)),
      );
    }
  }

  const handleMount = useCallback(
    (editor: Editor) => {
      const page = selectedPage;
      // Unreachable in practice - <Tldraw> only renders once selectedPage
      // is non-null.
      if (!page) return;

      // Exposes the live editor to TopBar's Undo/Redo.
      setActiveCanvasEditor(editor);

      // Fresh per mount, since <Tldraw>'s key={selectedPage.id} fully
      // remounts on page switch. `confinedBounds` only ever grows (see
      // `Box.Common` below), never shrinks, for the lifetime of this mount.
      let confinedBounds = Box.From(DEFAULT_PAGE_BOUNDS);
      applyPageCameraConstraints(editor, confinedBounds);

      // Reactively expands the confined area to include shape content that
      // grows past it. `react()` re-runs whenever `getCurrentPageBounds()`
      // changes; `Box.Common` unions against the current bounds so this
      // only ever grows.
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

      // tldraw hardcodes `initialState="select"` with no override prop, so
      // switch to this app's own default tool right after mount instead.
      editor.setCurrentTool("rich-text");

      const uninstallRichTextToolAutoReturn = installRichTextToolAutoReturn(editor);

      // Load the selected page's own snapshot - the source of truth once
      // populated. The remaining case (a true old-format note with real
      // Tiptap `content` and no `canvasData` at all) needs a live editor to
      // wrap into a RichTextShape, so it's handled here instead of above;
      // once persisted, `page.canvasData` is truthy on every later open.
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
        // Checking the live editor's shape count (not just the possibly
        // stale `page`/`note` props) keeps this idempotent across Strict
        // Mode's double-invoke of onMount. Gated to the note's first page
        // (not a cleared `note.content` flag) so a new/other page never
        // gets a duplicate injection of the old note-level content.
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
        // Flush any pending debounced save so navigating away mid-debounce
        // doesn't silently drop the edit.
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
      {/* Rendered above the canvas as a separate layer, unaffected by the
          camera confinement below. Border-bottom (a real border, not text
          decoration), inline-editable like PageItem.tsx's rename input. */}
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
      {/* Hides tldraw's own native toolbar/menu/style-panel chrome so
          Ribbon.tsx's Draw tab is the sole tool-switcher - not `hideUi`,
          which would also suppress Toasts/Dialogs/A11y this app still
          uses. `null` fully opts a component slot out. */}
      {/* key={selectedPage.id} forces a full remount on page switch, since
          tldraw's own onMount only fires once per editor/store instance -
          without it, loadSnapshot/autosave would stay pinned to whichever
          page was selected at first mount. Accepted tradeoff: a brief
          re-init flash per switch (LoadingScreen: null below suppresses
          tldraw's own spinner during it). */}
      <Tldraw
        key={selectedPage.id}
        shapeUtils={shapeUtils}
        tools={tools}
        onMount={handleMount}
        options={tldrawOptions}
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
          LoadingScreen: null,
        }}
      />
      </div>
    </div>
  );
}
