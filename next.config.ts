import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Built into both browser and server code, so the server can tell when an
  // open page is running an older version (see src/lib/version.ts).
  env: { APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev" },
  async headers() {
    return [
      {
        // Browsers check for a new service worker on each visit; never serve a cached copy.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
