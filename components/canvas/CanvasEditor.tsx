"use client";

// updatePage writes to SQLite and schedules the Firestore push, so there's no
// sync status to manage here.

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

// Module-level so <Tldraw> sees stable identities; it rebuilds internal
// registries otherwise.
const shapeUtils = [RichTextShapeUtil];
const tools = [RichTextTool];
// Backstop so tldraw can never create its native text shape on double-click.
const tldrawOptions = { createTextOnCanvasDoubleClick: false };

// Module-level guard so Strict Mode's double invoke can't create two default
// pages for the same note.
const inFlightDefaultPageCreation = new Map<string, Promise<string>>();

// Minimum page area in tldraw units (roughly Letter/A4 proportions at 100%).
const DEFAULT_PAGE_BOUNDS = { x: 0, y: 0, w: 850, h: 1100 };

// 'inside' keeps the page within the viewport. setCameraOptions re-clamps
// immediately, so calling this again with larger bounds takes effect live.
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

// Two formatters, because a single en-US date+time formatter inserts "at"
// between them.
const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const longTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
function formatLongLastEdited(ms: number) {
  const d = new Date(ms);
  return `${longDateFormatter.format(d)} ${longTimeFormatter.format(d)}`;
}

export function CanvasEditor({ note }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets a pending debounced save flush on unmount (the component is keyed by
  // note id).
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

      // Notes from before pages existed have no page rows: create a default
      // page and carry over canvasData. Tiptap-only content needs a live editor
      // and is migrated in handleMount.
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

  // Committed on blur or Enter through the same path as PageItem's rename, so
  // both stay in sync.
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
      // Read fresh store state: PageSidebar may have refreshed pages during the
      // await.
      const freshPages = useAppStore.getState().pages;
      setPages(
        freshPages.map((p) =>
          p.id === selectedPage.id ? { ...p, title: trimmed, updatedAt: Date.now() } : p,
        ),
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

      // Fresh per mount (the editor remounts on page switch); only ever grows.
      let confinedBounds = Box.From(DEFAULT_PAGE_BOUNDS);
      applyPageCameraConstraints(editor, confinedBounds);

      // Grows the confined area to cover content that extends past it.
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

      // tldraw always starts in "select", so switch to this app's default tool
      // after mount.
      editor.setCurrentTool("rich-text");

      const uninstallRichTextToolAutoReturn = installRichTextToolAutoReturn(editor);

      // The page's snapshot is the source of truth. An old note with Tiptap
      // content and no canvasData is wrapped into a RichTextShape below.
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
        // Checking the live shape count keeps this idempotent under Strict
        // Mode. Only the note's first page receives the old content.
        editor.createShape<RichTextShape>({
          type: "rich-text",
          x: 40,
          y: 40,
          props: { w: 480, h: 320, content: note.content as object },
        });
        const snapshot = editor.getSnapshot();
        void updatePage(page.id, { canvasData: snapshot as unknown as object });
      }

      const unlisten = editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          pendingSaveRef.current = true;
          saveTimer.current = setTimeout(() => {
            const snapshot = editor.getSnapshot();
            void updatePage(page.id, { canvasData: snapshot as unknown as object }).then(() => {
              // updatePage only writes the DB; refresh the in-memory pages so
              // the header's updatedAt stays current.
              const freshPages = useAppStore.getState().pages;
              setPages(
                freshPages.map((p) =>
                  p.id === page.id ? { ...p, updatedAt: Date.now() } : p,
                ),
              );
            });
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
        // Flush a pending save so leaving mid-debounce doesn't drop the edit.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          const snapshot = editor.getSnapshot();
          void updatePage(page.id, { canvasData: snapshot as unknown as object }).then(() => {
            const freshPages = useAppStore.getState().pages;
            setPages(
              freshPages.map((p) =>
                p.id === page.id ? { ...p, updatedAt: Date.now() } : p,
              ),
            );
          });
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
      <div className="shrink-0 px-4 py-1 text-xs text-muted-foreground">
        {formatLongLastEdited(selectedPage.updatedAt)}
      </div>
      <div className="canvas-editor-canvas relative flex-1">
      {/*
        Hide tldraw's own toolbar and panels (the Ribbon switches tools). Not
        hideUi, which would also remove toasts and dialogs.
      */}
      {/*
        Keyed by page: tldraw's onMount fires once per editor instance, so a
        page switch needs a full remount.
      */}
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
