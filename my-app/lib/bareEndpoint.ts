/**
 * Bare server URL for bare-mux / Ultraviolet (browser, same-origin).
 * Always use `/bare` without a trailing slash to avoid Next.js 308 redirects.
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

  const fromEnv = process.env.NEXT_PUBLIC_BARE_URL?.trim();
  if (fromEnv) {
    try {
      return stripTrailingSlash(new URL(fromEnv, window.location.origin).href);
    } catch {
      // fall through
    }
  }

  return stripTrailingSlash(new URL(BARE_PATH, window.location.origin).href);
}

/** Site root — outside UV scope (/uv/service/). */
export function getBareMuxWorkerUrl(): string {
  return stripTrailingSlash(new URL("/baremux-worker.js", window.location.origin).href);
}

export function getBareClientModuleUrl(): string {
  return stripTrailingSlash(new URL("/baremux/bare-client.mjs", window.location.origin).href);
}
