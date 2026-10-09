// Opens a sticky note in its own window, or focuses it if already open.
//
// Labels are "sticky-<id>" to match src-tauri/capabilities/sticky.json:
// default.json only covers the main window, so without it the window gets no
// permissions.
export async function openStickyNoteWindow(id: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const label = `sticky-${id}`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: `/sticky/?id=${id}`,
    title: "Sticky note",
    width: 360,
    height: 640,
    resizable: true,
    maximizable: false,
    decorations: false,
  });
}
