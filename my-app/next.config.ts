import type { NextConfig } from "next";

/** Same-host Rust Bare — used for rewrites when /bare hits Next (fallback if Nginx is misconfigured). */
const rustBare = process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000";

/** Strip at build time so a mis-set .env.production cannot bake in `/bare/`. */
const publicBareUrl = process.env.NEXT_PUBLIC_BARE_URL?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Must match bare-mux URL: /bare (no trailing slash). Next 308s /bare/ → /bare otherwise.
  trailingSlash: false,
  skipTrailingSlashRedirect: true,

  ...(publicBareUrl
    ? {
        env: {
          NEXT_PUBLIC_BARE_URL: publicBareUrl,
        },
      }
    : {}),

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
    const origin = rustBare.replace(/\/$/, "");
    return [
      {
        source: "/bare/:path*",
        destination: `${origin}/bare/:path*`,
      },
      {
        source: "/bare",
        destination: `${origin}/bare/`,
      },
    ];
  },
};

export default nextConfig;
