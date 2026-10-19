# Ready for friends: private accounts, reliable sync, easy setup

Source: planning.md, 2026-10-19

## Goal

Get SkyLines ready for friends to build from the codebase and use with their own accounts. Each account's data is locked to that account in Firestore, and dev-only things stay out of release builds. Sync no longer stalls on one bad note: pictures live as local files instead of inside synced documents, canvas data is stored in a form Firestore accepts, and sticky notes sync too. When something goes wrong, friends can send a bug report with the app version, commit and recent logs. A setup script and a README "Getting started" section take a new user from a clean machine to a running app.

## Context

- **Shape of the app.** Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`. Windows `main`, `sticky-<id>` and `image-editor-<id>` are separate JS runtimes with their own capability files in `src-tauri/capabilities/` (`default.json`, `sticky.json`, `image-editor.json`). Any new plugin permission has to go into each window's file that uses it.
- **Sync engine.**
  - `lib/sync/engine.ts` runs only in the main window: `components/AppShell.tsx` starts it via `hooks/useSyncEngine.ts`.
  - Local writes call `notifyDataChange("local")` (`lib/db/events.ts`), which schedules a push with a 10 s debounce and a 15 s max wait. That event only fires within one JS runtime.
  - Status is a module-level value with listeners (`getSyncStatus` / `subscribeSyncStatus`), mirrored into `stores/appStore.ts`. It's shown by `components/topbar/AccountMenu.tsx` (`SYNC_STATUS_DISPLAY`) and `SyncBadge` in `components/sidebar/Sidebar.tsx`.
- **Push** (`lib/sync/push.ts`).
  - `pushDirtyRows` runs folders, then notes, then notebooks, then pages, one `setDoc(..., { merge: true })` per row, each followed by `markXSynced`.
  - Any throw aborts the whole pass. The engine sets status `"error"` and retries with backoff (2 s up to 60 s).
  - Doc id is the local row id. Every doc carries `userId`, and `updatedAt` is the client edit time.
- **Pull** (`lib/sync/pull.ts`).
  - One `onSnapshot` per collection, `where("userId", "==", uid)`.
  - `decidePull` does last-write-wins with conflict backups, through `recordSyncConflict` in `lib/db/syncConflicts.ts`. Its `tableName` union lists the four collections.
  - `toRemoteNoteData` / `toRemotePageData` read `canvasData` and `content` as objects.
- **Firestore today.**
  - Collections are `folders`, `notes`, `notebooks`, `pages`. There's no rules file, `firebase.json` or `.firebaserc` in the repo.
  - `lib/sync/cleanup.ts` (tombstone hard-delete) is only called from spike pages, never in production.
- **Canvas data.**
  - `page.canvasData` is a full tldraw snapshot. Rich-text boxes keep Tiptap JSON in shape `props.content`.
  - The snapshot is saved from `components/canvas/CanvasEditor.tsx` (debounced 800 ms) through `updatePage` in `lib/db/pages.ts`, which stringifies it into SQLite.
  - The Firestore error "Property canvasData contains an invalid nested entity" is most likely the 20-level map/array depth limit: a rich-text box's text already sits about 13 levels deep, and nested lists add 4 levels each. It isn't nested arrays: the SDK reports those with a different message.
- **Pictures today.**
  - `ImageWithId` (`lib/tiptap/imageId.ts`, configured in `lib/tiptap/extensions.ts` with `allowBase64: true`) keeps an `id` attr rendered as `data-image-id`. References, reveal (`revealImage`) and the context menu rely on that attr.
  - Pictures enter as `data:` URLs from several places:
    - Ribbon upload (`components/ribbon/Ribbon.tsx` `insertImage`)
    - HTML paste
    - screenshot stickies (`components/sticky/StickyNotesHome.tsx`, `ScreenshotCapture.tsx`)
    - the image editor's save (`components/editor/ImageEditor.tsx` emits `image-editor:saved:<uuid>` with a data URL)
  - The double-click handlers in `RichTextShape.tsx`, `StickyNoteEditor.tsx` and `RichTextEditor.tsx` pass the DOM `src` to `openImageEditorWindow` (`lib/imageEditorWindow.ts`, which assumes a data URL). They patch the node back only when `node.attrs.src === originalSrc`.
  - `RichTextEditor.tsx` isn't mounted anywhere; the live editors are `RichTextShape` and `StickyNoteEditor`.
  - Native tldraw images use tldraw's default inline base64 asset store. `<Tldraw>` in `CanvasEditor.tsx` has no `assets` prop, and an asset store needs a stable module-level identity like `shapeUtils`.
- **Code that reads a picture's `src`:**
  - `lib/tiptap/extractText.ts` (`extractFirstImageSrc`, `findImageSrc`)
  - `lib/references/resolve.ts` (`shapeImage`, `imageAsset`, `canvasPreview`, `previewImage`)
  - `lib/tiptap/hoverPreview.ts`
- **Showing local files.**
  - The CSP already allows `img-src asset: https://asset.localhost data: blob:`.
  - The asset protocol needs `app.security.assetProtocol` (`enable`, `scope`) in `src-tauri/tauri.conf.json` and the `protocol-asset` feature on `tauri` in `src-tauri/Cargo.toml`. Both `tauri` entries are target-specific, so add the feature to both.
  - The fs plugin is installed.
- **Sticky notes.**
  - The `sticky_notes` table already has `dirty` / `synced_at`.
  - `lib/db/stickyNotes.ts` has `getDirtyStickyNotes`, `markStickyNoteSynced`, `upsertStickyNoteFromRemote` and `getStickyNoteRowById`, none of them called.
  - Writes emit the Tauri event `STICKY_NOTE_CHANGED_EVENT` (`"sticky-note:changed"`, `{id}`). `StickyNoteEditor.tsx` listens to it only to close itself on delete. It takes `note.content` once at mount, and applies pinned (`setAlwaysOnTop`) only on mount.
- **Dev-only things in release.**
  - The Dev Login button and its credentials in `app/login/page.tsx` render unconditionally.
  - 16 `app/spike-*` pages ship in `out/` and are public: see `isPublicRoute`, `isSpikeRoute` and nearby comments in `AppShell.tsx`.
  - `app/instance-probe.tsx`, mounted in `app/layout.tsx`, exists only for the spike-a/b checks.
  - `tauri dev` runs `next dev`, so `NODE_ENV` is `"development"`. `tauri build` runs `next build`, so it's `"production"`. Next inlines `process.env.NODE_ENV` at compile time.
- **Logging and UI patterns.**
  - There's no logging plugin, error boundary, `window.onerror` or `unhandledrejection` handler. There are 24 `console.error` calls; the sync ones are prefixed `[sync/...]`.
  - Clipboard writes use a dynamic import of `@tauri-apps/plugin-clipboard-manager` (see `lib/references/copy.ts`).
  - The copy-with-feedback menu item pattern is `components/references/CopyReferenceItem.tsx`. The app has no toast system.
  - Opening a folder follows `components/theme/ThemeEditor.tsx` (`openPath`, scoped by `opener:allow-open-path` in `default.json`).
- **Version.**
  - `0.1.0` is in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
  - `next.config.ts` has no `env` block. The README's Windows install paths hardcode `0.1.0`.
- **Local toolchain.** Node 26.10, Rust 1.99. There's no `.nvmrc`, `rust-toolchain.toml` or `engines`.

## Decisions

- **Old test pages.** Delete all `app/spike-*` pages and `app/instance-probe.tsx`, along with the spike special cases in `AppShell.tsx` (user's choice). `lib/sync/cleanup.ts` stays as it is, unused.
- **Dev Login.** Render the button and handler only when `process.env.NODE_ENV === "development"`. Keep the credentials inside code that's dropped from production builds, so a release bundle doesn't contain `DevLogin123!`. Agent testing under `npm run tauri dev` keeps working.
- **Security rules.**
  - Commit `firestore.rules` and a minimal `firebase.json` that points at it. Don't commit `.firebaserc`; the project id goes on the command line.
  - The user deploys the rules themselves with `npx firebase-tools deploy --only firestore:rules --project <id>`. No agent deploys them.
  - The rules cover `folders`, `notes`, `notebooks`, `pages` and `stickyNotes`:
    - read, update and delete only when `resource.data.userId == request.auth.uid`
    - create and update only when `request.resource.data.userId == request.auth.uid`, so a doc can't be moved to another account
    - everything else is denied
- **Canvas and content as strings.**
  - Notes and pages push `canvasJson` and `contentJson` (JSON strings) and remove the old map fields `canvasData` and `content` with `deleteField()`.
  - Pull prefers the string fields and falls back to the old maps for docs that haven't been re-pushed.
  - No backfill: docs move to the new fields on their next push.
  - Older app builds on other computers will misread new docs, so every computer needs updating before editing (noted in the README).
- **Sync failures.**
  - A row whose push fails with a data error is skipped. It stays dirty, the rest of the pass carries on, and the failure is remembered with the table, row id, display name and reason. Data errors are Firestore `invalid-argument`, or a payload over Firestore's size limit.
  - Network or auth errors (`unavailable`, `deadline-exceeded`, `unauthenticated`, offline) still abort the pass and back off, as now.
  - Failed rows retry on the next push pass (a new edit, reconnect or app resume), not on their own timer.
  - Status is `"error"` while any failure remains.
  - The account menu's sync line shows "Couldn't sync: <name> (too big)" or "(rejected)", plus "and N more" when there are several (user's choice). Each failure is logged.
- **Pictures are local files.**
  - Each picture is saved once as `$APPDATA/images/<uuid>.<ext>`.
  - Content stores a device-independent token in `src`, `skylines-image:<uuid>.<ext>`, never an absolute path or a data URL.
  - Rendering maps the token to an asset-protocol URL (`convertFileSrc`). The asset scope is `$APPDATA/images/**`, which also covers sticky windows.
  - When the file is missing, as on another computer, the picture shows a placeholder saying "Picture is on another device", and the node keeps its `data-image-id`.
  - Files are keyed by their own uuid, not by the image node id, because copies share a file. Files are never deleted in this round.
- **Existing embedded pictures** are moved when opened (user's choice). Opening a page converts every `data:` picture in its rich-text boxes and tldraw assets to files and saves the page. Opening a sticky note does the same for its content. Pages and stickies that are never opened keep their data URLs and may show up as "too big" sync failures until they're opened.
- **Image editor** keeps working with files. It opens from the file behind the token, and its save writes a new file and replaces the node's token. The old file is left in place.
- **Sticky sync.**
  - The collection is `stickyNotes`, with `contentJson` as a string, using the same last-write-wins and conflict backups as notes.
  - **Pinned stays on each computer** (user's choice). It isn't pushed, pull keeps the local value, and a sticky first pulled onto a computer starts unpinned.
  - Favourite, title, colour and content sync.
  - The main window listens for `STICKY_NOTE_CHANGED_EVENT` to schedule a push.
  - A remote change reloads an open sticky window unless it has an unsaved local edit. A remote delete closes it, as now.
  - Pull never opens windows.
  - Tombstone cleanup stays out of scope.
- **Version.**
  - The version is set to `0.9.1` in `package.json` and its lockfile. `tauri.conf.json`'s `version` becomes `"../package.json"`. `Cargo.toml` stays at `0.1.0`, unused.
  - `next.config.ts` bakes in `NEXT_PUBLIC_APP_VERSION` (from `package.json`) and `NEXT_PUBLIC_BUILD_COMMIT` (`git rev-parse --short HEAD`, or `"unknown"` when git isn't available).
  - The account menu shows "SkyLines v0.9.1 (abc1234)".
- **Logs.**
  - Use `tauri-plugin-log` with `@tauri-apps/plugin-log`, writing to the OS log dir. Rotate at about 1 MB and keep 2 old files. Level is info and above.
  - In every window, a client component mounted in `app/layout.tsx` forwards `console.error` and `console.warn` and handles `window` `error` and `unhandledrejection`. Each line is prefixed with the window label and capped at 2000 characters.
  - Code never logs note text: sync failures log table, id and reason only.
- **Bug report.**
  - The account menu gets "Copy bug report" and "Open logs folder".
  - The report is plain text: version and commit, `navigator.userAgent`, sync status, current sync failures, the last 200 log lines, and an empty "What happened:" line.
  - It doesn't add the OS plugin or an error-tracking service.
- **Setup.**
  - `scripts/setup.sh` (macOS) and `scripts/setup.ps1` (Windows) install only what's missing and can be re-run safely.
  - Node is pinned with `.nvmrc` `24` (the LTS that `winget` and installers give) and `engines.node` `>=24`. Rust is pinned with `rust-toolchain.toml` channel `1.99`.
  - On macOS, Node comes from Homebrew when `brew` exists. Otherwise the script prints the nodejs.org link and stops.

## Out of scope

- Syncing pictures between computers (Firebase Storage), deleting unused picture files, and compressing pictures.
- Pasting a raw image file (with no HTML) into a text box. It inserts nothing today and still won't.
- Scheduling tombstone cleanup, wiping local data on sign-out, and user-scoping the by-id getters.
- Code signing, notarisation, auto-update and installers for friends. Friends build from the codebase.
- Android.
- Backfilling Firestore docs to the new string fields, and compatibility with older app builds.

## Tasks

### T1 Keep dev-only things out of release builds

Status: done
Depends on: none
Tester: no, the change only shows in a release build, which the reviewer checks by searching `out/`. Dev mode looks the same as before.

- In `app/login/page.tsx`, show the dashed "dev only" divider and the Dev Login button only when `process.env.NODE_ENV === "development"`. Move `DEV_EMAIL`, `DEV_PASSWORD` and `handleDevLogin` so a production build drops them, for example into a small component in the same file, rendered only under that condition.
- Delete every `app/spike-*` directory and `app/instance-probe.tsx`, and remove its mount from `app/layout.tsx`.
- Remove the spike special cases from `components/AppShell.tsx`: the `/spike-` public-route rule, `isSpikeRoute`, and the comments about spike pages.
- Check `lib/themes/loader.ts` for spike references and drop any that are dead.

Files: `app/login/page.tsx`, `app/layout.tsx`, `components/AppShell.tsx`, `app/spike-*/`, `app/instance-probe.tsx`, possibly `lib/themes/loader.ts`

Acceptance:
- `npm run build` succeeds, `out/` has no `spike-*` directories, and searching `out/` for `DevLogin123` and `dev@skylines.local` finds nothing.
- Under `npm run tauri dev`, the login page still shows the Dev Login button.
- No file outside git history refers to `spike-` routes or `__instanceId`.
- Signed-out users are still redirected to `/login`, and `/login` and `/register` are still public.

Test steps:
1. With `npm run tauri dev` running, the login page shows Dev Login (manual: needs signing out).
2. After `npm run build`, run `grep -r "DevLogin123" out/`: no matches.

### T2 Lock each account's data with Firestore security rules

Status: todo
Depends on: none
Tester: no, the rules only take effect once the user deploys them

- Add `firestore.rules` at the repo root, following the rule in Decisions, for `folders`, `notes`, `notebooks`, `pages` and `stickyNotes`. Use a helper function so all five collections share one rule body. Deny everything not matched.
- Add `firebase.json` containing only `{ "firestore": { "rules": "firestore.rules" } }`.
- In the README, add a short "Deploying Firestore rules" section under a maintainers heading: the `npx firebase-tools deploy --only firestore:rules --project <NEXT_PUBLIC_FIREBASE_PROJECT_ID>` command, plus a note to compare with the rules in the console before the first deploy.

Files: `firestore.rules`, `firebase.json`, `README.md`

Acceptance:
- `firestore.rules` uses `rules_version = '2'` and allows reads and writes only through the userId checks in Decisions.
- A create whose `userId` isn't the caller's uid is denied, and so is an update that changes `userId`.
- Unknown collections are denied.
- The pull queries' shape (`where("userId", "==", uid)`) is allowed by the read rule.
- `.firebaserc` isn't added.

Test steps (manual, after the user deploys):
1. In the app, edit a note. The account menu's sync line returns to "Saved".
2. In the Firebase console's Rules Playground, a `get` on `notes/<someone else's id>` as another uid is denied.

### T3 Store canvas and content as JSON strings in Firestore

Status: todo
Depends on: none
Tester: yes, push and pull can be checked with the Firebase SDK from the webview, and a deeply nested list reproduces the error

- In `lib/sync/push.ts`, `noteToFirestoreDoc` and `pageToFirestoreDoc` write `canvasJson` and `contentJson` as `JSON.stringify(...)`, or `null`. They write `canvasData` and `content` as `deleteField()`, so merged docs drop the old maps.
- In `lib/sync/pull.ts`, `toRemoteNoteData` and `toRemotePageData` parse the string field when it's a string, and otherwise fall back to the old map field (or `null`).
- Keep the SQLite side unchanged.

Files: `lib/sync/push.ts`, `lib/sync/pull.ts`

Acceptance:
- Pushed note and page docs contain `canvasJson` and `contentJson` strings, and no `canvasData` or `content` field.
- Pull gives the same local `canvasData` and `content` objects for a doc with the new string fields as for an old doc with map fields.
- A page whose text box holds a bulleted list nested 6 levels deep syncs without error: status returns to `"saved"`, and the doc's `updatedAt` matches the local row's.

Test steps:
1. In a test notebook, create a test note and give its page a text box with a bulleted list nested 6 levels deep.
2. Wait for sync (up to about 20 s). The account menu shows "Saved", not an error.
3. From `webview_execute_js`, read `pages/<page id>` with the app's Firestore instance. It has a string `canvasJson` and no `canvasData`.
4. Reload the app and reopen the page: the nested list is intact.
5. Delete the test note.

### T4 One note that can't sync doesn't block the rest

Status: todo
Depends on: T3
Tester: yes, an oversized text box can be created, and the account menu and other docs observed

- In `lib/sync/push.ts`, each per-row `setDoc` is wrapped. A data error, as defined in Decisions, records a failure and moves on. Before `setDoc`, a payload whose JSON length is over about 1,000,000 bytes is treated as "too big" without calling Firestore. Network and auth errors still throw.
- `pushDirtyRows` returns the pass's failures, as a list of `{ table, id, name, reason: "too-big" | "rejected", message }`. A table's failures are replaced on each pass, so fixed rows drop off.
- In `lib/sync/engine.ts`, keep the failures in a module-level value with a getter and subscribe function, using the same pattern as status. Set status `"error"` while any failure remains, without scheduling a backoff retry for failures alone. Log each failure with `console.error("[sync/push] ...")`, giving table, id and reason only.
- In `AccountMenu.tsx`, the sync status line shows "Couldn't sync: <name> (too big)" or "(rejected)", plus "and N more" when there are several. Names come from the row: note or page title, folder or notebook name.
- Widen `tableName` and the failure table type now, so T7 can add `stickyNotes`.

Files: `lib/sync/push.ts`, `lib/sync/engine.ts`, `components/topbar/AccountMenu.tsx`, possibly `hooks/useSyncEngine.ts`, `stores/appStore.ts`, `types/index.ts`

Acceptance:
- With one page over the size limit and another page edited, the edited page's doc reaches Firestore in the same pass.
- The account menu shows "Couldn't sync: <oversized page title> (too big)", and `SyncBadge` shows the error icon.
- Shrinking the oversized page below the limit clears the failure on the next push, and status returns to "Saved".
- Going offline mid-push still gives status `"offline"` and a backoff retry, as before.
- Log lines for failures contain no note or page content.

Test steps:
1. Create a test note A with a page whose text box holds about 1.2 MB of text (insert it through the editor in `webview_execute_js`). Create test note B with a short text box.
2. Wait for sync. The account menu shows "Couldn't sync: <A's page title> (too big)".
3. Edit B's text and wait. Reading B's page doc from Firestore shows the new text.
4. Delete most of A's text and wait. The failure line goes away and the status shows "Saved".
5. Delete both test notes.

### T5 Pictures in text boxes and sticky notes are saved as local files

Status: todo
Depends on: T4
Tester: yes, pictures can be inserted through the editor API and checked in the DOM, in the saved content and on disk

- **Display.** Enable the asset protocol (both `tauri` feature entries in `Cargo.toml`, plus `app.security.assetProtocol` in `tauri.conf.json` with scope `$APPDATA/images/**`). Grant fs `mkdir`/`write-file`/`read-file`/`exists` for `$APPDATA/images` in `default.json` and `sticky.json`. Grant read in `image-editor.json` if the editor reads files itself.
- **Helpers.** Add a small module, for example `lib/images/localImages.ts`:
  - save a data URL or bytes to `$APPDATA/images/<uuid>.<ext>` and return the token
  - map a token to a display URL (cache `appDataDir()` once at startup so rendering stays synchronous)
  - check whether a token's file exists
- **ImageWithId** (`lib/tiptap/imageId.ts`):
  - It renders a token `src` as the asset URL, and renders the "Picture is on another device" placeholder when the file is missing. The placeholder keeps `data-image-id`.
  - `parseHTML` maps an asset URL back to its token, so copying a picture inside the app keeps the token.
  - A plugin converts any `data:` `src` that appears in the doc into a file and swaps in the token. This covers Ribbon upload, HTML paste, screenshot stickies and old content. The swap must not create an extra undo step the user would notice.
- **Old pictures.** When a page opens, `CanvasEditor.tsx` also converts `data:` srcs inside every rich-text shape's `props.content` and saves. The editors aren't mounted for boxes that aren't being edited, so the plugin alone doesn't reach them. When a sticky window opens, `StickyNoteEditor.tsx` does the same through the plugin and saves.
- **Image editor.** `openImageEditorWindow` and the three double-click handlers work from the node's stored token, not the DOM `src`. On save, the editor's result is written as a new file, and the node's token is replaced when it still matches the original token.
- **Readers of `src`.** `resolve.ts`, `hoverPreview.ts` and `extractText.ts` resolve tokens for hover previews.

Files: `lib/tiptap/imageId.ts`, `lib/tiptap/extensions.ts`, new `lib/images/localImages.ts`, `lib/imageEditorWindow.ts`, `components/editor/ImageEditor.tsx`, `components/canvas/RichTextShape.tsx`, `components/canvas/CanvasEditor.tsx`, `components/editor/StickyNoteEditor.tsx`, `components/editor/RichTextEditor.tsx`, `components/sticky/StickyNotesHome.tsx`, `components/ribbon/Ribbon.tsx`, `lib/references/resolve.ts`, `lib/tiptap/hoverPreview.ts`, `lib/tiptap/extractText.ts`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/*.json`

Acceptance:
- After inserting a picture into a text box or a sticky note and saving, the stored content has `src: "skylines-image:<uuid>.<ext>"`, the file exists in `$APPDATA/images`, and the `<img>` has `naturalWidth > 0`.
- No `data:` image `src` remains in a page's saved `canvasData` or a sticky's saved `content` after it has been opened once.
- A token whose file doesn't exist renders the placeholder text, with the same `data-image-id`. Copy reference and reveal still find it.
- Editing a picture in the image editor and closing it replaces the picture in the note with the edited one.
- Hover previews of references to pictures still show the picture.

Test steps:
1. In a test note, insert a small PNG data URL picture into a text box through the editor (`setImage`). Wait for the save.
2. The saved page content has a `skylines-image:` token, and the picture is visible (`naturalWidth > 0`).
3. Insert an image node whose token names a nonexistent file: the placeholder "Picture is on another device" shows, with a `data-image-id`.
4. Seed a page with a text box holding a `data:` picture, through the DB or editor while the conversion is off, then reload and open it. The picture is converted to a token, and the file exists.
5. Create a sticky note and insert a picture: its saved content has a token.
6. Double-click a picture to open the image editor, then close it (manual if the window can't be driven). The note shows the edited picture.
7. Delete the test note and sticky note.

### T6 Pictures placed directly on the canvas are saved as local files

Status: todo
Depends on: T5
Tester: yes, assets can be created through the tldraw editor and their stored `src` checked

- Pass a module-level `TLAssetStore` as `assets` on `<Tldraw>` in `CanvasEditor.tsx`:
  - `upload` saves the file with T5's helper and returns the token
  - `resolve` returns the asset URL, or `null` when the file is missing so tldraw shows its broken-image state
  - `remove` does nothing (files are never deleted)
- When a page opens, convert every `asset:*` record whose `props.src` is a `data:` URL to a file and token, then save.
- `resolve.ts`'s `imageAsset` and `canvasPreview` resolve tokens.

Files: `components/canvas/CanvasEditor.tsx`, `lib/images/localImages.ts`, `lib/references/resolve.ts`

Acceptance:
- Dropping or pasting a picture on the canvas stores an asset whose `props.src` starts with `skylines-image:`, and the picture shows.
- Opening a page that has a `data:` asset rewrites it to a token and saves.
- A token with a missing file doesn't crash the canvas.

Test steps:
1. In a test note's page, create an image asset and shape with a small PNG data URL through the editor API, then reload and reopen the page.
2. The asset's `props.src` is a `skylines-image:` token, the file exists, and the image shape renders.
3. Delete the test note.

### T7 Sync sticky notes

Status: todo
Depends on: T2, T3, T4, T5
Tester: yes, docs can be read and written with the Firebase SDK from the webview, and the home list and sticky windows observed

- **Push.** In `push.ts`, add `stickyNoteToFirestoreDoc`, with `userId`, `title`, `contentJson` (string), `topBarColor`, `favorite`, `createdAt`, `updatedAt` and `deletedAt`, and no `pinned`. Add `pushDirtyStickyNotes` with the same per-row failure handling as T4, and call it from `pushDirtyRows`.
- **Pull.** In `pull.ts`, add a `stickyNotes` subscription using the shared `decidePull` / `applyDecision` flow, and wire it into `startPullSync`.
  - `upsertStickyNoteFromRemote` keeps the local `pinned`, or uses 0 for a new row.
  - After applying a remote change, emit `STICKY_NOTE_CHANGED_EVENT`.
  - Widen the `tableName` unions in `pull.ts` and `syncConflicts.ts`.
- **Main window.** `useSyncEngine` (or the engine) listens for `STICKY_NOTE_CHANGED_EVENT` and schedules a push, since sticky windows don't run the engine.
- **Sticky window.** `StickyNoteEditor.tsx` reloads title, colour, favourite and content when the event reports a newer `updatedAt` than the window's own last save and the window has no pending save. Remote deletes close the window, as now.

Files: `lib/sync/push.ts`, `lib/sync/pull.ts`, `lib/db/stickyNotes.ts`, `lib/db/syncConflicts.ts`, `hooks/useSyncEngine.ts`, `components/editor/StickyNoteEditor.tsx`, possibly `components/sticky/StickyNotesHome.tsx`

Acceptance:
- Editing a sticky note in its own window leads to a `stickyNotes/<id>` doc with the new `contentJson` within about 20 s, and the doc has no `pinned` field.
- A remote doc with a newer `updatedAt` updates the home list and an open sticky window that has no pending save.
- Pinning a sticky note doesn't change its Firestore doc, and a remote change doesn't unpin it.
- Deleting a sticky note pushes `deletedAt`, and a remote `deletedAt` closes the open window.
- An oversized sticky note is reported like other sync failures.

Test steps:
1. Create a test sticky note, open its window and type text. Wait for sync, then read `stickyNotes/<id>` with the SDK: it has the text, and no `pinned`.
2. With the window open and idle, write the doc from the main window's SDK with a newer `updatedAt` and new title and content. The window and the home list show them.
3. Pin the sticky, wait, and read the doc: unchanged apart from any edit. Repeat step 2: the sticky stays pinned (`pinned` = 1 in SQLite).
4. Delete the sticky note. Its doc gets `deletedAt` and the window closes.
5. Clean up: the test sticky is deleted locally. Delete its Firestore doc with the SDK.

### T8 Version 0.9.1 with the build's commit shown in the app

Status: todo
Depends on: none
Tester: yes, the account menu text is visible in the DOM

- Set `version` to `0.9.1` in `package.json` and the two top-level version fields of `package-lock.json`, and set `src-tauri/tauri.conf.json`'s `version` to `"../package.json"`.
- In `next.config.ts`, add an `env` block with `NEXT_PUBLIC_APP_VERSION` (read from `package.json`) and `NEXT_PUBLIC_BUILD_COMMIT` (`execSync("git rev-parse --short HEAD")` in try/catch, falling back to `"unknown"`).
- At the bottom of the account menu, add a disabled item reading "SkyLines v<version> (<commit>)".

Files: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `next.config.ts`, `components/topbar/AccountMenu.tsx`

Acceptance:
- `npm run build` succeeds, and the account menu shows "SkyLines v0.9.1 (<7-character hash>)".
- Building without git available still works and shows "(unknown)".
- `npm run tauri build` would name installers `…_0.9.1_…`, because Tauri reads the version from `package.json`.

Test steps:
1. Open the account menu. It shows "SkyLines v0.9.1 (" followed by a short hash and ")".

### T9 Write logs to a file in every window

Status: todo
Depends on: T4
Tester: yes, errors can be raised in each window with `webview_execute_js` and the log file read from disk

- Add `tauri-plugin-log` (Rust) and `@tauri-apps/plugin-log` (JS).
  - Register the plugin in `src-tauri/src/lib.rs` with targets log dir and stdout, max file size about 1 MB, keep 2 rotated files, level info.
  - Add `log:default` to `default.json`, `sticky.json` and `image-editor.json`.
- Add a client component, for example `components/LogBridge.tsx`, mounted in `app/layout.tsx`.
  - It wraps `console.error` and `console.warn` so they still print and also go to the plugin's `error` / `warn`.
  - It handles `window` `error` and `unhandledrejection`.
  - Each line starts with the window label and is capped at 2000 characters. Load the plugin with a dynamic import, as the clipboard code does.
- Check the existing `console.error` call sites for any that print note text, and trim them to ids.

Files: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `sticky.json`, `image-editor.json`, `package.json`, `app/layout.tsx`, new `components/LogBridge.tsx`

Acceptance:
- A `console.error("x")` in the main window and in a sticky window each produce a line in the app's log file, tagged with that window's label.
- An uncaught error and an unhandled promise rejection are logged.
- The log file rotates at about 1 MB and keeps at most 2 old files.
- No log call includes note, page or sticky content.

Test steps:
1. In the main window, run `console.error("logtest-main")`, and throw inside a `setTimeout`.
2. Open a test sticky note and run `console.error("logtest-sticky")` in its window.
3. Read the log file (macOS `~/Library/Logs/com.skylines.app/`). It holds all three lines, with `main` and `sticky-<id>` labels.
4. Delete the test sticky note.

### T10 Report a bug from the account menu

Status: todo
Depends on: T4, T8, T9
Tester: yes, the copied text can be read back through the clipboard plugin, though opening the folder is OS-level

- Add two items to the account menu:
  - **"Copy bug report"** follows the `CopyReferenceItem` pattern (closeOnClick false, then a "Copied" flash). It builds the text described in Decisions: version and commit, `navigator.userAgent`, sync status, current sync failures, the last 200 lines of the current log file, and "What happened:".
  - **"Open logs folder"** opens the log dir with `openPath`.
- Grant `fs:allow-read-file` for `$APPLOG/*` and `opener:allow-open-path` for `$APPLOG` in `default.json`.

Files: `components/topbar/AccountMenu.tsx`, possibly a small `lib/bugReport.ts`, `src-tauri/capabilities/default.json`

Acceptance:
- After clicking "Copy bug report", the clipboard contains the version line, the commit, the sync status, at most 200 log lines and "What happened:".
- The report contains no note content beyond what the log already holds.
- "Open logs folder" calls `openPath` with the log dir, and the capability allows it.

Test steps:
1. Run `console.error("bugreport-marker")`, then open the account menu and click "Copy bug report". The item shows "Copied".
2. Read the clipboard with `readText`. It includes "v0.9.1", the commit, the sync status, "bugreport-marker" and "What happened:".
3. Click "Open logs folder" (manual: a Finder or Explorer window opens on the logs folder).

### T11 Setup scripts and a Getting started README

Status: todo
Depends on: T1, T2, T7, T8, T9, T10
Tester: no, installing toolchains and reading docs can't be checked in the running app

- **`scripts/setup.sh` (macOS, `set -euo pipefail`).** It can be re-run safely and stops with a clear message on failure.
  - Xcode Command Line Tools via `xcode-select -p`, else `xcode-select --install`, then wait for the user.
  - Rust through rustup when `cargo` is missing.
  - Node 24 or newer from Homebrew when `brew` exists, else print the nodejs.org link and stop.
  - Then `npm ci`, a check that `.env.local` exists (if not, explain who to ask), and `npx tauri info`.
- **`scripts/setup.ps1` (Windows).** Uses `winget`:
  - `Microsoft.VisualStudio.2022.BuildTools` with the C++ workload, `Rustlang.Rustup`, `OpenJS.NodeJS.LTS`
  - then refreshes PATH and does the same `npm ci`, `.env.local` check and `npx tauri info`
- **Pins.** Add `.nvmrc` (`24`), `engines.node` (`>=24`) in `package.json`, and `src-tauri/rust-toolchain.toml` (channel `1.99`).
- **README.**
  - **"Getting started"** goes at the top. It covers, in order:
    - running the setup script, or what to install by hand
    - cloning
    - getting `.env.local` and putting it in the repo root
    - `npm run tauri dev`
    - `npm run tauri build` and installing the result: building it yourself avoids the "unidentified developer" and SmartScreen warnings
    - signing up
    - updating (`git pull`, re-run `npm ci`, rebuild)
    - where logs are and how to use "Copy bug report"
    - known limits: pictures stay on the computer they were added on, pinned is per computer, and every computer must be updated before editing
  - **macOS.** Add a macOS section next to Windows.
  - **Windows.** Replace the hardcoded `0.1.0` install paths with `<version>`.
  - **Maintainers.** Add releasing with `npm version patch|minor|major` (it commits and tags; `minor` from 0.9 gives 0.10.0, so use `major` or `npm version 1.0.0`) next to the T2 rules section.
  - **Clean-up.** Remove the stale "Notes" section (no app shell, `/home`, spike routes) and the link to `../note_taking_app/SPEC_iter1.md`.

Files: `scripts/setup.sh`, `scripts/setup.ps1`, `.nvmrc`, `package.json`, `src-tauri/rust-toolchain.toml`, `README.md`

Acceptance:
- `bash -n scripts/setup.sh` passes. Re-running the script on this machine, where everything is installed, installs nothing, then runs `npm ci` and `npx tauri info` and exits 0.
- `setup.ps1` installs only the missing tools, through `winget`, and stops with a message when `winget` isn't available.
- The README's first section is "Getting started" and covers every item listed above, with log paths for macOS and Windows that match where T9's plugin writes.
- The README no longer mentions spike routes, `/home` or `0.1.0`.

Test steps (manual):
1. On this Mac, run `bash scripts/setup.sh`. It reports each tool as already installed and ends with `npx tauri info` output.
2. On a Windows machine (or VM), run `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`, then `npm run tauri dev`.
3. Read "Getting started" as a new user and follow it to a signed-up account.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Keep dev-only things out of release builds
