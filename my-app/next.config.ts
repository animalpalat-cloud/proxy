import type { NextConfig } from "next";

/** Same-host Rust Bare — used for rewrites when /bare hits Next (fallback if Nginx is misconfigured). */
const rustBare = process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // App routes: no trailing slash. bare-mux uses /bare (see bareEndpoint.ts).
  trailingSlash: false,
  // Still allow /bare/ if something requests it — middleware proxies before redirect.
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
    const origin = rustBare.replace(/\/$/, "");
    return [
      // Browser + bare-client use /bare (no slash). Proxy to Rust /bare/ internally.
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
