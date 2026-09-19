// spec.md subtask 12 ("Image editor pop-out shell"). Opens a real, separate
// Tauri window for editing a single image, mirroring lib/stickyWindow.ts's
// WebviewWindow pattern. Unlike sticky notes, each edit session is
// independent - no existing-window reuse/focus logic, just a fresh window
// per open.
//
// The image itself is a data URL, which can be megabytes large - Tauri
// window-creation URLs/query params have practical length limits, and each
// WebviewWindow is its own separate JS runtime (no shared localStorage/
// sessionStorage across windows, per this app's own established sticky-note
// window knowledge). So the data URL is written to a TEMP FILE under
// $APPDATA/image-editor/ instead, and only the file PATH is passed as a
// query param - the pop-out window reads it back via @tauri-apps/plugin-fs
// (see app/image-editor/page.tsx / components/editor/ImageEditor.tsx, which
// mirror components/sticky/ScreenshotCapture.tsx's fileToDataUrl chunked-
// base64-decode pattern to reverse this).
//
// spec.md subtask 18 ("Save-back-to-note"). Returns the generated `id` (also
// embedded in the temp file's own name) so the caller can `listen()` for
// this specific edit session's `image-editor:saved:<id>` Tauri event (a
// real, app-wide event bus - see @tauri-apps/api/event's own `emit`/`listen`
// doc comments, which default to `{ kind: 'Any' }` targets, i.e. every
// window) before the pop-out window emits it on save/close.
export async function openImageEditorWindow(dataUrl: string): Promise<string> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { appDataDir, join } = await import("@tauri-apps/api/path");

  const dir = await join(await appDataDir(), "image-editor");
  // `recursive: true` is a no-op if the directory already exists (matches
  // `std::fs::create_dir_all`'s semantics), so no need to check first.
  await mkdir(dir, { recursive: true });

  const id = crypto.randomUUID();
  const path = await join(dir, `${id}.png`);

  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await writeFile(path, bytes);

  new WebviewWindow(`image-editor-${id}`, {
    url: `/image-editor/?path=${encodeURIComponent(path)}`,
    title: "Image editor",
    width: 900,
    height: 700,
    resizable: true,
    maximizable: false,
    decorations: false,
  });

  return id;
}
