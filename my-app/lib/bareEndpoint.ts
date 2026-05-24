/**
 * Bare server URL for bare-mux / Ultraviolet.
 *
 * Strictly relative: always `/bare` (no host, no protocol). Next.js middleware
 * proxies /bare → http://127.0.0.1:8000 server-side. There is intentionally no
 * `NEXT_PUBLIC_BARE_URL` override — pointing the client at a public hostname
 * (e.g. `https://daddyproxy.com/bare`) re-introduces the cross-origin /
 * trailing-slash / redirect issues we just fought through.
 */

import {
  BARE_PATH,
  stripTrailingSlash,
} from "./stripTrailingSlash";

export { BARE_PATH };

export function getBareServerUrl(): string {
  if (typeof window === "undefined") {
    return BARE_PATH;
  }
  return stripTrailingSlash(new URL(BARE_PATH, window.location.origin).href);
}

function appendBuildId(url: string): string {
  const buildId = process.env.NEXT_PUBLIC_BARE_BUILD_ID?.trim();
  if (!buildId) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("v", buildId);
  return parsed.href;
}

/**
 * Site root — outside UV scope (/uv/service/).
 * Includes ?v=<buildId> so each deploy gets a fresh SharedWorker
 * (avoids reusing a broken SharedWorker named "bare-mux-worker" from a previous deploy).
 */
export function getBareMuxWorkerUrl(): string {
  return appendBuildId(
    stripTrailingSlash(new URL("/baremux-worker.js", window.location.origin).href),
  );
}

/** Fallback path if /baremux-worker.js is missing (npm run copy-static not run). */
export function getBareMuxWorkerFallbackUrl(): string {
  return appendBuildId(
    stripTrailingSlash(new URL("/baremux/worker.js", window.location.origin).href),
  );
}

export function getBareClientModuleUrl(): string {
  return stripTrailingSlash(new URL("/baremux/bare-client.mjs", window.location.origin).href);
}
