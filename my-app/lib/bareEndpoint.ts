/**
 * Bare server URL for bare-mux / Ultraviolet (browser, same-origin).
 *
 * Use `/bare` without a trailing slash — Next.js 308-redirects `/bare/` → `/bare`,
 * which breaks bare-mux setTransport (POST / manifest handshake).
 *
 * bare-client.mjs is patched (copy-static) to fetch the manifest at `/bare` while
 * resolving API paths under `/bare/v3/`.
 */

/** Canonical pathname (no trailing slash — matches Next/nginx without 308). */
export const BARE_PATH = "/bare";

function normalizeBareHref(href: string): string {
  const url = new URL(href);
  url.pathname = url.pathname.replace(/\/+$/, "") || BARE_PATH;
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
