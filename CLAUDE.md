# SkyLines

Local-first note-taking desktop app: Tauri v2 (Rust, `src-tauri/`) wrapping a Next.js 16 static export (`app/`, `components/`, `lib/`, `hooks/`, `stores/`). SQLite through tauri-plugin-sql is the source of truth; Firestore syncs in the background (`lib/sync/`).

## Commands

- Run the app with hot reload: `npm run tauri dev`
- Release build (installers in `src-tauri/target/release/bundle/`): `npm run tauri build`

## Verification

Run all of these after every change. Each must exit 0:

- `npx tsc --noEmit`
- `npm run build`
- `(cd src-tauri && cargo check)`

## Testing

Behaviour is tested in the running app through the Tauri MCP server (`.mcp.json`, tools named `mcp__tauri__*`), which talks to a debug-only bridge plugin on `127.0.0.1:9223`.

- **Attach, don't launch.** The user runs `npm run tauri dev`. Start with `driver_session` (action `start`); if no app answers, stop and ask the user to start it. Never launch a second copy: the app is single-instance, so a second launch hands off to the running one and exits.
- **Test account only.** The app must be signed in as `dev@skylines.local` (the login page's dev-login button). Check first: the account menu in the top bar shows the signed-in email. If it shows any other account, stop and ask. Never sign in or out yourself. Everything created in the app syncs to Firestore under that account.
- **Windows:** `main`, `sticky-<id>` (sticky note pop-outs) and `image-editor-<id>`. Pass the label as `windowId` to the webview tools.
- **Tools:** find elements with `webview_dom_snapshot` or `webview_find_element`, act with `webview_interact` and `webview_keyboard`, and take evidence with `webview_screenshot`.
- **Clean up** notes, sticky notes and windows you created. Never edit or delete anything you didn't create, and never quit the app.
- **Out of reach:** the system tray, the native menu bar, the global shortcut, OS dialogs and other apps. Those steps stay manual.

### Precondition

`node -e "require('net').connect(9223,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`

### Lessons

- While the app window is hidden, screenshots come back stale, and timers and close animations stall: closed dialogs linger with `data-closed`, and awaited timeouts in `webview_execute_js` time out. The window goes hidden whenever another app takes focus, and `manage_window` focus doesn't wake it: run `osascript -e 'tell application "System Events" to set frontmost of process "skylines" to true'` before each batch of steps, and rely on DOM and computed-style evidence.
- Simulated events can't start a native window drag or trigger real keyboard focus, so mark those steps for the user.
- To make a text box, dispatch synthetic `pointerdown` then `pointerup` on `.tl-canvas` with the text tool (no awaits). The first click only deselects the previous box, so click twice.
- (fragile) Seed canvas data through the tldraw editor, reached by a React fiber walk from `.tl-container` (`memoizedState.memoizedState.current.createShape`). Use a fresh shape id after one hits an error boundary, and keep `webview_execute_js` scripts synchronous (`await` times out).
- After code changes to modules with module-level state (e.g. `mainWindowRouter` in `lib/references/navigate.ts`), run `location.reload()` and re-enter a notebook before testing; hot reload leaves that state stale.
- Canvas changes reach SQLite on a debounce. Wait for a save (e.g. reopen the dialog) before expecting new text boxes in DB-backed views: the picker, chips and missing state.

## Gotchas

- SQL migrations in `src-tauri/src/lib.rs` are checksummed by tauri-plugin-sql. Never edit an existing migration; add a new version.
- Next.js builds as a static export (`output: "export"`, `trailingSlash: true`): no API routes or server-side rendering at runtime, pages take IDs as query params (`/note?id=...`), and `usePathname()` returns paths with a trailing slash.
- Every window created at runtime needs a capability file in `src-tauri/capabilities/` matching its label (`main`, `sticky-*`, `image-editor-*`), or its webview gets no permissions.
- The app is built on both Windows and macOS. On macOS, Rust linking needs `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk` because of a stray beta SDK.
- `.env.local` holds the Firebase `NEXT_PUBLIC_*` config, which is baked in at build time.
