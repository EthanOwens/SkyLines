import type { SyncFailure } from "@/types";

const LOG_LINES = 200;

// Failures list table, id and reason only: names are note titles.
export async function copyBugReport(syncStatus: string, failures: SyncFailure[]) {
  const [{ appLogDir, join }, { readFile }, { writeText }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/plugin-clipboard-manager"),
  ]);
  // Matches tauri-plugin-log's default file name (productName).
  const logPath = await join(await appLogDir(), "Skylines.log");
  let log: string;
  try {
    log = new TextDecoder().decode(await readFile(logPath));
  } catch (err) {
    log = `(couldn't read log: ${String(err)})`;
  }
  const lines = log.split("\n").filter(Boolean).slice(-LOG_LINES);

  const text = [
    `SkyLines v${process.env.NEXT_PUBLIC_APP_VERSION} (${process.env.NEXT_PUBLIC_BUILD_COMMIT})`,
    navigator.userAgent,
    `Sync status: ${syncStatus}`,
    `Sync failures: ${failures.length ? "" : "none"}`,
    ...failures.map((f) => `- ${f.table} ${f.id} (${f.reason})`),
    "",
    `Log (last ${lines.length} lines):`,
    ...lines,
    "",
    "What happened:",
    "",
  ].join("\n");
  await writeText(text);
}
