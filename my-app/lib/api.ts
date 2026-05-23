/**
 * Public API base URL resolution — no hardcoded hosts.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

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
 * Force viewer / resource links to hit the public gateway (new tab).
 */
export function normalizeViewerUrlForNewTab(href: string): string {
  const browserOrigin =
    typeof window !== "undefined" ? stripTrailingSlash(window.location.origin) : "";

  if (browserOrigin) {
    try {
      const u = new URL(href, browserOrigin);
      if (u.pathname.includes("/api/proxy/")) {
        return `${browserOrigin}${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      if (href.startsWith("/api/proxy/")) {
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
  const sitePath = `/api/proxy/site/${id}/`;
  const backend = getPublicApiOrigin();
  if (backend) {
    return `${backend}${sitePath}`;
  }
  return sitePath;
}
