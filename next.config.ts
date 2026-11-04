import path from "node:path";
import { execSync } from "node:child_process";
import pkg from "./package.json";
import type { NextConfig } from "next";

// Tauri loads the frontend from a static export bundled into the app,
// so Next.js must produce static HTML/JS instead of running a Node server.
function buildCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit(),
  },
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
