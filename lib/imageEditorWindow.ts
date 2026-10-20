import { isImageToken, tokenToDataUrl } from "@/lib/images/localImages";

// Opens a fresh image editor window per edit.
//
// The image goes through a temp file under $APPDATA/image-editor/ and only its
// path is passed in the URL: a data URL can be megabytes, and windows don't
// share storage.
//
// Returns the id (also the temp file's name), so the caller can listen for
// image-editor:saved:<id>, which is emitted to every window.
export async function openImageEditorWindow(src: string): Promise<string> {
  const dataUrl = isImageToken(src) ? await tokenToDataUrl(src) : src;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { appDataDir, join } = await import("@tauri-apps/api/path");

  const dir = await join(await appDataDir(), "image-editor");
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
