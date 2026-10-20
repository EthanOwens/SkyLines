#!/usr/bin/env bash
# Sets up a macOS machine to build SkyLines. Safe to re-run.
set -euo pipefail
trap 'echo "Setup stopped: the step above failed. Fix it and re-run scripts/setup.sh." >&2' ERR

cd "$(dirname "$0")/.."

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  read -r -p "Finish the Xcode Command Line Tools install, then press Enter. " _
  xcode-select -p >/dev/null 2>&1 || { echo "Xcode Command Line Tools are still missing." >&2; exit 1; }
fi

if ! command -v cargo >/dev/null 2>&1; then
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    :
  else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  fi
fi
export PATH="$HOME/.cargo/bin:$PATH"

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]
}
if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    brew install node@24
    brew link --overwrite --force node@24
    export PATH="$(brew --prefix node@24)/bin:$PATH"
  else
    echo "Node 24 or newer is required and Homebrew is not installed. Install Node from https://nodejs.org, then re-run." >&2
    exit 1
  fi
fi
node_ok || { echo "Node 24 or newer is still not on PATH. Open a new terminal and re-run." >&2; exit 1; }

npm ci

if [ ! -f .env.local ]; then
  echo "Missing .env.local in the repo root. Ask the person who shared SkyLines with you for it, and put it next to package.json." >&2
fi

npx tauri info
echo "Setup done. Run: npm run tauri dev"
