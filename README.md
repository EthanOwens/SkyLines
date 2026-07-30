# Skylines

Local-first note-taking app (Tauri v2 + Next.js). SQLite is the local source of truth; Firebase Firestore syncs in the background.

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
- `src-tauri\target\release\bundle\nsis\Skylines_0.1.0_x64-setup.exe`, or
- `src-tauri\target\release\bundle\msi\Skylines_0.1.0_x64_en-US.msi`

(or run `src-tauri\target\release\skylines.exe` directly, no install needed)

**Updating a permanent install**: bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, rebuild, run the new installer — it upgrades in place.

## Android

Requires the Android SDK/NDK and an emulator or device — see [SPEC_iter1.md](../note_taking_app/SPEC_iter1.md) for the architecture background.

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

## Notes

- No app shell exists yet — after sign-in, `/login` and `/register` redirect to `/home`, which hasn't been built. Use `/note?id=...`, `/canvas?id=...`, or the `/spike-*` verification routes to exercise real functionality directly.
- Google sign-in needs a manually-created "Desktop app" OAuth client in Google Cloud Console first — see `lib/auth/googleOAuth.ts`. Email/password sign-in works as-is.
