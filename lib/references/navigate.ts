import { formatReference, parseReference, type Reference } from "./format";
import { resolveReference } from "./resolve";
import { getFolderById } from "@/lib/db/folders";
import { getPageById } from "@/lib/db/pages";
import { getStickyNoteById } from "@/lib/db/stickyNotes";
import { setLastOpen, setLastOpenNotebook } from "@/lib/lastOpen";
import { openStickyNoteWindow } from "@/lib/stickyWindow";
import { useAppStore } from "@/stores/appStore";

// Sent by windows without the app's routes (sticky notes) with a reference
// token; the main window brings itself forward and follows it.
export const REFERENCE_FOLLOW_EVENT = "reference:follow";

export interface ReferenceRouter {
  push(href: string): void;
}

// Set only in the main window, by listenForReferenceFollows.
let mainWindowRouter: ReferenceRouter | null = null;

async function openStickyReference(id: string): Promise<boolean> {
  const sticky = await getStickyNoteById(id);
  if (!sticky) return false;
  await openStickyNoteWindow(id, sticky.title);
  return true;
}

/** Navigates the main window to the reference's target. False when it's gone. */
export async function followReference(ref: Reference, router: ReferenceRouter): Promise<boolean> {
  if (ref.kind === "sticky") return openStickyReference(ref.id);

  // Same existence rule as the chip, which shows a target with a missing
  // ancestor as not found.
  if (!(await resolveReference(ref)).exists) return false;
  const store = useAppStore.getState();

  switch (ref.kind) {
    case "notebook": {
      // The home page reopens the last note unless the last-open state says a
      // notebook was opened on its own.
      setLastOpenNotebook(ref.id);
      store.setSelectedNotebook(ref.id);
      store.setSidebarOpen(true);
      router.push("/");
      return true;
    }
    case "folder": {
      const folder = await getFolderById(ref.id);
      if (!folder) return false;
      setLastOpen({ notebookId: folder.notebookId, folderId: folder.id, noteId: null });
      store.setSelectedNotebook(folder.notebookId);
      store.setSelectedFolder(folder.id);
      store.revealFolder(folder.id);
      store.setSidebarOpen(true);
      router.push("/");
      return true;
    }
    case "note":
      router.push(`/canvas?id=${ref.id}`);
      return true;
    case "page": {
      const page = await getPageById(ref.id);
      if (!page) return false;
      router.push(`/canvas?id=${page.noteId}&page=${page.id}`);
      return true;
    }
    case "shape": {
      const page = await getPageById(ref.pageId);
      if (!page) return false;
      router.push(
        `/canvas?id=${page.noteId}&page=${page.id}&shape=${encodeURIComponent(ref.shapeId)}`,
      );
      return true;
    }
  }
}

/** Follows a reference from any window, showing "Not found" if its target is gone. */
export async function openReference(ref: Reference): Promise<void> {
  try {
    let found: boolean;
    if (mainWindowRouter) {
      found = await followReference(ref, mainWindowRouter);
    } else if (ref.kind === "sticky") {
      found = await openStickyReference(ref.id);
    } else {
      // Checked here so the message shows in the window that was clicked.
      found = (await resolveReference(ref)).exists;
      if (found) {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(REFERENCE_FOLLOW_EVENT, formatReference(ref));
      }
    }
    if (!found) showNotFound();
  } catch (err) {
    console.error("Failed to follow reference", formatReference(ref), err);
  }
}

const WEB_LINK = /^(https?:|mailto:)/i;

/** Opens http(s) and mailto links in the default app; ignores anything else. */
export async function openWebLink(href: string): Promise<void> {
  if (!WEB_LINK.test(href)) return;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } catch (err) {
    console.error("Failed to open link", href, err);
  }
}

async function bringMainWindowForward() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("focus_main_window");
}

/** Main window only. Returns a cleanup that stops listening. */
export function listenForReferenceFollows(router: ReferenceRouter): () => void {
  mainWindowRouter = router;
  let disposed = false;
  let unlisten: (() => void) | null = null;

  import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<string>(REFERENCE_FOLLOW_EVENT, (event) => {
        const ref = parseReference(event.payload);
        if (!ref) return;
        void (async () => {
          try {
            await bringMainWindowForward().catch((err) =>
              console.error("Failed to bring the main window forward", err),
            );
            if (!(await followReference(ref, router))) showNotFound();
          } catch (err) {
            console.error("Failed to follow reference", event.payload, err);
          }
        })();
      }),
    )
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch((err) => console.error("Failed to listen for reference follows", err));

  return () => {
    disposed = true;
    if (mainWindowRouter === router) mainWindowRouter = null;
    unlisten?.();
  };
}

const NOTICE_MS = 1600;
let notice: { element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

// The app has no toast outside the canvas, and this runs in sticky windows too.
function showNotFound() {
  if (typeof document === "undefined") return;
  if (notice) {
    clearTimeout(notice.timer);
    notice.element.remove();
  }
  const element = document.createElement("div");
  element.setAttribute("role", "status");
  element.textContent = "Not found";
  Object.assign(element.style, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    zIndex: "1000",
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.15)",
    fontSize: "13px",
    pointerEvents: "none",
  });
  document.body.appendChild(element);
  const timer = setTimeout(() => {
    element.remove();
    if (notice?.element === element) notice = null;
  }, NOTICE_MS);
  notice = { element, timer };
}
