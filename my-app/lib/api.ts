/**
 * Public API URL resolution for browser + SSR.
 *
 * Production (Nginx): /api/ -> Express :8000, / -> Next :3000
 * Browser should call same-origin relative /api/... not localhost:8000.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isInternalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  );
}

/**
 * Origin used for absolute viewer/resource links in the browser.
 * Prefer same-origin when NEXT_PUBLIC_API_URL points at localhost (common VPS mistake).
 */
export function getPublicApiOrigin(): string {
  if (typeof window !== "undefined") {
    const browserOrigin = stripTrailingSlash(window.location.origin);
    const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (!fromEnv) return browserOrigin;

    try {
      const configured = new URL(fromEnv);
      if (isInternalHostname(configured.hostname)) {
        return browserOrigin;
      }
      return stripTrailingSlash(fromEnv);
    } catch {
      return browserOrigin;
    }
  }

  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);

  return "";
}

/**
 * POST target for /api/unblock.
 * In the browser always use a relative path so Nginx can route /api/ -> Express.
 */
export function getUnblockPostUrl(): string {
  if (typeof window !== "undefined") {
    return "/api/unblock";
  }

  const base = getPublicApiOrigin();
  return base ? `${base}/api/unblock` : "/api/unblock";
}

/**
 * Force viewer / resource links to hit the public gateway (new tab).
 */
export function normalizeViewerUrlForNewTab(href: string): string {
  const browserOrigin =
    typeof window !== "undefined" ? stripTrailingSlash(window.location.origin) : "";

  if (browserOrigin) {
    try {
      const u = new URL(href, browserOrigin);
      if (u.pathname.startsWith("/api/")) {
        return `${browserOrigin}${u.pathname}${u.search}${u.hash}`;
      }
      if (u.pathname.includes("/api/proxy/")) {
        return `${browserOrigin}${u.pathname}${u.search}${u.hash}`;
      }
      if (isInternalHostname(u.hostname)) {
        return `${browserOrigin}${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      if (href.startsWith("/api/")) {
        return `${browserOrigin}${href}`;
      }
    }
  }

  const backend = getPublicApiOrigin();
  if (!backend) {
    try {
      const u = new URL(href, browserOrigin || undefined);
      return u.href;
    } catch {
      return href.startsWith("/") ? href : `/${href}`;
    }
  }

  try {
    const u = new URL(href, `${backend}/`);
    if (!u.pathname.startsWith("/api/")) {
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
  const sitePath = `/api/proxy/site/${id}/`;

  if (typeof window !== "undefined") {
    return `${stripTrailingSlash(window.location.origin)}${sitePath}`;
  }

  const backend = getPublicApiOrigin();
  if (backend) {
    return `${backend}${sitePath}`;
  }
  return sitePath;
}
