# Account switching and sign-in polish

Source: planning.md, 2026-10-21

## Goal

Switching accounts on one computer must never show, open or edit another account's data. Today, signing in as a second account reopens the first account's last note in a broken, shell-less screen with no way out. Alongside that fix, the sign-in screens get small usability improvements: Google sign-in brings SkyLines back to the front, sign-up asks for the password twice, and every password field can be shown in plain text.

## Context

- **Shape of the app.** Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`. The previous spec (T1–T12, in git history) added Firestore rules, sync, logs and the loopback Google sign-in.
- **Sign-in screens.**
  - Login is `app/login/page.tsx`. Sign-up is a separate page, `app/register/page.tsx`: optional name, email and one password (`password.length < 6` check). Both pages are public routes in `components/AppShell.tsx` (`PUBLIC_ROUTES`) and use the same centered `max-w-sm space-y-6` card.
  - Errors show as `{error && <p className="text-sm text-destructive">{error}</p>}` on both pages.
  - The only password inputs are login L148-154 and register L64-70. "Forgot password?" uses Firebase's hosted reset page, so there's no reset form in the app.
  - `components/ui/input.tsx` is a thin wrapper over `@base-ui/react/input` with no icon slot. `components/ui/button.tsx` has `variant="ghost"` and `size="icon-xs"`. `lucide-react` (with `Eye` / `EyeOff`) is installed and widely used.
- **Google sign-in.**
  - `src-tauri/src/google_oauth.rs` `google_oauth_listen` serves a fixed `PAGE` ("You can close this tab and return to SkyLines.", no script) for `/`, emits `google-oauth:redirect` to `main` and stops. `app/login/page.tsx` `handleGoogle` finishes the sign-in.
  - Nothing brings SkyLines forward afterwards.
  - `src-tauri/src/lib.rs` has a private `show_main_window(&AppHandle)` (`#[cfg(desktop)]`: `show`, `unminimize`, `set_focus`), used by the tray, the global shortcut and the `focus_main_window` command. Closing the main window hides it, so it may be hidden at sign-in time.
- **Why switching accounts breaks** (traced; line numbers as of 0651145):
  - Sign-out (`components/topbar/AccountMenu.tsx:100-103`, `components/sidebar/Sidebar.tsx:114-117`) only calls `signOut` and goes to `/login`. It clears nothing.
  - `lib/lastOpen.ts` keeps one device-wide localStorage key, `skylines:lastOpen`, with no user id.
    - It's written by `recordNoteOpened` in `app/canvas/page.tsx:36`, `app/page.tsx:34` and `lib/references/navigate.ts:42,50`.
    - It's read by the restore effect in `components/AppShell.tsx:142-185`, which looks up the note with `getNoteById` and calls `router.replace('/canvas?id=…')`.
  - The by-id getters don't filter by user:
    - `getNoteById` / `getNoteRowById` (`lib/db/notes.ts:90,103`)
    - `getFolderById` (+row) (`lib/db/folders.ts:89,102`)
    - `getNotebookById` (+row) (`lib/db/notebooks.ts:46,56`)
    - `getPageById` (+row) and `getPages(noteId)` (`lib/db/pages.ts:48,93,103`)
    - `getStickyNoteById` (+row) (`lib/db/stickyNotes.ts:107,117`)

    The list and dirty queries do filter (`getNotes`, `getFolders`, `getNotebooks`, `getStickyNotes`, `getDirty*`). Every table has `user_id TEXT NOT NULL`.
  - `stores/appStore.ts` has no reset action. The data hooks (`hooks/useNotebooks.ts`, `useNotes.ts`, `useFolders.ts`) only unsubscribe when the user changes. So `notebooks`, `notes`, `folders`, `notebooksLoaded` (never reset to false), `selectedNotebookId`, `selectedFolderId`, `noteHistory` / `historyIndex`, `clipboard`, `pages` and `selectedPageId` survive sign-out.
  - `app/canvas/page.tsx:30-50` loads the note by id and resolves its notebook with `resolveNoteNotebookId` (`lib/notebookSync.ts`). That gives null for another account's note. `components/shell/AppLayout.tsx:15-17` then renders only the children (`PageSidebar` + canvas) with no top bar or sidebar. That is the reported screen, and there's no way out, since sign-out lives in the top bar.
  - Edits made in that state are written with the note's `user_id` (account A) and `dirty=1`. They would be pushed into A's Firestore account the next time A signs in.
  - **Sync engine** (`lib/sync/engine.ts:168-219, 355-383`): if a push is in flight at sign-out, its failure calls `scheduleBackoffRetry` after teardown. That leaves a timer retrying A's rows under B's auth, so B sees "Sync error". The follow-up path at line 216 can also call `attemptPush` with A's id.
  - Push only sends `getDirty*(userId)` rows and pull is `where("userId","==",uid)`, so sync itself doesn't mix accounts.
- **Getting the current user outside React.** Module code such as `lib/references/navigate.ts` can use `auth.currentUser?.uid` from the app's Firebase auth instance. React code uses `useAuthContext()` (`components/AuthProvider.tsx`).

## Decisions

- **Google tab** (user's choice): SkyLines comes to the front as soon as the redirect arrives, on success, cancel or failure. The page also tries `window.close()`. Browsers usually block that for a tab the OS opened, so the page keeps a short neutral line ("You can close this tab and return to SkyLines."). It doesn't say "Signed in", because the same page is served on failure. No `skylines://` redirect.
- **Bring-forward** reuses `show_main_window`, called from Rust right after the emit. No macOS-specific activation code in this round. If macOS leaves the window behind the browser, report it in the handover instead of adding native code.
- **Account switching** (user's choice): keep every account's local data on the computer and scope it to the signed-in account. Nothing is wiped on sign-out, so unsynced edits are never lost. An account's dirty rows wait until that account signs in on this computer again.
- **Last open** becomes per account: key `skylines:lastOpen:<uid>`. The old `skylines:lastOpen` key is removed and ignored.
- **State reset** happens in one place: when the signed-in uid changes (to another account or to null), reset the store's data and navigation slices to their initial values, including `notebooksLoaded = false`. This covers both sign-out buttons and any other way auth changes.
- **A note, page, folder, notebook or sticky note that isn't the signed-in account's**, or doesn't exist, is treated as not found. Routes that load one by id (`/canvas`, `/sticky`) go to `/` (the notebook picker with the full shell) instead of rendering without the shell.
- **By-id getters** take a `userId` argument and add `AND user_id = $n`. Sync code passes the engine's user id.
- **Password fields**: one shared `PasswordInput` in `components/ui/`. It's a `relative` wrapper around `Input`, with an `Eye` / `EyeOff` ghost icon button inside the right edge (`type="button"`, `aria-label` "Show password" / "Hide password", `aria-pressed`). Each field has its own toggle. Login uses `autoComplete="current-password"`; register uses `"new-password"`.
- **Confirm password**: a second field "Confirm password" on register. On submit, a mismatch shows "Passwords don't match." and nothing is sent to Firebase. The check runs after the existing length check.

## Out of scope

- Wiping local data on sign-out, and deleting or scoping picture files in `$APPDATA/images`.
- Closing or reloading open sticky-note pop-out windows when the account changes.
- Firestore writes still pending in the SDK at the moment of sign-out.
- A password reset form inside the app.
- Native macOS app activation, and removing the unused `skylines://` deep-link plugin.

## Tasks

### T1 Show/hide passwords and confirm the password on sign-up

Status: todo
Depends on: none
Tester: yes, toggling and the mismatch error are observable in the DOM. Being signed out is a manual precondition.

- Add `components/ui/PasswordInput.tsx` as described in Decisions. It forwards all `Input` props and adds right padding so text doesn't run under the icon.
- Use it for the password field on `app/login/page.tsx` and on `app/register/page.tsx`.
- On register, add a "Confirm password" `PasswordInput`. Validate a match on submit as described in Decisions, before `createUserWithEmailAndPassword`.

Files: new `components/ui/PasswordInput.tsx`, `app/login/page.tsx`, `app/register/page.tsx`

Acceptance:
- Login has one password field and register has two. Each has its own toggle button, and its input's `type` switches between `password` and `text` when clicked.
- Clicking a toggle never submits the form.
- Submitting register with mismatched passwords shows "Passwords don't match." and makes no Firebase call. The existing length check still runs first.
- The toggle has an `aria-label` that matches its state.

Test steps:
1. Precondition (manual): the user signs out so the login page shows. The tester never signs in or out.
2. On login, type into the password field and click its eye button. The input's `type` becomes `text`; click again and it's `password`. The page is still on login, with no error.
3. Go to "Sign up". Fill email `mismatch-test@example.com`, password `abcdef` and confirm `abcdeg`, then submit. "Passwords don't match." shows, the page stays on register, and no account is created. Don't submit with matching passwords.
4. Both register password fields toggle independently.

### T2 Google sign-in brings SkyLines back to the front

Status: todo
Depends on: none
Tester: no. The steps need a real Google account in the system browser and native window focus, which the tester can't drive.

- In `src-tauri/src/google_oauth.rs`, after emitting `google-oauth:redirect`, call `show_main_window` behind `#[cfg(desktop)]`. Make it `pub(crate)` in `src-tauri/src/lib.rs`.
- Add `<script>window.close()</script>` to `PAGE`, keeping its current text.

Files: `src-tauri/src/google_oauth.rs`, `src-tauri/src/lib.rs`

Acceptance:
- After any redirect to `/` on the listener (success, `error=access_denied` or a wrong `state`), the main window is shown, unminimized and focused.
- The served page contains a `window.close()` script and the "You can close this tab and return to SkyLines." text.
- Requests for other paths (such as `/favicon.ico`) still get a 404 and neither focus the window nor end the wait.

Test steps (manual):
1. Signed out, click "Continue with Google" and choose an account. SkyLines comes to the front, signed in. The browser tab either closes or shows the close-this-tab line.
2. Click "Continue with Google", minimize SkyLines, then cancel on Google's page. SkyLines comes back to the front showing "Google sign-in cancelled.".
3. On macOS, note whether the window actually comes in front of the browser. If it doesn't, report it.

### T3 Signing in as another account starts clean

Status: todo
Depends on: none
Tester: yes. A note owned by another user can be seeded in SQLite and pointed to from localStorage, then the restore and canvas routes are observable.

- **`lib/lastOpen.ts`.** Key the stored value by uid (`skylines:lastOpen:<uid>`). `getLastOpen` / `recordNoteOpened` / the other helpers take the uid, and their callers pass it (see Context). Remove the old key once.
- **`stores/appStore.ts`.** Add a `resetForUser()` action that restores every data and navigation slice listed in Context to its initial value, including `notebooksLoaded: false`. Call it from `components/AppShell.tsx` whenever the signed-in uid changes, before the data hooks refetch.
- **Restore effect** (`AppShell.tsx` ~142-185) **and `app/canvas/page.tsx`.** Treat a note whose `userId` isn't the signed-in uid as missing. In the canvas page, a missing or foreign note does `router.replace("/")` and never calls `recordNoteOpened` or `visitNote`. Apply the same rule to `app/sticky/page.tsx` for a foreign sticky note (show its existing not-found handling or close, whichever it does today for a missing id).
- **`lib/sync/engine.ts`.** A stopped engine never schedules work. Check the engine generation (or an equivalent stopped flag) in `attemptPush` and `scheduleBackoffRetry` before scheduling, and make the follow-up push use the current user, never a stale closure id.

Files: `lib/lastOpen.ts`, `stores/appStore.ts`, `components/AppShell.tsx`, `app/canvas/page.tsx`, `app/page.tsx`, `lib/references/navigate.ts`, `app/sticky/page.tsx`, `lib/sync/engine.ts`

Acceptance:
- `lastOpen` is stored under a per-uid key, and a value under another uid's key is never read.
- After the uid changes, the store's notebooks, notes, folders, selection, history, clipboard and pages are back to their initial values, and `notebooksLoaded` is false until the new user's notebooks load.
- `/canvas?id=<a note owned by another user or missing>` ends on `/` with the full shell (top bar visible) and doesn't write `lastOpen`.
- After `stopSyncEngine`, no push or retry timer runs for the old user, even if a push was in flight.
- Email/password and Google sign-in still land on `/`.

Test steps:
1. Signed in as `dev@skylines.local`. With `webview_execute_js`, insert a note row into SQLite with a new UUID and `user_id = 'someone-else'` (no notebook, title "foreign-test"), and set localStorage `skylines:lastOpen:<dev uid>` to that note. Store the id on `window`.
2. Reload the main window. It ends on `/` with the top bar visible, not on `/canvas`, and `skylines:lastOpen:<dev uid>` no longer points to the foreign note.
3. Navigate to `/canvas?id=<foreign id>`. It ends on `/` with the top bar visible.
4. Navigate to `/canvas?id=<an id that doesn't exist>`. Same result.
5. Delete the seeded row and restore any lastOpen value you changed.
6. Manual: sign in as account A, open a page, sign out, sign in as account B. B lands on its own notebooks with the full shell, and Back in the top bar doesn't go to A's note.

### T4 Lookups only return the signed-in account's data

Status: todo
Depends on: T3
Tester: yes. Seeded rows owned by another user can be targeted through routes and references.

- **By-id getters.** Give each getter listed in Context a `userId` parameter and filter `AND user_id = $n`. That includes `getPages(noteId, userId)`.
- **Callers.** Update every caller:
  - React code passes the auth user's uid.
  - `lib/references/navigate.ts` and other module code use `auth.currentUser?.uid`, and treat no user as not found.
  - `lib/stickyWindow.ts` follows the same rule.
  - Sync code (`lib/sync/pull.ts` and others) passes the engine's user id.
- Grep for every call site; nothing may call a by-id getter without a user id.

Files: `lib/db/notes.ts`, `lib/db/folders.ts`, `lib/db/notebooks.ts`, `lib/db/pages.ts`, `lib/db/stickyNotes.ts` and their callers (including `lib/references/navigate.ts`, `lib/references/resolve.ts`, `lib/stickyWindow.ts`, `lib/sync/pull.ts`, `components/canvas/`, `components/sidebar/`, `app/`)

Acceptance:
- Every by-id getter and `getPages` takes a user id and returns nothing (null or an empty list) for rows owned by another user.
- No call site calls them without a user id (`npx tsc --noEmit` enforces the new signatures).
- Following a reference to another user's note, page or sticky note does nothing, or shows the existing "missing" state, instead of opening it.
- Pull still applies remote changes for the signed-in user (create, edit and delete on another device still show up).

Test steps:
1. Signed in as `dev@skylines.local`, seed with `webview_execute_js` a foreign note row and a foreign sticky-note row (`user_id = 'someone-else'`, new UUIDs).
2. Navigate to `/canvas?id=<foreign note>`. It ends on `/`. Open `/sticky?id=<foreign sticky>` the way the app opens sticky windows, if reachable. It doesn't show the foreign content.
3. In a test note of your own, insert a reference chip pointing at the foreign note id (as the existing reference tests do). Clicking it doesn't open the foreign note, and its chip shows the missing state.
4. Your own notes, pages and sticky notes still open normally, and a reference to your own note still works.
5. Delete the seeded rows and the test note.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
