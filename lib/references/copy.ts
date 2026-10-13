import { formatReference, type Reference } from "./format";

// Dynamic import: no Tauri runtime exists during the static export build.
export async function copyReference(ref: Reference): Promise<void> {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(formatReference(ref));
}
