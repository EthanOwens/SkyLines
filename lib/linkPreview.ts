export interface LinkPreview {
  siteName: string;
  title: string;
  description: string;
  image: string | null;
  large: boolean;
  themeColor: string | null;
}

const cache = new Map<string, Promise<LinkPreview | null>>();

async function load(url: string): Promise<LinkPreview | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const page = await invoke<{ contentType: string; html: string }>("fetch_page_head", { url });
    const host = new URL(url).host;
    const image = (src: string) =>
      invoke<string>("fetch_image", { url: src }).catch(() => null);
    if (page.contentType.startsWith("image/")) {
      return { siteName: host, title: "", description: "", image: await image(url), large: true, themeColor: null };
    }
    const doc = new DOMParser().parseFromString(page.html, "text/html");
    const meta = (...names: string[]) => {
      for (const n of names) {
        const v = doc
          .querySelector(`meta[property="${n}"], meta[name="${n}"]`)
          ?.getAttribute("content")
          ?.trim();
        if (v) return v;
      }
      return "";
    };
    let imageUrl = meta("og:image", "twitter:image");
    try {
      imageUrl = imageUrl ? new URL(imageUrl, url).href : "";
    } catch {
      imageUrl = "";
    }
    return {
      siteName: meta("og:site_name") || host,
      title: meta("og:title") || doc.querySelector("title")?.textContent?.trim() || "",
      description: meta("og:description", "description"),
      image: imageUrl ? await image(imageUrl) : null,
      large: meta("twitter:card") === "summary_large_image",
      themeColor: meta("theme-color") || null,
    };
  } catch {
    return null;
  }
}

export function getLinkPreview(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = load(url);
    cache.set(url, p);
  }
  return p;
}
