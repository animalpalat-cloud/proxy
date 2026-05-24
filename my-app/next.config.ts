import type { NextConfig } from "next";

/**
 * Architecture: Next.js (public, port 3000) reverse-proxies /bare/* to the
 * Rust bare server bound to 127.0.0.1:8000. Rust is intentionally NOT exposed
 * publicly. Everything bare-related on the frontend uses the strictly
 * relative `/bare` path — no public hostname.
 */
const rustBare = process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000";

/**
 * Build-time worker version stamp. Each deploy gets a fresh SharedWorker URL
 * (`/baremux-worker.js?v=<buildId>`), which avoids reusing a stale/broken
 * SharedWorker registered against the same name from a previous deploy.
 */
const buildId =
  process.env.NEXT_PUBLIC_BARE_BUILD_ID?.trim() || String(Date.now());

const nextConfig: NextConfig = {
  // Must match bare-mux URL: /bare (no trailing slash). Next 308s /bare/ → /bare otherwise.
  trailingSlash: false,
  skipTrailingSlashRedirect: true,

  env: {
    NEXT_PUBLIC_BARE_BUILD_ID: buildId,
  },

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
