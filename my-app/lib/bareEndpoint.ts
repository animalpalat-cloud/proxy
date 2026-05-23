/**
 * Bare server URL seen by the browser (bare-mux / Ultraviolet).
 * Always same-origin `/bare/` in production (Nginx → Rust :8000).
 * Never hard-code localhost — use the page's actual origin.
 */
export function getBareServerUrl(): string {
  if (typeof window === "undefined") {
    return "/bare/";
  }

  const fromEnv = process.env.NEXT_PUBLIC_BARE_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv, window.location.origin).href;
    } catch {
      // fall through
    }
  }

  return new URL("/bare/", window.location.origin).href;
}

export function getBareMuxWorkerUrl(): string {
  return new URL("/baremux/worker.js", window.location.origin).href;
}

export function getBareClientModuleUrl(): string {
  return new URL("/baremux/bare-client.mjs", window.location.origin).href;
}
