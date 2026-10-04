import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Customer-facing estimate pages and their endpoints are never cached or indexed (spec §7.4).
    const publicHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex" },
    ];
    return [
      { source: "/e/:path*", headers: publicHeaders },
      { source: "/api/public/:path*", headers: publicHeaders },
    ];
  },
};

export default nextConfig;
