import path from "node:path";
import type { NextConfig } from "next";

// Tauri loads the frontend from a static export bundled into the app,
// so Next.js must produce static HTML/JS instead of running a Node server.
const nextConfig: NextConfig = {
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
