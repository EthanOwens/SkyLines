# First-run and sign-in polish

Source: review of the sign-in and startup flow in conversation, 2026-10-23

## Goal

Make SkyLines easier for someone opening it for the first time. The first screens stop showing developer placeholder text, there's always a way to sign out, sign-in and sign-up errors say what actually went wrong, and Google sign-in is offered on sign-up too. "Forgot password?" becomes an in-app flow: the user gets a 6-digit code by email, types it into SkyLines and sets a new password there. A last task clears out code nothing uses.

## Context

- **Shape of the app.** Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`. Firebase is client-only today: `firebase.json` only deploys `firestore.rules`, and there are no Cloud Functions and no Firebase Hosting. The Firebase CLI isn't installed globally; use `npx firebase-tools` in docs, and never deploy or log in from an agent.
- **Auth plumbing.** `components/AuthProvider.tsx` (`useAuthContext()`) is the only auth state source. `components/AppShell.tsx` gates routes: `PUBLIC_ROUTES = ["/login", "/register"]`, with paths normalized for the trailing slash. Signed-in users visiting a public route are not redirected away. `lib/firebase.ts` exports `auth`, `db` and the default `app`.
- **Sign-in screens.** `app/login/page.tsx` and `app/register/page.tsx` share a centered `max-w-sm space-y-6` card, use `Input` and `PasswordInput` (`components/ui/`), and show errors as `{error && <p className="text-sm text-destructive">{error}</p>}`. Register checks `password.length < 6` and then that the two passwords match. Login has an "or" divider before "Continue with Google", and a dev-only `DevLogin` block.
- **Google sign-in** is `handleGoogle` in `app/login/page.tsx`. It runs a loopback OAuth flow: `google_oauth_listen` / `google_oauth_exchange` in Rust, helpers in `lib/auth/googleOAuth.ts`, including `isGoogleSignInConfigured()`. When unconfigured it currently sets an error naming the two `NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_*` env vars.
- **Forgot password today.** `handleForgotPassword` in `app/login/page.tsx` calls Firebase's `sendPasswordResetEmail`, which sends a link to Firebase's hosted reset page. With an empty email field it falls back to `window.prompt`.
- **Shell layout.** `components/shell/AppLayout.tsx` renders the top bar (`components/topbar/TopBar.tsx`, which holds `AccountMenu`), the sidebar and the ribbon only when a notebook is selected. Otherwise, as on the notebook picker, it renders the page full-screen with no account menu. Sign-out exists only in `AccountMenu` and `components/sidebar/Sidebar.tsx`. Once a notebook is selected there's no UI path back to the picker.
- **Home route** `app/page.tsx` shows the picker. When a notebook is selected and the route is `/`, it shows placeholder text: "Notebook "X" is open" and "Sidebar/note view coming in a later subtask." `AppShell`'s restore effect redirects `/` to the last note when `skylines:lastOpen:<uid>` (localStorage, `lib/lastOpen.ts`) has a `noteId`. With only a `notebookId`, it selects the notebook and stays on `/`.
- **Creating a note.** `newNote()` in `components/sidebar/Sidebar.tsx` (~L75-97) creates a canvas note in the selected notebook and folder (falling back to `getOrCreateDefaultNotebookId`), appends it with `nextOrderValue`, and pushes `/canvas?id=<id>`.
- **Firestore rules** (`firestore.rules`) allow client access only to `folders`, `notes`, `notebooks`, `pages` and `stickyNotes`. Any other collection is denied to clients, while the Admin SDK in Cloud Functions bypasses the rules.

## Decisions

- **Notebook empty state** (item 1): on `/` with a notebook open, show the notebook's name, "Pick a note in the sidebar, or create a new one." and a "New note" button. The button does exactly what the sidebar's New note does, through one shared function rather than a copy.
- **Account menu on the picker** (item 2): when no notebook is selected, `AppLayout` also renders `AccountMenu` pinned to the top-right corner. Nothing else from the top bar is added there.
- **Error messages** (item 3) come from one helper, `authErrorMessage(err, fallback)` in `lib/auth/errors.ts`, which maps Firebase error codes:
  - `auth/network-request-failed`: "Can't reach the sign-in service. Check your internet connection and try again."
  - `auth/too-many-requests`: "Too many attempts. Wait a few minutes and try again."
  - `auth/invalid-email`: "That email address doesn't look right."
  - `auth/weak-password`: "That password is too weak. Try a longer one."
  - `auth/email-already-in-use`: "An account with this email already exists. Sign in instead, or use Continue with Google if you signed up that way."
  - `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found`: "Invalid email or password."
  - `auth/user-disabled`: "This account has been disabled."
  - Anything else gets the caller's fallback and is logged with `console.error`, so it reaches the log file.
- **Login heading** (item 4): "Sign in to Skylines", with the subtitle "Use your email or Google account." The UI keeps its existing "Skylines" spelling.
- **Google on sign-up** (item 4): register gets the same "or" divider and "Continue with Google" button as login, through one shared `components/auth/GoogleSignInButton.tsx` that owns the flow now in `handleGoogle`.
- **Google not configured** (item 6): the button still shows, disabled, with a muted line below it: "Google sign-in isn't set up in this build." The env-var names go only to `console.warn`, never into the UI.
- **Password reset** (item 5, user's choices):
  - The email carries a 6-digit typeable code.
  - It's sent by Cloud Functions (Blaze plan) through Gmail SMTP with a Gmail app password (`nodemailer`).
  - A reset works for any account with that email. On a Google-only account it adds a password.
- **Reset rules** (defaults chosen):
  - Codes expire after 15 minutes, and a new request replaces the previous code.
  - Codes can be resent after 60 seconds, at most 5 sends per email per rolling hour.
  - 5 wrong guesses delete the code.
  - The new password needs at least 6 characters (same as register).
  - On success, the server revokes the account's refresh tokens (signing out other devices). The app then signs in with the new password and goes to `/`.
- **No account enumeration**: requesting a reset for an email with no account returns the same success as a real one and sends nothing. Confirming with no stored code fails as "invalid code".
- **Reset storage**: Firestore `passwordResets/{sha256(normalized email)}`, written only by the functions. The code is stored as a hash, never in plain text. `firestore.rules` stays unchanged, since it already denies this collection to clients.
- **Error contract** between the functions and the app: failures are `HttpsError`s carrying `details.reason`, one of:
  - `invalid-email`, `cooldown` (with `details.retryAfterSeconds`), `too-many-requests`
  - `invalid-code`, `expired`, `too-many-attempts`, `weak-password`
- **Login's "Forgot password?"** becomes a link to `/forgot-password?email=<current email field>`. `sendPasswordResetEmail` and `window.prompt` go away.
- **Cleanup** (item 7): one task at the end reviews the whole project for unused code and removes it, including `hooks/useAuth.ts`.
- **Hide-to-tray hint** (review item 8): not wanted.

## Out of scope

- **Phone numbers and SMS reset.** This is planned for a later spec. The user wants an optional phone number both on sign-up and on a new account settings screen. It needs the Blaze plan and an early task proving Firebase's reCAPTCHA works inside the Tauri window on macOS and Windows.
- An account settings screen.
- App Check, CAPTCHA or per-IP limits on reset requests.
- A way back from an open notebook to the picker.
- A hint that closing the window hides SkyLines to the tray.
- Deploying functions or changing Firebase console settings. Those are manual steps for the user.

## Tasks

### T1 An open notebook shows a real empty state

Status: todo
Depends on: none
Tester: yes. The empty state and the note it creates are observable in the DOM and the URL.

- Replace the placeholder branch in `app/page.tsx` (the `selectedNotebookId && selectedNotebook` case) with the empty state from Decisions, in the same centered layout style.
- Move the body of `newNote()` from `components/sidebar/Sidebar.tsx` into a shared hook, `hooks/useCreateNote.ts`, that returns the create function and a `creating` flag. Use it in both the sidebar and the empty state, so neither keeps its own copy.

Files: `app/page.tsx`, `components/sidebar/Sidebar.tsx`, new `hooks/useCreateNote.ts`

Acceptance:
- The strings "is open" and "coming in a later subtask" no longer appear in `app/page.tsx`.
- With a notebook open on `/`, the main area shows the notebook name, the hint line and a "New note" button.
- Clicking "New note" creates a canvas note in the open notebook (and selected folder, if any), placed after its siblings, and navigates to `/canvas?id=<new id>`. The button is disabled while creating.
- The sidebar's New note behaves as before and uses the same hook.

Test steps:
1. Signed in as `dev@skylines.local`. Save the current value of localStorage `skylines:lastOpen:<uid>`, then set it to `{"notebookId":"<an existing notebook id>","folderId":null,"noteId":null}` and reload the main window.
2. The top bar and sidebar are visible and the main area shows the notebook name, the hint and "New note". No placeholder text appears.
3. Click "New note". The URL becomes `/canvas?id=…` and the new note appears in the sidebar.
4. The sidebar's New note still creates and opens a note.
5. Delete both notes you created and restore the saved lastOpen value.

### T2 The account menu shows on the notebook picker

Status: todo
Depends on: none
Tester: yes. The menu and its contents are visible in the DOM. The tester must not click Sign out.

- In `components/shell/AppLayout.tsx`, when no notebook is selected and a user is signed in, render `AccountMenu` in a fixed top-right container alongside `children`. Keep the existing full layout unchanged when a notebook is selected.
- Check the comment in `AccountMenu` about where it mounts, and update it if it's no longer accurate.

Files: `components/shell/AppLayout.tsx`, possibly `components/topbar/AccountMenu.tsx` (comment only)

Acceptance:
- On the picker (signed in, no notebook selected), the account menu button is visible in the top-right corner. Opening it shows the signed-in email and a "Sign out" item.
- Public routes and pop-out windows (`/sticky`, `/image-editor`) don't render it, because `AppLayout` isn't used there.
- With a notebook open, there is exactly one account menu (the top bar's).

Test steps:
1. Signed in as `dev@skylines.local`. Save localStorage `skylines:lastOpen:<uid>`, remove it, and reload. The notebook picker shows.
2. The account menu button is in the top-right corner. Open it: it shows `dev@skylines.local` and a "Sign out" item. Don't click Sign out. Close the menu.
3. Open a notebook from the picker. Exactly one account menu exists (in the top bar).
4. Restore the saved lastOpen value and reload.

### T3 Sign-in and sign-up errors say what went wrong

Status: todo
Depends on: none
Tester: no. The new messages need a signed-out app, an offline network or rate limiting, which the tester can't create safely.

- Add `lib/auth/errors.ts` with `authErrorMessage(err: unknown, fallback: string): string`, mapping the codes listed in Decisions. Use `FirebaseError` from `firebase/app`.
- Use it in `handleEmail` on login (fallback "Sign-in failed. Please try again.") and in `handleSubmit` on register (fallback "Registration failed. Please try again."), replacing the hard-coded message and the `msg.includes` check.
- Keep the length and match checks on register as they are.

Files: new `lib/auth/errors.ts`, `app/login/page.tsx`, `app/register/page.tsx`

Acceptance:
- Login no longer shows "Invalid email or password." for network or rate-limit failures; each code in Decisions maps to its message.
- Register maps `email-already-in-use`, `invalid-email`, `weak-password`, network and rate-limit errors to their messages.
- Unmapped errors show the fallback and are logged with `console.error`.

Test steps (manual):
1. Signed out, turn off Wi-Fi and sign in. "Can't reach the sign-in service…" shows.
2. Sign in with a wrong password. "Invalid email or password." shows.
3. Sign up with an email that already has an account. The "already exists" message shows.

### T4 Google sign-in on sign-up, and a clear note when it isn't set up

Status: todo
Depends on: none
Tester: yes. Both pages render while signed in, so headings and button state can be checked without clicking Google.

- Move `handleGoogle` and its button from `app/login/page.tsx` into `components/auth/GoogleSignInButton.tsx`. Its props are `disabled`, `onBusyChange(busy)` and `onError(message)`. On success it does `router.replace("/")`, as today. Keep its comments about the system browser and the 5-minute limit.
- Use the component on login (unchanged behaviour) and on register, below the form, behind the same "or" divider markup as login.
- When `isGoogleSignInConfigured()` is false, render the button disabled, with the muted note from Decisions, and `console.warn` the missing env-var names once.
- Change the login heading and subtitle as in Decisions.

Files: new `components/auth/GoogleSignInButton.tsx`, `app/login/page.tsx`, `app/register/page.tsx`

Acceptance:
- Login and register both show "Continue with Google". Only one copy of the Google flow exists in the codebase.
- While Google sign-in runs, the other buttons on that page are disabled and the button reads "Waiting for browser…", as login does today.
- Unconfigured builds show the disabled button and "Google sign-in isn't set up in this build.". No UI text mentions env-var names.
- The login heading is "Sign in to Skylines". "Welcome back" no longer appears.

Test steps:
1. Navigate the main window to `/login`. The heading is "Sign in to Skylines" and "Continue with Google" is enabled (`.env.local` has both Google vars). Don't click it.
2. Navigate to `/register`. An "or" divider and an enabled "Continue with Google" button show below the form.
3. Navigate back to `/`.
4. Manual: from sign-up, Continue with Google with a new Google account creates the account and lands on `/`.

### T5 Server side of the 6-digit password reset

Status: todo
Depends on: none
Tester: no. Nothing runs until the user deploys the functions.

- **Package.** Create a `functions/` package in TypeScript:
  - Dependencies: `firebase-functions` (v2 API), `firebase-admin`, `nodemailer` and `@types/nodemailer`.
  - `engines.node` is a runtime Cloud Functions supports (22), and the build outputs to `functions/lib`.
- **Firebase config.** Add a `functions` entry to `firebase.json` (`source: "functions"`, with a predeploy build).
- **Git and type checking.** Add `functions/lib` and `functions/node_modules` to `.gitignore`. Exclude `functions` from the root `tsconfig.json`, so `npx tsc --noEmit` and `npm run build` don't type-check it.
- **Pure helpers** in `functions/src/resetCode.ts`:
  - email normalization (trim and lowercase)
  - the doc id, `sha256(email)`
  - code generation with `crypto.randomInt`, zero-padded to 6 digits
  - code hashing
  - the cooldown and hourly-limit decision

  Add a small `node:test` file for them, run by `npm test` in `functions/`.
- **Callables** in `functions/src/index.ts`, built with `onCall` and secrets `defineSecret("GMAIL_USER")` and `defineSecret("GMAIL_APP_PASSWORD")`:
  - `requestPasswordReset({ email })`
    - Validates the email (`invalid-email`).
    - Applies the cooldown and hourly limit (`cooldown` with `retryAfterSeconds`, or `too-many-requests`).
    - Looks up the user with `getAuth().getUserByEmail`. With no user, it returns `{ ok: true }` without sending.
    - Otherwise it stores the hashed code, expiry, attempt count and send times in `passwordResets/{docId}`, then emails the code through nodemailer with Gmail SMTP. The subject is "Your Skylines password reset code", and the body gives the code, says it expires in 15 minutes, and says to ignore the email if the user didn't ask for it.
  - `confirmPasswordReset({ email, code, newPassword })`
    - Runs in a Firestore transaction.
    - A missing doc gives `invalid-code`. A past expiry gives `expired`.
    - A wrong code increments the attempts and gives `invalid-code`, or deletes the doc and gives `too-many-attempts` at 5.
    - A password shorter than 6 characters gives `weak-password`.
    - On success it runs `updateUser(uid, { password })` and `revokeRefreshTokens(uid)`, deletes the doc and returns `{ ok: true }`.
  - All errors are `HttpsError` with `details.reason`, as in Decisions.
- **Docs.** Add a "Password reset email" section to `README.md` with the manual setup:
  1. Upgrade the project to Blaze.
  2. Create a Gmail app password (needs 2-Step Verification).
  3. Run `npx firebase-tools login`.
  4. Set both secrets with `npx firebase-tools functions:secrets:set …`.
  5. Deploy with `npx firebase-tools deploy --only functions --project <project id>`.
- **CLAUDE.md.** Add `(cd functions && npm run build && npm test)` to `## Verification`. Add a Gotcha that functions are deployed manually by the user and that agents must never deploy.

Files: new `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`, `functions/src/resetCode.ts`, `functions/src/resetCode.test.ts`; `firebase.json`, `.gitignore`, `tsconfig.json`, `README.md`, `CLAUDE.md`

Acceptance:
- `(cd functions && npm install && npm run build && npm test)` exits 0, and the root verification commands still pass.
- The code is never stored or logged in plain text. A new request replaces the old code. The expiry, cooldown, hourly-limit and attempt rules match Decisions.
- A reset request for an unknown email returns `{ ok: true }` and sends nothing. Confirming with no stored code returns `invalid-code`.
- `firestore.rules` is unchanged.
- The README lists every manual setup step, and nothing in the task runs `firebase login` or a deploy.

Test steps (manual, after the user deploys):
1. Request a reset for your real email. An email with a 6-digit code arrives.
2. Request again within 60 seconds. The call fails with reason `cooldown`.

### T6 Forgot-password screens in the app

Status: todo
Depends on: T3, T5
Tester: yes. The screens, validation and the unknown-email path are observable. Reading a real code from an inbox is manual.

- Export `functions = getFunctions(app)` from `lib/firebase.ts`. Add `/forgot-password` to `PUBLIC_ROUTES` in `components/AppShell.tsx`.
- New `app/forgot-password/page.tsx`, in the same card layout as login:
  - **Step 1, "Reset your password".** An email field (prefilled from `?email=`), a "Send code" button and a "Back to sign in" link. It calls `requestPasswordReset` through `httpsCallable`.
  - **Step 2.** The line "If an account exists for <email>, we've emailed a 6-digit code. It expires in 15 minutes." Then:
    - A code field (`inputMode="numeric"`, `autoComplete="one-time-code"`, keeps digits only, max 6, so a pasted "123 456" works).
    - "New password" and "Confirm password" `PasswordInput`s (`new-password`), checked like register: length first, then match.
    - A "Reset password" button.
    - "Resend code", disabled with a "Resend code in Ns" countdown for 60 seconds after each send, or for `retryAfterSeconds` on `cooldown`.
    - "Use a different email" (back to step 1).
- **On success**, run `signInWithEmailAndPassword` with the new password, then `router.replace("/")`. If that sign-in fails, go to `/login`.
- **Error messages by reason:**
  - `invalid-code`: "That code isn't right."
  - `expired`: "That code has expired. Send a new one."
  - `too-many-attempts`: "Too many wrong codes. Send a new one."
  - `cooldown`: wait message using the seconds
  - `too-many-requests`: "Too many codes requested. Try again in an hour."
  - `invalid-email`: "That email address doesn't look right."
  - `weak-password`: "Password must be at least 6 characters."
  - Anything else, including the functions not being deployed: "Couldn't reach the password reset service. Try again later." Use `authErrorMessage` for network errors.
- **In `app/login/page.tsx`**, replace the "Forgot password?" button with the link from Decisions, and remove `handleForgotPassword`, `resetMessage`, `resetLoading`, `sendPasswordResetEmail` and `window.prompt`.

Files: new `app/forgot-password/page.tsx`, `lib/firebase.ts`, `components/AppShell.tsx`, `app/login/page.tsx`

Acceptance:
- "Forgot password?" on login opens `/forgot-password` with the typed email prefilled. The page works signed out.
- Step 2 can't submit with a code that isn't 6 digits, a short password or mismatched passwords, and these checks make no server call.
- Resend is disabled during its countdown and re-enables afterwards.
- A successful reset signs the user in with the new password and lands on `/`.
- `app/login/page.tsx` no longer references `sendPasswordResetEmail` or `window.prompt`.

Test steps:
1. Navigate the main window to `/login`, type `nobody-reset-test@example.com` and click "Forgot password?". `/forgot-password` shows with that email filled in.
2. Click "Send code".
   - If the functions are deployed, step 2 shows the "If an account exists…" line and Resend shows a countdown.
   - If they aren't deployed, "Couldn't reach the password reset service…" shows. Stop here and report it.
3. Type `12a3` in the code field. Only `123` remains. Enter `123456`, password `abcdef` and confirm `abcdeg`, then submit. "Passwords don't match." shows and no request is sent.
4. Make both passwords `abcdef` and submit. "That code isn't right." shows (no code exists for that email).
5. "Use a different email" returns to step 1. Navigate back to `/`.
6. Manual: signed out, reset your real account's password with the emailed code. You end up signed in on `/`, and the new password works on login.

### T7 Remove code nothing uses

Status: todo
Depends on: T1, T2, T3, T4, T5, T6
Tester: yes, as a smoke test. The app still starts, opens notebooks, notes and sticky notes, and the sign-in pages render.

- **What to look for.** Review the whole project (`app/`, `components/`, `lib/`, `hooks/`, `stores/`, `types/`, `src-tauri/`, `functions/`) for code nothing uses, and remove it:
  - unused files, exports, components and hooks (known: `hooks/useAuth.ts`, a duplicate of `AuthProvider`)
  - npm and Cargo dependencies nothing imports
  - Tauri plugins and capability permissions nothing calls
  - commented-out code
- **Deep-link plugin.** The `skylines://` deep-link plugin is believed unused (`@tauri-apps/plugin-deep-link`, `tauri-plugin-deep-link`, its `tauri.conf.json` config). Remove it only after confirming nothing reads deep links, including features of `tauri-plugin-single-instance`.
- **Tools.** One-off tools such as `npx knip` are fine; don't add them to `package.json`.
- **Never remove:**
  - existing SQL migrations
  - capability files for window labels
  - Tauri commands invoked by string from the frontend
  - `scripts/`
  - `DevLogin`
  - anything reached only through dynamic strings
- **Handover.** List every removal with its reason.

Files: across the project; lockfiles update with dependency removals

Acceptance:
- `hooks/useAuth.ts` is gone, and every removed item is listed in the handover with why it was unused.
- All verification commands, including the functions build and test, pass.
- No user-visible behaviour changes.

Test steps:
1. Reload the main window. The app starts signed in as `dev@skylines.local`, and opening a notebook and a note works.
2. Open an existing sticky note window and close it again.
3. Navigate to `/login`, `/register` and `/forgot-password`. Each renders. Navigate back to `/`.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
