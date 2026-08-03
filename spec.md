# Skylines — Login page dev/auth conveniences

## Goal

Add two small login-page features requested in `planning.md`: a real
"forgot password" flow (Firebase's standard emailed reset link, not a
passwordless bypass), and a "dev login" button that signs into (or
auto-creates) a fixed personal testing account, separate from real user
accounts.

## Non-Goals

- **No passwordless/email-free password reset.** `planning.md` originally
  asked for a reset that skips email confirmation entirely. That's only
  possible via the Firebase Admin SDK (a privileged, server-side
  credential) — discussed with the user, who chose the standard
  `sendPasswordResetEmail`/Firebase-hosted reset page flow instead. No
  Admin SDK, no service-account key management, no custom in-app password
  reset UI.
- **No custom in-app reset-confirmation screen or deep-link handling for
  password reset.** Firebase's default hosted action page (opened in the
  system browser from the emailed link) handles the "set a new password"
  step — this is not the same deep-link callback pattern
  `lib/auth/googleOAuth.ts` uses for Google sign-in, and does not need to
  be replicated here.
- **No fix for the Google sign-in bug.** Blocked on the user creating a
  "Desktop app" OAuth client in Google Cloud Console and setting
  `NEXT_PUBLIC_GOOGLE_DESKTOP_OAUTH_CLIENT_ID` — not code work, explicitly
  left out of this spec per the user's choice. The app already shows a
  clear "not configured" error for this case; that behavior is untouched.
- **No production/dev-build gating on the dev-login button.** It's always
  visible on `/login`, per the user's chosen simplicity — not hidden behind
  an env flag or build-mode check.
- **Don't touch** the existing Google-OAuth deep-link flow, the
  notebook/ribbon/theme work from the prior spec, or `../note_taking_app`.

## Subtasks

1. **Forgot password.** Add a "Forgot password?" link/button to
   `app/login/page.tsx`. Clicking it takes the email already typed into the
   form's email field (or prompts for one if empty) and calls Firebase's
   `sendPasswordResetEmail(auth, email)`. Show a clear success message
   ("check your email for a reset link") or a clear error if it fails
   (e.g. `auth/user-not-found` — still show a generic-enough message to
   avoid trivially confirming/denying account existence, matching the
   existing login form's error-handling style). No new route, no custom
   confirmation page — the emailed link opens Firebase's own hosted
   password-reset page in the system browser.
2. **Dev login button.** Add a visually-distinct "Dev Login" button to
   `app/login/page.tsx` (separated from the real sign-in form, e.g. below a
   divider) that signs into a fixed, hardcoded dev account — credentials
   defined as constants directly in the page source, matching the existing
   `TEST_EMAIL`/`TEST_PASSWORD` pattern already used throughout this
   project's `app/spike-*/page.tsx` verification routes. On click: attempt
   `signInWithEmailAndPassword`; if it fails because the account doesn't
   exist yet, fall back to `createUserWithEmailAndPassword` so the button
   is self-bootstrapping on first use, then proceed as a normal successful
   sign-in (same post-login redirect as the real form).

## Key Decisions

- **Password reset uses Firebase's standard emailed-link flow**, not an
  Admin-SDK-backed passwordless bypass — avoids bundling a privileged
  service-account credential into a shipped desktop app, at the cost of
  requiring an actual email round-trip. Decided with the user directly.
- **No custom reset-confirmation UI** — Firebase's default hosted action
  page is sufficient and avoids replicating the deep-link callback
  machinery already built for Google OAuth for a feature that doesn't need
  it.
- **Dev-login credentials are hardcoded in source**, not read from
  `.env.local` — matches this project's existing spike-route convention
  (committed test credentials for a throwaway, no-real-data-value account),
  and avoids the button silently failing on a fresh clone with no local env
  file configured.
- **Dev-login auto-creates the account on first use** rather than requiring
  the user to manually register it first — makes the button work
  out-of-the-box, consistent with "personal login testing grounds" framing.
- **Google sign-in bug excluded from this spec** — purely a manual
  Google Cloud Console configuration step blocked on the user, not
  implementation work; tracked separately, outside `/dev-loop`.

## Open Questions

- Exact dev-login account email/password values are left to the
  implementor to choose sensibly (e.g. `dev@skylines.local` / a fixed
  placeholder password) unless the user has a specific preference — not
  security-sensitive since this is a self-bootstrapping throwaway account.
- Whether the "Forgot password?" affordance should be a plain link or a
  button, and its exact placement in the existing login form layout, is
  left to the implementor's visual judgment, following the form's existing
  shadcn/Tailwind styling conventions.

## Progress
