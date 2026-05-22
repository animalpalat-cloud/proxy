import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL?.trim();

if (!backend && process.env.NODE_ENV === "production") {
  throw new Error(
    "BACKEND_URL is required for production builds (internal Express URL, e.g. http://127.0.0.1:8000).",
  );
}

const nextConfig: NextConfig = {
  /**
   * Rewrites /api/* to Express. BACKEND_URL is server-side only (not exposed to the browser).
   */
  async rewrites() {
    if (!backend) {
      return [];
    }
    const origin = backend.replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${origin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
