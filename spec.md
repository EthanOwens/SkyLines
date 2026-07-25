# Skylines — Local-First Note-Taking App (Tauri v2 Rewrite)

## Goal

Build Skylines: a standalone desktop + mobile note-taking app (rich text notes
+ infinite-canvas notes), ported from the existing Next.js/Firebase web app
in `../note_taking_app`. The rewrite moves to **Tauri v2**, with **SQLite as
the local source of truth** and **Firebase Firestore as a background sync
target** (local-first, last-write-wins sync — not real-time multi-user
collaboration). This gets real OS integration (tray, global shortcuts, native
menus) and a native feel/performance that a browser tab and PWA wrapper can't
provide.

The target architecture, data model, sync engine design, and migration
roadmap are already worked out in detail in
`../note_taking_app/SPEC_iter1.md` — that document is the primary technical
reference for this rewrite (parts 1–3). This spec sequences that plan into
concrete, scoped subtasks for `/dev-loop` and records the scope decisions
made for *this* repo specifically.

The app is renamed **Skylines** (package name, Tauri app identifier, window
title, branding) — this is a fresh product name, not just a folder name.

## Non-Goals

- **Do not modify `../note_taking_app`.** It is a read-only reference (both
  its code and `SPEC_iter1.md`) for porting from — not a dependency, not a
  shared package, not something this project writes back to.
- **No CRDT-based / real-time multi-user collaboration.** Sync is
  last-write-wins by `updated_at`, per `SPEC_iter1.md`'s explicit reasoning
  (single-user data, narrow conflict surface). Do not introduce Yjs/Automerge
  or a relay server.
- **No new features beyond the current app's feature set.** Search, tags,
  backlinks/note-linking, version history, attachments beyond inline base64
  images, export/import, trash/undo-delete, and drag-to-reorder are all
  explicitly absent today (per `SPEC_iter1.md` Part 1) and stay absent in
  this rewrite. This is a platform migration, not a feature expansion.
- **No new Firebase project.** Reuse the existing project/credentials from
  `../note_taking_app/.env.local` (copy into this repo's own
  `.env.local`, gitignored — do not commit it, do not regenerate credentials,
  do not change Firestore security rules).
- **No automated test infra in this pass** (no Vitest/etc. setup). Rely on
  manual verification and the `/dev-loop` adversarial-reviewer pass.
- **No OS-level drag-and-drop behavior.** The `tauri://drag-drop` listener
  gets wired as a no-op placeholder only (see Decisions) — do not invent
  attachment-import behavior for it.
- **No Mac or Linux desktop packaging, no iOS build**, in this pass — this
  dev machine is Windows. Desktop packaging targets Windows only; mobile
  targets Android only. Mac/Linux packaging and iOS are explicitly deferred,
  not attempted via cross-compilation guesswork (see Decisions).
- **Do not fix or change anything not called out below.** In particular,
  don't "clean up" unrelated parts of the ported UI/component code beyond
  what's needed to run on SQLite/Tauri instead of Firestore-direct/Next
  server.

## Subtasks

Sequenced roughly per `SPEC_iter1.md` Part 3's milestones (M0–M7), broken
into implementor-sized units. Each assumes prior subtasks in the list are
done unless marked parallel.

1. **Repo + Tauri scaffold.** `git init` this repo. Scaffold a Tauri v2 +
   Next.js project here (`create-tauri-app` or manual `src-tauri/` +
   Next.js). Copy over and adapt base config from `../note_taking_app`:
   `tsconfig.json`, `tailwind`/`postcss.config.mjs`, `components.json`
   (shadcn), `.gitignore`. Rename branding to **Skylines** in
   `package.json`, `tauri.conf.json` (app identifier, window title), and any
   manifest metadata.
2. **Env + secrets.** Copy `../note_taking_app/.env.local` values into this
   repo's own `.env.local` (gitignored) and `.env.local.example`
   (placeholders only, committed). Verify `firebase.ts` initializes with
   these values.
3. **M0 spike — static export + client nav inside Tauri.** Configure
   `output: "export"`, `trailingSlash: true` in `next.config.ts`. Build two
   trivial routes and confirm `<Link>`/`router.push` navigation stays
   SPA-smooth when loaded inside the Tauri webview (not full page reloads).
   Record the result. If navigation is *not* smooth, stop and flag it back
   before continuing — that decides whether the rest of this plan proceeds
   with Next's App Router or needs to fall back to a plain Vite + React
   Router shell (per `SPEC_iter1.md` M0 note).
4. **M0 spike — tauri-plugin-sql wiring.** Install `tauri-plugin-sql`,
   confirm a trivial table read/write round-trips correctly from frontend TS
   through to a SQLite file on disk.
5. **M1 — routing fix.** Convert `/note/[id]` and `/canvas/[id]` to
   query-param routes `/note?id=...` and `/canvas?id=...`. Update every URL
   construction site (`NoteItem.tsx`, `FolderItem.tsx`, `Sidebar.tsx`, and
   the page files themselves).
6. **M1 — drop PWA.** Remove `next-pwa` config from `next.config.ts`, drop
   `public/manifest.json` and `appleWebApp` metadata from the root layout
   (superseded by the native shell).
7. **M2 — SQLite schema.** Create the `folders`, `notes`, `sync_meta` tables
   and indexes exactly as specified in `SPEC_iter1.md` Part 2, applied via a
   `tauri-plugin-sql` migration.
8. **M2 — types.** Port `types/index.ts`, extending `Folder`/`Note` with the
   sync bookkeeping fields (`dirty`, `syncedAt`, `deletedAt`).
9. **M2 — local data-access layer.** Implement `lib/db/notes.ts` and
   `lib/db/folders.ts` mirroring the current `lib/firestore/notes.ts` /
   `folders.ts` function signatures (CRUD + soft-delete via `deletedAt`, all
   local writes set `dirty = 1`), so `stores/appStore.ts` and the
   `useNotes`/`useFolders` hooks need minimal changes when rewired in
   subtask 15.
10. **M2 — fix folder-delete recursion bug.** When deleting a folder, recurse
    into child subfolders (not just direct child notes) — this is being
    fixed as part of the rewrite per your decision, since the new
    `lib/db/folders.ts` delete function is being written fresh anyway.
11. **M3 — push sync.** Implement local→Firestore push: rows where
    `dirty = 1`, written via `setDoc(..., {merge:true})`. Swap
    `updatedAt: serverTimestamp()` for a client-generated millisecond
    timestamp (required for LWW comparison). On success, clear `dirty`, set
    `syncedAt`.
12. **M3 — pull sync.** Implement Firestore→local pull: `onSnapshot`
    (`docChanges()`), upserting into SQLite guarded by `updatedAt`
    LWW comparison. When a pull detects the remote row changed *and* the
    local row is also `dirty`, snapshot the losing version into a
    conflict-backup table before overwriting.
13. **M3 — tombstones + cleanup.** Soft-delete via `deletedAt` pushed like
    any other field update; periodic cleanup hard-deletes old tombstones on
    both local and remote sides.
14. **M3 — real offline/retry + syncStatus.** Wire `online`/`offline`
    listeners, capped-backoff retry on push/pull failure plus immediate
    retry on reconnect/app-resume, and surface a real `syncStatus`
    (`saved`/`syncing`/`offline`/`error`) — this makes the currently dead
    `"offline"` state real, per your decision to fix it. Debounce Firestore
    pushes (5–15s or on idle) now that SQLite, not Firestore, needs to feel
    instant.
15. **M4 — auth + data hooks rewire.** Port `AuthProvider`/`useAuth`
    unchanged (Firebase Auth itself isn't touched yet — see subtask 21).
    Rewire `useNotes`/`useFolders`/`appStore` to read from the SQLite layer
    (subtask 9) instead of directly from Firestore `onSnapshot`.
16. **M4 — sidebar.** Port `Sidebar`/`FolderTree`/`FolderItem`/`NoteItem`
    against the SQLite-backed hooks: inline rename, create note/canvas/folder,
    per-folder context menu, delete (using the fixed recursive delete from
    subtask 10).
17. **M4 — rich text editor.** Port `RichTextEditor`, `EditorToolbar`, and
    the Tiptap extension set unchanged; autosave debounces to the SQLite
    layer instead of Firestore directly.
18. **M4 — canvas editor.** Port `CanvasEditor` (tldraw) unchanged; snapshot
    autosave debounces to the SQLite layer instead of Firestore directly.
19. **M4 — shared UI + styling.** Port shadcn primitives (`button`, `dialog`,
    `dropdown-menu`, `input`, `scroll-area`, `separator`, `tooltip`),
    `globals.css`, `editor.css`. Can run in parallel with 16–18.
20. **M4 — sync status badge.** Wire the sidebar-header and editor-toolbar
    sync status badges to the real `syncStatus` from subtask 14.
21. **M5 — auth rework.** Replace `signInWithPopup` (Google sign-in) with a
    system-browser + deep-link flow (`@tauri-apps/plugin-shell` `open()` +
    `tauri-plugin-deep-link`) or `signInWithRedirect`. Leave email/password
    sign-in as-is. Configure Tauri's CSP `connect-src` to allow the
    Firebase/Google Auth/Firestore domains.
22. **M6 — Windows desktop packaging.** Produce a working Windows build
    (`tauri build` for Windows target). Mac/Linux packaging is out of scope
    for this pass (see Non-Goals).
23. **M6 — tray + native menu.** Desktop-only (guard via `platform()`):
    system tray icon and native application menu using Tauri v2's core
    `@tauri-apps/api/tray` / `@tauri-apps/api/menu`.
24. **M6 — global shortcuts.** Desktop-only, platform-gated:
    `@tauri-apps/plugin-global-shortcut`, checked against `platform()`
    before registering.
25. **M6 — drag-and-drop plumbing (no-op).** Enable `dragDropEnabled` in
    `tauri.conf.json` and register a `tauri://drag-drop` listener that logs/
    no-ops on drop — infrastructure only, no attachment behavior (see
    Non-Goals).
26. **M7 — Android build.** Set up the Android build target, get a debug
    build running on an emulator or device, and validate the mobile risk
    flags called out in `SPEC_iter1.md` (keyboard behavior, tldraw touch/
    edge-gesture conflicts). iOS is out of scope for this pass (see
    Non-Goals).

## Key Decisions

- **`SPEC_iter1.md` is the technical source of truth for architecture.**
  This spec sequences and scopes it for this repo; where the two conflict,
  defer to the decisions recorded here (they're the narrower, repo-specific
  cut).
- **Full roadmap, scoped by platform, not by milestone.** All of M0–M7 are
  included, but Mac/Linux desktop and iOS are dropped rather than attempted
  blind — this machine is Windows, and packaging/build validation those
  targets can't actually be executed or verified here. Revisit once a Mac
  is available.
- **Port and adapt, not rewrite from scratch.** The UI layer (editor,
  canvas, sidebar, shadcn components) is copied from `../note_taking_app`
  and adapted, since `SPEC_iter1.md` itself notes the UI barely changes —
  only its data source does. This is faster and lower-risk than
  reimplementing Tiptap/tldraw wiring from zero.
- **Reuse the existing Firebase project.** Same backend data as
  `note_taking_app` — this is the same user's notes, not a fresh dataset.
- **Fixing two known bugs during the port, not carrying them forward:**
  folder-delete not recursing into subfolders (subtask 10), and the dead
  `"offline"` sync status (subtask 14 — this one is fixed as a natural
  side effect of building real offline detection anyway, not extra work).
- **No attachment/drag-drop behavior invented.** `SPEC_iter1.md` lists OS
  drag-and-drop as an integration point but the app has no attachment
  feature to define what a dropped file *does*. Wiring the event as a no-op
  (subtask 25) keeps the plumbing ready without inventing a feature that
  wasn't asked for.
- **No test infra this pass.** Correctness leans on `/dev-loop`'s
  adversarial-reviewer step and manual verification instead.

## Open Questions

- Whether Next's App Router client-side navigation actually stays SPA-smooth
  inside Tauri's asset serving (subtask 3) — unresolved until that spike
  runs; a "no" answer changes the framework choice for everything after it.
- Whether inline base64 images should move to filesystem-backed attachments
  now that local storage exists — explicitly deferred in `SPEC_iter1.md`,
  still deferred here.
- Exact current API shapes for `tauri-plugin-sql` migrations and Tauri v2
  tray/menu module paths — `SPEC_iter1.md` flags these as needing
  verification against whatever version is installed at implementation
  time, not assumed from docs.
- Mac/Linux desktop packaging and iOS mobile support have no concrete plan
  yet beyond "revisit when a Mac is available" — not scheduled.

## Progress

- Subtask 1 (Repo + Tauri scaffold) — done — commit 82d0a24
