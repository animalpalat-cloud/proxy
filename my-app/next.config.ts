import type { NextConfig } from "next";

const backend =
  process.env.BACKEND_URL?.trim() ||
  (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000" : "");

if (!backend && process.env.NODE_ENV === "production") {
  throw new Error(
    "BACKEND_URL is required for production builds (internal Express URL, e.g. http://127.0.0.1:8000).",
  );
}

// /api/proxy uses app route handler (long timeout). Other /api routes use rewrites.
const nextConfig: NextConfig = {
  experimental: {
    proxyTimeout: Number(process.env.API_PROXY_TIMEOUT_MS) || 300_000,
  },
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
