"use client";

// updatePage writes to SQLite and schedules the Firestore push, so there's no
// sync status to manage here.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  DefaultContextMenu,
  DefaultContextMenuContent,
  Tldraw,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  react,
  useEditor,
  useValue,
  type Editor,
  type TLAssetStore,
  type TLEditorSnapshot,
  type TLShapeId,
  type TLUiContextMenuProps,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import {
  convertDataUrlsInDoc,
  imageExists,
  isImageToken,
  resolveImageSrc,
  saveDataUrl,
  saveImageBytes,
  stripAssetPrefix,
} from "@/lib/images/localImages";
import { autoColorForNewPage } from "@/lib/colors/autoColor";
import { createPage, getPageRowById, getPages, updatePage } from "@/lib/db/pages";
import { subscribeDataChange } from "@/lib/db/events";
import { revealImage } from "@/lib/tiptap/imageId";
import { useAppStore } from "@/stores/appStore";
import type { Note, Page as PageType } from "@/types";
import { RichTextShapeUtil, useCopyShapeReference, type RichTextShape } from "./RichTextShape";
import {
  RichTextTool,
  installRichTextToolAutoReturn,
  switchToToolExplicitly,
} from "./RichTextTool";

// Module-level so <Tldraw> sees stable identities; it rebuilds internal
// registries otherwise.
const shapeUtils = [RichTextShapeUtil];
const tools = [RichTextTool];
// Module-level for a stable identity. Files are never deleted, so remove is a no-op.
const assetStore: TLAssetStore = {
  async upload(_asset, file) {
    const ext = file.type.split("/")[1]?.replace("svg+xml", "svg").replace("jpeg", "jpg") || "png";
    return { src: "asset:" + (await saveImageBytes(new Uint8Array(await file.arrayBuffer()), ext)) };
  },
  async resolve(asset) {
    const src = asset.props.src;
    const token = src ? stripAssetPrefix(src) : "";
    if (!isImageToken(token)) return src;
    return (await imageExists(token)) ? resolveImageSrc(token) : null;
  },
  async remove() {},
};
// Backstop so tldraw can never create its native text shape on double-click.
const tldrawOptions = { createTextOnCanvasDoubleClick: false };

function CanvasContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor();
  const copyShapeReference = useCopyShapeReference();
  const pageId = useAppStore((s) => s.selectedPageId);
  const onlySelectedShapeId = useValue(
    "only selected shape id",
    () => {
      const ids = editor.getSelectedShapeIds();
      return ids.length === 1 ? ids[0] : null;
    },
    [editor],
  );

  return (
    <DefaultContextMenu {...props}>
      {onlySelectedShapeId && pageId && (
        <TldrawUiMenuGroup id="reference">
          <TldrawUiMenuItem
            id="copy-reference"
            label="Copy reference"
            readonlyOk
            onSelect={() => void copyShapeReference(onlySelectedShapeId)}
          />
        </TldrawUiMenuGroup>
      )}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  );
}

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

// Selected in the select tool, which shows the selection; RichTextTool's
// watcher hands back to the rich-text tool once the selection is cleared.
function revealShape(editor: Editor, shapeId: string, imageId?: string | null) {
  const id = shapeId as TLShapeId;
  const bounds = editor.getShapePageBounds(id);
  if (!bounds) return;
  // Ends any edit session without the auto-return re-entering it.
  switchToToolExplicitly(editor, "rich-text");
  editor.select(id);
  editor.setCurrentTool("select");
  // Never past 100%, so a small box isn't blown up. setCamera keeps the page
  // camera constraints.
  editor.zoomToBounds(bounds, { targetZoom: 1, animation: { duration: 200 } });
  // After the zoom animation, so the highlight is seen.
  if (imageId) setTimeout(() => revealImage(imageId), 300);
}

// A page (and optionally a shape on it) to show, from a followed reference.
interface RevealTarget {
  pageId: string;
  shapeId: string | null;
  imageId: string | null;
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
  // Serialized snapshot last loaded or saved; saves that match it are skipped.
  const lastSnapshotRef = useRef<string | null>(null);
  // updatedAt of the page row the editor last loaded or saved.
  const lastUpdatedAtRef = useRef(0);
  const currentPageIdRef = useRef<string | null>(null);
  // Newest clean remote version waiting to be applied.
  const remoteCandidateRef = useRef<PageType | null>(null);
  const tryApplyRemoteRef = useRef<() => void>(() => {});
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [newerPage, setNewerPage] = useState<PageType | null>(null);
  const setActiveCanvasEditor = useAppStore((s) => s.setActiveCanvasEditor);
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const pageParam = searchParams.get("page");
  const shapeParam = searchParams.get("shape");
  const imageParam = searchParams.get("image");
  const revealTargetRef = useRef<RevealTarget | null>(null);
  const editorRef = useRef<Editor | null>(null);

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
      let notePages = await getPages(note.id, note.userId);

      // Notes from before pages existed have no page rows: create a default
      // page and carry over canvasData. Tiptap-only content needs a live editor
      // and is migrated in handleMount.
      if (notePages.length === 0) {
        let creation = inFlightDefaultPageCreation.get(note.id);
        if (!creation) {
          creation = (async () => {
            const color = await autoColorForNewPage(note.userId, note.id);
            const newPageId = await createPage(note.id, note.userId, "Untitled", 0, color);
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
        notePages = await getPages(note.id, note.userId);
      }

      if (cancelled) return;
      const target = revealTargetRef.current;
      const targetPage = target && notePages.find((p) => p.id === target.pageId);
      if (target && !targetPage) revealTargetRef.current = null;
      setPages(notePages);
      setSelectedPageId(targetPage?.id ?? notePages[0]?.id ?? null);
      setPagesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [note.id, note.userId]);

  // Followed references ask for a page and shape through the URL
  // (lib/references/navigate.ts). The request moves into a ref and the params
  // are dropped, so following the same reference again changes the URL again.
  useEffect(() => {
    // While the URL already names another note, this editor is about to
    // unmount; that note's editor mounts with the params still in place.
    if (!pageParam || idParam !== note.id) return;
    revealTargetRef.current = { pageId: pageParam, shapeId: shapeParam, imageId: imageParam };
    router.replace(`/canvas?id=${note.id}`);

    // While this note's pages are still loading, the load picks the page.
    const { pages: currentPages, selectedPageId: currentPageId } = useAppStore.getState();
    if (!currentPages.some((p) => p.id === pageParam && p.noteId === note.id)) return;
    // Another page: handleMount reveals the shape once that page's editor
    // mounts.
    if (currentPageId !== pageParam) {
      setSelectedPageId(pageParam);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    revealTargetRef.current = null;
    if (shapeParam) revealShape(editor, shapeParam, imageParam);
  }, [idParam, pageParam, shapeParam, imageParam, note.id, router, setSelectedPageId]);

  const selectedPage =
    pages.find((p) => p.id === selectedPageId) ?? pages[0] ?? null;

  // Committed on blur or Enter through the same path as PageItem's rename, so
  // both stay in sync.
  const [titleDraft, setTitleDraft] = useState(selectedPage?.title || "Untitled");

  useEffect(() => {
    if (document.activeElement === titleInputRef.current) return;
    setTitleDraft(selectedPage?.title || "Untitled");
  }, [selectedPage?.id, selectedPage?.title]);

  // Loads only the document, so the camera and tool stay put. Marked remote so
  // autosave doesn't treat it as a user edit.
  function applyRemotePage(editor: Editor, remote: PageType) {
    const snapshot = remote.canvasData as TLEditorSnapshot | null;
    if (snapshot?.document) {
      try {
        editor.store.mergeRemoteChanges(() => editor.loadSnapshot({ document: snapshot.document }));
      } catch (e) {
        console.error("[CanvasEditor] Could not apply remote page", e);
        return;
      }
    }
    lastSnapshotRef.current = JSON.stringify(editor.getSnapshot());
    lastUpdatedAtRef.current = remote.updatedAt;
  }

  tryApplyRemoteRef.current = () => {
    const remote = remoteCandidateRef.current;
    const editor = editorRef.current;
    if (!remote || !editor || remote.id !== currentPageIdRef.current) return;
    const idle =
      !pendingSaveRef.current &&
      editor.getEditingShapeId() === null &&
      !useAppStore.getState().activeEditor?.isFocused;
    if (idle) {
      remoteCandidateRef.current = null;
      setNewerPage(null);
      applyRemotePage(editor, remote);
    } else {
      setNewerPage(remote);
    }
  };

  function reloadNewerPage() {
    const editor = editorRef.current;
    const remote = remoteCandidateRef.current;
    if (!editor || !remote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = false;
    editor.setEditingShape(null);
    remoteCandidateRef.current = null;
    setNewerPage(null);
    applyRemotePage(editor, remote);
  }

  // Remote pulls change the note's pages: refetch the list and compare the open
  // page with what the editor holds.
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refetch = async () => {
      const myRequestId = ++requestId;
      const fresh = await getPages(note.id, note.userId);
      if (cancelled || myRequestId !== requestId || fresh.length === 0) return;
      const state = useAppStore.getState();
      if (state.pagesLoading) return;

      const key = (list: PageType[]) =>
        list
          .map((p) => `${p.id}|${p.title}|${p.order}|${p.color}|${p.updatedAt}|${p.dirty}`)
          .join("\n");
      if (key(fresh) !== key(state.pages)) setPages(fresh);

      const selectedId = state.selectedPageId;
      if (selectedId && !fresh.some((p) => p.id === selectedId)) {
        setSelectedPageId(fresh[0].id);
        return;
      }
      const remote = fresh.find((p) => p.id === selectedId);
      if (!remote || remote.id !== currentPageIdRef.current) return;
      // Dirty rows are this device's own writes.
      if (remote.dirty || remote.updatedAt <= lastUpdatedAtRef.current) return;
      if (JSON.stringify(remote.canvasData) === lastSnapshotRef.current) {
        lastUpdatedAtRef.current = remote.updatedAt;
        return;
      }
      remoteCandidateRef.current = remote;
      tryApplyRemoteRef.current();
    };

    const unsubscribe = subscribeDataChange((origin) => {
      if (origin !== "remote") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refetch().catch((e) => console.error("[CanvasEditor] Could not refresh pages", e));
      }, 300);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [note.id, note.userId, setPages, setSelectedPageId]);

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
      editorRef.current = editor;

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
        lastSnapshotRef.current = JSON.stringify(snapshot);
        void updatePage(page.id, { canvasData: snapshot as unknown as object });
      }
      lastSnapshotRef.current = JSON.stringify(editor.getSnapshot());
      lastUpdatedAtRef.current = page.updatedAt;
      currentPageIdRef.current = page.id;
      remoteCandidateRef.current = null;
      setNewerPage(null);

      // Persists only when the document differs from what was last loaded or
      // saved.
      const saveIfChanged = () => {
        const snapshot = editor.getSnapshot();
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSnapshotRef.current) return;
        lastSnapshotRef.current = serialized;
        void updatePage(page.id, { canvasData: snapshot as unknown as object })
          .then(() => getPageRowById(page.id, page.userId))
          .then((row) => {
            // updatePage only writes the DB; refresh the in-memory pages so the
            // header's updatedAt stays current.
            const updatedAt = row?.updatedAt ?? Date.now();
            if (editorRef.current === editor) lastUpdatedAtRef.current = updatedAt;
            const freshPages = useAppStore.getState().pages;
            setPages(freshPages.map((p) => (p.id === page.id ? { ...p, updatedAt } : p)));
          });
      };

      // Text boxes that aren't being edited have no editor to convert old
      // data: pictures, so do it here.
      void (async () => {
        let changed = false;
        for (const shape of editor.getCurrentPageShapes()) {
          const content = (shape.props as { content?: unknown }).content;
          if (shape.type !== "rich-text" || !content) continue;
          const copy = structuredClone(content);
          if (await convertDataUrlsInDoc(copy)) {
            editor.updateShape({ id: shape.id, type: "rich-text", props: { content: copy } });
            changed = true;
          }
        }
        for (const asset of editor.store.allRecords()) {
          if (asset.typeName !== "asset") continue;
          const src = (asset.props as { src?: string | null }).src;
          if (!src?.startsWith("data:")) continue;
          editor.store.put([{ ...asset, props: { ...asset.props, src: "asset:" + (await saveDataUrl(src)) } } as typeof asset]);
          changed = true;
        }
        if (changed) {
          const snapshot = editor.getSnapshot();
          lastSnapshotRef.current = JSON.stringify(snapshot);
          await updatePage(page.id, { canvasData: snapshot as unknown as object });
        }
      })().catch((e) => console.error("[images] could not convert old pictures", e));

      const target = revealTargetRef.current;
      if (target?.pageId === page.id) {
        const { shapeId, imageId } = target;
        if (!shapeId) {
          revealTargetRef.current = null;
        } else {
          // After layout, so the zoom fits the measured viewport. Cleared only
          // once it runs: Strict Mode disposes the first editor, and its
          // timers with it, before mounting again.
          editor.timers.requestAnimationFrame(() => {
            if (revealTargetRef.current !== target) return;
            revealTargetRef.current = null;
            revealShape(editor, shapeId, imageId);
          });
        }
      }

      const unlisten = editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          pendingSaveRef.current = true;
          saveTimer.current = setTimeout(() => {
            saveIfChanged();
            pendingSaveRef.current = false;
            tryApplyRemoteRef.current();
          }, 800);
        },
        { source: "user", scope: "document" },
      );

      // A deferred remote edit applies once editing ends.
      const stopEditingWatcher = react("canvas: retry deferred remote edit", () => {
        editor.getEditingShapeId();
        tryApplyRemoteRef.current();
      });
      const stopStoreWatcher = useAppStore.subscribe((state, prev) => {
        if (state.activeEditor !== prev.activeEditor) tryApplyRemoteRef.current();
      });

      return () => {
        setActiveCanvasEditor(null);
        if (editorRef.current === editor) editorRef.current = null;
        currentPageIdRef.current = null;
        stopEditingWatcher();
        stopStoreWatcher();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unlisten();
        stopConfinementWatcher();
        uninstallRichTextToolAutoReturn();
        // Flush a pending save so leaving mid-debounce doesn't drop the edit.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          saveIfChanged();
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
          ref={titleInputRef}
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
      {newerPage && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-4 py-1.5 text-sm text-foreground">
          <span>A newer version of this page is available</span>
          <button
            type="button"
            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground"
            onClick={reloadNewerPage}
          >
            Reload
          </button>
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              remoteCandidateRef.current = null;
              setNewerPage(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
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
        assets={assetStore}
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
          ContextMenu: CanvasContextMenu,
        }}
      />
      </div>
    </div>
  );
}
