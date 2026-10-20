# Skylines

Local-first note-taking app (Tauri v2 + Next.js). SQLite is the local source of truth; Firebase Firestore syncs in the background.

## Getting started

1. **Install the tools.** On macOS run `bash scripts/setup.sh`; on Windows run `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` (both install what is missing, run `npm ci` and print `npx tauri info`). To install by hand you need: Node 24 or newer, Rust 1.99 (via [rustup](https://rustup.rs)), and either the Xcode Command Line Tools (macOS) or Visual Studio 2022 Build Tools with the C++ workload (Windows).
2. **Clone** the repo and `cd` into it. If you used the manual route, run `npm ci`.
3. **Get `.env.local`** from the person who shared SkyLines with you (see `.env.local.example` for its shape) and put it in the repo root, next to `package.json`. The values are baked in at build time, so rebuild after changing it.
4. **Try it:** `npm run tauri dev` (hot reload).
5. **Install it:** `npm run tauri build`, then install the result (macOS: the `.dmg` in `src-tauri/target/release/bundle/dmg/`; Windows: see below). Building it yourself avoids the "unidentified developer" (macOS) and SmartScreen (Windows) warnings that downloaded builds trigger.
6. **Sign up** with email and password on the login screen. Your notes sync only to your account.
7. **Update:** `git pull`, re-run `npm ci`, then `npm run tauri build` and install the new build over the old one.

### Logs and bug reports

Logs are written by every window to `Skylines.log` in:

- macOS: `~/Library/Logs/com.skylines.app/`
- Windows: `%LOCALAPPDATA%\com.skylines.app\logs\`

When something goes wrong, open the account menu (top bar) and click "Copy bug report". It copies the app version, commit, sync status and recent logs; paste it into a message. "Open logs folder" opens the folder above.

### Known limits

- Pictures stay on the computer they were added to; they do not sync.
- Pinned is per computer.
- Update every computer before editing on any of them, since an older build may not understand newer synced data.


## macOS

**Dev/test** (hot reload): `npm run tauri dev`

**Permanent install**: `npm run tauri build`, then open `src-tauri/target/release/bundle/dmg/Skylines_<version>_aarch64.dmg` (the suffix is `x64` on Intel Macs) and drag Skylines to Applications, or copy `src-tauri/target/release/bundle/macos/Skylines.app` there.

If linking fails on a machine with a beta SDK installed, set `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk`.

**Updating**: see "Getting started" step 7.

## Windows

**Dev/test** (hot reload):
```
npm run tauri dev
```

**Permanent install** (clickable icon, Start Menu, uninstaller):
```
npm run tauri build
```
Run the resulting installer:
- `src-tauri\target\release\bundle\nsis\Skylines_<version>_x64-setup.exe`, or
- `src-tauri\target\release\bundle\msi\Skylines_<version>_x64_en-US.msi`

(or run `src-tauri\target\release\skylines.exe` directly, no install needed)

**Updating**: see "Getting started" step 7. The new installer upgrades in place.

## Android

Requires the Android SDK/NDK and an emulator or device.

**Dev/test**:
```
npm run tauri android dev -- --host
```
Known issue: live-reload doesn't hydrate on Android (a Tauri bug, not an app bug). If buttons don't respond, use the build below instead.

**Permanent install** (clickable icon on device):
```
npm run tauri android build -- --apk -t x86_64
adb install -r <path-to-apk>
```
The release build needs a real signing keystore before it will install (the debug keystore was deliberately removed for security — see `src-tauri/gen/android/app/build.gradle.kts`). Generate one with `keytool -genkey -v -keystore skylines-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias skylines` and wire it into that file's `release` signing config before building.

**Updating a permanent install**: install a newer APK signed with the *same* keystore over the old one (`adb install -r`).

## Maintainers

Google sign-in needs a manually-created "Desktop app" OAuth client in Google Cloud Console first (see `lib/auth/googleOAuth.ts`); email/password sign-in works as-is.

### Deploying Firestore rules

`firestore.rules` locks each document to the account in its `userId` field. Deploy it with:

```
npx firebase-tools deploy --only firestore:rules --project <NEXT_PUBLIC_FIREBASE_PROJECT_ID>
```

Before the first deploy, compare it with the rules currently in the Firebase console so you don't overwrite anything you need.

### Releasing

`npm version patch|minor|major` bumps `package.json` (the Tauri version follows it), commits and tags. `minor` from 0.9 gives 0.10.0, so use `major` or `npm version 1.0.0` to reach 1.0.0.
