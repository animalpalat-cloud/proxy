/**
 * Public API base URL resolution — no hardcoded hosts.
 *
 * Priority:
 * 1. NEXT_PUBLIC_API_URL (explicit public API origin)
 * 2. Browser same-origin (Nginx routes /api → Express)
 * 3. Relative paths for SSR / rewrites
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Explicit API origin from env, or empty to use same-origin / relative paths. */
export function getPublicApiOrigin(): string {
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL?.trim()
      : "";
  if (fromEnv) return stripTrailingSlash(fromEnv);

  if (typeof window !== "undefined") {
    return stripTrailingSlash(window.location.origin);
  }

  return "";
}

export function getUnblockPostUrl(): string {
  const base = getPublicApiOrigin();
  return base ? `${base}/api/unblock` : "/api/unblock";
}

/**
 * Force viewer / resource links to hit the public API host (new tab).
 */
export function normalizeViewerUrlForNewTab(href: string): string {
  const backend = getPublicApiOrigin();
  if (!backend) {
    try {
      const u = new URL(href, typeof window !== "undefined" ? window.location.origin : undefined);
      return u.href;
    } catch {
      return href.startsWith("/") ? href : `/${href}`;
    }
  }

  try {
    const u = new URL(href, `${backend}/`);
    if (!u.pathname.includes("/api/proxy/")) {
      return u.href;
    }
    return `${backend}${u.pathname}${u.search}${u.hash}`;
  } catch {
    const path = href.startsWith("/") ? href : `/${href}`;
    return `${backend}${path}`;
  }
}

export function deriveViewerUrlFromSession(sessionId: string): string {
  const id = sessionId.trim();
  if (!id) return "";
  const qp = `session=${encodeURIComponent(id)}`;
  const backend = getPublicApiOrigin();
  if (backend) {
    return `${backend}/api/proxy/stream-or-view?${qp}`;
  }
  return `/api/proxy/stream-or-view?${qp}`;
}
