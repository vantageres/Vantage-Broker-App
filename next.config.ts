import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Readable stack traces for screen crashes during the pilot.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
