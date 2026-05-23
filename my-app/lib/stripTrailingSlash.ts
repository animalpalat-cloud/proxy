/** Canonical browser-facing Bare path (no trailing slash — avoids Next.js 308). */
export const BARE_PATH = "/bare";

/**
 * Remove trailing slashes from a URL or path string.
 * Bare manifest requests must use `/bare`, not `/bare/`.
 */
export function stripTrailingSlash(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.pathname = stripTrailingSlashPath(parsed.pathname);
    return parsed.href;
  } catch {
    return trimmed.replace(/\/+$/, "") || BARE_PATH;
  }
}

/**
 * Strip trailing slashes from a pathname only (e.g. `/bare/` → `/bare`).
 */
export function stripTrailingSlashPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return BARE_PATH;
  }
  return normalized;
}

/**
 * Map a public /bare request path to the Rust upstream path (internal only — not a browser redirect).
 */
export function toRustBareUpstreamPath(pathname: string): string {
  const base = stripTrailingSlashPath(pathname);
  if (base === BARE_PATH) {
    return "/bare/";
  }
  return pathname;
}

/** True for `/bare` and `/bare/...` API subpaths. */
export function isBarePublicPath(pathname: string): boolean {
  return pathname === BARE_PATH || pathname.startsWith(`${BARE_PATH}/`);
}
