/**
 * Strip restrictive upstream headers (CSP, XFO, COOP, HSTS, etc.) before sending to browser.
 * Pattern aligned with node-unblocker / Ultraviolet service-worker behavior.
 */

const STRIP_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-security-policy",
  "x-webkit-csp",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "permission-policy",
  "strict-transport-security",
  "public-key-pins",
  "public-key-pins-report-only",
  "x-xss-protection",
  "report-to",
  "nel",
  "origin-agent-cluster",
]);

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const STREAM_ALLOW = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "content-disposition",
]);

/**
 * @param {string} name
 */
function shouldStripResponseHeader(name) {
  const lower = name.toLowerCase();
  if (HOP_BY_HOP.has(lower)) return true;
  if (STRIP_RESPONSE_HEADERS.has(lower)) return true;
  if (lower.startsWith("content-security-policy")) return true;
  if (lower.startsWith("x-content-security-policy")) return true;
  return false;
}

/**
 * Copy safe upstream headers onto Express response.
 * @param {import('express').Response} res
 * @param {{ headers: { forEach: (fn: (v: string, k: string) => void) => void } }} upstream
 * @param {{ streaming?: boolean; skipSetCookie?: boolean }} [opts]
 */
function applySafeResponseHeaders(res, upstream, opts = {}) {
  const { streaming = false, skipSetCookie = true } = opts;

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (shouldStripResponseHeader(lower)) return;
    if (skipSetCookie && lower === "set-cookie") return;
    if (!streaming) {
      if (lower === "content-length" || lower === "content-encoding") return;
    } else if (!STREAM_ALLOW.has(lower)) {
      return;
    }
    try {
      res.setHeader(key, value);
    } catch {
      /* ignore invalid combinations */
    }
  });
}

module.exports = {
  STRIP_RESPONSE_HEADERS,
  shouldStripResponseHeader,
  applySafeResponseHeaders,
};
