import type { NextConfig } from "next";

const rustBare =
  process.env.RUST_BARE_URL?.trim() ||
  (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000" : "");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/uv/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/uv/uv.sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/uv/uv.bundle.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/uv/uv.config.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/baremux-worker.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/baremux/worker.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/baremux/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/uv/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
  async rewrites() {
    if (!rustBare) {
      return [];
    }
    const origin = rustBare.replace(/\/$/, "");
    return [
      {
        source: "/bare/:path*",
        destination: `${origin}/bare/:path*`,
      },
    ];
  },
};

export default nextConfig;
