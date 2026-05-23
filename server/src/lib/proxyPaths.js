/**
 * Path-based proxy URLs (Ultraviolet-style prefix) so root-relative /s/... assets resolve correctly.
 */

function proxySitePrefix(sessionId) {
  const id = String(sessionId || "").replace(/\/+$/, "");
  return `/api/proxy/site/${id}`;
}

/**
 * Build browser URL for a path on the upstream origin (leading slash required).
 * @param {string} gatewayOrigin
 * @param {string} sessionId
 * @param {string} pathname - e.g. "/s/player/foo.js"
 * @param {string} [search]
 */
function buildSiteProxyUrl(gatewayOrigin, sessionId, pathname, search = "") {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const base = (gatewayOrigin || "").replace(/\/$/, "");
  return `${base}${proxySitePrefix(sessionId)}${path}${search || ""}`;
}

/**
 * Resolve Express site path + query to absolute upstream URL.
 * @param {string} targetUrl - session entry URL
 * @param {string} sitePath - path after /site/:sessionId
 * @param {Record<string, string>} query - req.query without session
 */
function resolveSiteTargetUrl(targetUrl, sitePath, query = {}) {
  const base = new URL(targetUrl);
  const path = sitePath ? (sitePath.startsWith("/") ? sitePath : `/${sitePath}`) : base.pathname;
  const u = new URL(path, base.origin);
  for (const [k, v] of Object.entries(query)) {
    if (k === "session" || v == null) continue;
    if (Array.isArray(v)) v.forEach((item) => u.searchParams.append(k, String(item)));
    else u.searchParams.set(k, String(v));
  }
  if (!sitePath && base.search) {
    u.search = base.search;
  }
  return u.href;
}

module.exports = {
  proxySitePrefix,
  buildSiteProxyUrl,
  resolveSiteTargetUrl,
};
