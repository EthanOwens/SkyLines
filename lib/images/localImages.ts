// Pictures live as files under $APPDATA/images; documents store a token
// ("skylines-image:<uuid>.<ext>") instead of the pixels.
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";

export const IMAGE_TOKEN_PREFIX = "skylines-image:";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

// Cached so token-to-URL mapping stays synchronous while rendering.
let imagesDir: string | null = null;
const dirReady: Promise<void> | null =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? appDataDir().then((d) => {
        imagesDir = `${d.replace(/[/\\]$/, "")}${d.includes("\\") ? "\\" : "/"}images`;
      })
    : null;

export const isImageToken = (src: unknown): src is string =>
  typeof src === "string" && src.startsWith(IMAGE_TOKEN_PREFIX);

function filePath(token: string): string {
  const sep = imagesDir!.includes("\\") ? "\\" : "/";
  return `${imagesDir}${sep}${token.slice(IMAGE_TOKEN_PREFIX.length)}`;
}

/** Display URL for a token; any other src is returned unchanged. */
export function resolveImageSrc(src: string): string {
  return isImageToken(src) && imagesDir ? convertFileSrc(filePath(src)) : src;
}

/** Maps an asset URL back to its token, or null when it isn't one of ours. */
export function tokenFromAssetUrl(url: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return null;
  }
  const m = /[/\\]images[/\\]([0-9a-f-]{36}\.[a-z0-9]+)$/i.exec(decoded);
  return m ? IMAGE_TOKEN_PREFIX + m[1] : null;
}

export async function saveImageBytes(bytes: Uint8Array, ext: string): Promise<string> {
  await dirReady;
  const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
  await mkdir(imagesDir!, { recursive: true });
  const token = `${IMAGE_TOKEN_PREFIX}${crypto.randomUUID()}.${ext}`;
  await writeFile(filePath(token), bytes);
  return token;
}

export async function saveDataUrl(dataUrl: string): Promise<string> {
  const comma = dataUrl.indexOf(",");
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return saveImageBytes(bytes, MIME_EXT[mime] ?? "png");
}

export async function imageExists(token: string): Promise<boolean> {
  await dirReady;
  const { exists } = await import("@tauri-apps/plugin-fs");
  return exists(filePath(token));
}

/** Reads a token's file as a data URL (for the image editor). */
export async function tokenToDataUrl(token: string): Promise<string> {
  await dirReady;
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(filePath(token));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const ext = token.split(".").pop() ?? "png";
  const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Replaces every `data:` image src in a Tiptap JSON doc with a token (in place). Returns whether anything changed. */
export async function convertDataUrlsInDoc(doc: unknown): Promise<boolean> {
  let changed = false;
  async function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src.startsWith("data:")) {
      node.attrs.src = await saveDataUrl(node.attrs.src);
      changed = true;
    }
    for (const child of node.content ?? []) await walk(child);
  }
  await walk(doc);
  return changed;
}
