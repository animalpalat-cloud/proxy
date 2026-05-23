/**
 * Bare server URL for bare-mux / Ultraviolet (browser, same-origin).
 *
 * Must end with `/` — @tomphttp/bare-client resolves `./v2/` and `./v3/` relative to
 * that base. Without a trailing slash, paths become `/v3/` instead of `/bare/v3/`.
 *
 * Production: Nginx `location /bare/` → Rust :8000 (preferred).
 * Dev / single-host: Next `rewrites` when RUST_BARE_URL is set.
 */

/** Canonical pathname (trailing slash required by bare-client). */
export const BARE_PATH = "/bare/";

function normalizeBareHref(href: string): string {
  const url = new URL(href);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.href;
}

export function getBareServerUrl(): string {
  if (typeof window === "undefined") {
    return BARE_PATH;
  }

  const fromEnv = process.env.NEXT_PUBLIC_BARE_URL?.trim();
  if (fromEnv) {
    try {
      return normalizeBareHref(new URL(fromEnv, window.location.origin).href);
    } catch {
      // fall through
    }
  }

  return normalizeBareHref(new URL(BARE_PATH, window.location.origin).href);
}

/** Site root — outside UV scope (/uv/service/). */
export function getBareMuxWorkerUrl(): string {
  return new URL("/baremux-worker.js", window.location.origin).href;
}

export function getBareClientModuleUrl(): string {
  return new URL("/baremux/bare-client.mjs", window.location.origin).href;
}
