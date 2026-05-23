import type { NextConfig } from "next";

/** Same-host Rust Bare — used for rewrites when /bare hits Next (fallback if Nginx is misconfigured). */
const rustBare = process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // bare-client needs /bare/ (trailing slash). Default Next behavior 308s /bare/ → /bare.
  skipTrailingSlashRedirect: true,

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
      // Exact manifest URL (no 308) — Rust serves GET /bare/
      {
        source: "/bare",
        destination: `${origin}/bare/`,
      },
      {
        source: "/bare/",
        destination: `${origin}/bare/`,
      },
      {
        source: "/bare/:path*",
        destination: `${origin}/bare/:path*`,
      },
    ];
  },
};

export default nextConfig;
