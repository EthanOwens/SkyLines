// spec.md subtask 8 ("Sticky note pop-out window"). Opens a real, separate
// Tauri window for a single sticky note, created at runtime via
// @tauri-apps/api/webviewWindow's WebviewWindow (not a pre-declared window in
// tauri.conf.json - runtime-created windows need no config pre-declaration).
//
// Exported as a standalone function rather than inlined at a call site
// because later subtasks (11 "Ctrl+K dialog", 14 "home page", 15 "ribbon
// button") all need to trigger the same "open this sticky note in its own
// window" action from different UI entry points.
//
// Window labels are "sticky-<id>", matched by the "sticky-*" glob pattern in
// src-tauri/capabilities/sticky.json, which grants that window's webview the
// SQL permissions lib/db/stickyNotes.ts needs - src-tauri/capabilities/
// default.json's own permissions only apply to the "main" window and do NOT
// cover windows created this way, per Tauri v2's per-window-label capability
// scoping.
export async function openStickyNoteWindow(id: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const label = `sticky-${id}`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  // 9:16 portrait aspect ratio (like a real sticky note), e.g. 360x640.
  new WebviewWindow(label, {
    url: `/sticky/?id=${id}`,
    title: "Sticky note",
    width: 360,
    height: 640,
    resizable: true,
  });
}
