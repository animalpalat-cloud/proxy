/**
 * Per-session cookie jar for upstream Set-Cookie → Cookie on proxied requests.
 */
const { parse: parseSetCookie } = require("set-cookie-parser");

/** @typedef {{ name: string; value: string; domain?: string; path?: string }} StoredCookie */

/**
 * Strip Domain / Partitioned / incompatible SameSite so cookies work via our gateway origin.
 * @param {string} raw
 */
function normalizeSetCookieHeader(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let c = raw;
  c = c.replace(/;\s*Domain=[^;]*/gi, "");
  c = c.replace(/;\s*Partitioned/gi, "");
  c = c.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
  if (!/;\s*Path=/i.test(c)) c += "; Path=/";
  return c;
}

/** @type {Map<string, Map<string, StoredCookie>>} sessionId → host → cookie */
const jars = new Map();

function jarKey(sessionId, hostname) {
  return `${sessionId}::${hostname}`;
}

/**
 * @param {string} sessionId
 * @param {string} requestUrl
 * @param {string[]} setCookieHeaders
 */
function absorbSetCookies(sessionId, requestUrl, setCookieHeaders) {
  if (!sessionId || !setCookieHeaders?.length) return;
  let host;
  try {
    host = new URL(requestUrl).hostname;
  } catch {
    return;
  }

  const normalized = setCookieHeaders.map(normalizeSetCookieHeader);
  const parsed = parseSetCookie(normalized, { decodeValues: true });
  let hostMap = jars.get(sessionId);
  if (!hostMap) {
    hostMap = new Map();
    jars.set(sessionId, hostMap);
  }

  for (const c of parsed) {
    if (!c.name) continue;
    const key = c.domain ? c.domain.replace(/^\./, "") : host;
    hostMap.set(`${key}|${c.name}`, {
      name: c.name,
      value: c.value ?? "",
      domain: c.domain,
      path: c.path || "/",
    });
  }
}

/**
 * @param {string} sessionId
 * @param {string} targetUrl
 * @returns {string}
 */
function getUpstreamCookieHeader(sessionId, targetUrl) {
  const hostMap = jars.get(sessionId);
  if (!hostMap || hostMap.size === 0) return "";

  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return "";
  }

  const parts = [];
  for (const [, c] of hostMap) {
    const d = (c.domain || "").replace(/^\./, "");
    if (d && d !== hostname && !hostname.endsWith(`.${d}`) && d !== hostname.replace(/^www\./, "")) {
      continue;
    }
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
}

function clearSession(sessionId) {
  jars.delete(sessionId);
}

module.exports = {
  absorbSetCookies,
  getUpstreamCookieHeader,
  clearSession,
  normalizeSetCookieHeader,
};
