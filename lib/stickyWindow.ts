import { getStickyNoteById } from "@/lib/db/stickyNotes";

// Opens a sticky note in its own window, or focuses it if already open.
//
// Labels are "sticky-<id>" to match src-tauri/capabilities/sticky.json:
// default.json only covers the main window, so without it the window gets no
// permissions.
//
// The window title is the note's title so sticky windows can be told apart in
// the macOS Dock menu, the Window menu and Alt-Tab. Pass `title` when the
// caller already has it; otherwise it's looked up.
export async function openStickyNoteWindow(id: string, title?: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  const label = `sticky-${id}`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const windowTitle =
    title ?? (await getStickyNoteById(id).catch(() => null))?.title ?? "Untitled";

  const win = new WebviewWindow(label, {
    url: `/sticky/?id=${id}`,
    title: windowTitle || "Untitled",
    width: 360,
    height: 640,
    resizable: true,
    maximizable: false,
    decorations: false,
    // Without it, the first click on an unfocused note only activates the
    // window on macOS, half-swallowing a double-click on the top bar.
    acceptFirstMouse: true,
  });

  void win.once("tauri://created", async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("setup_sticky_window", { label });
    } catch (err) {
      // Cosmetic only (taskbar group and icon); the window works without it.
      console.error("setup_sticky_window failed", err);
    }
  });
}
