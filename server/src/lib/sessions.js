const crypto = require("node:crypto");
const cookieJar = require("./cookieJar");

/** @typedef {{ targetUrl: string; region: string; createdAt: number }} SessionRecord */

const SESSION_TTL_MS = 60 * 60 * 1000;
const FAIL_CACHE_MS = 45 * 1000;

/** @type {Map<string, SessionRecord>} */
const store = new Map();

/** @type {Map<string, number>} */
const resourceFailCache = new Map();

/** @param {string} sessionId */
function purgeResourceFailCache(sessionId) {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return;
  const prefix = `${sid}|`;
  for (const key of resourceFailCache.keys()) {
    if (key.startsWith(prefix)) resourceFailCache.delete(key);
  }
}

function sweep() {
  const now = Date.now();
  for (const [id, rec] of store) {
    if (now - rec.createdAt > SESSION_TTL_MS) {
      store.delete(id);
      cookieJar.clearSession(id);
      purgeResourceFailCache(id);
    }
  }
  for (const [key, until] of resourceFailCache) {
    if (now > until) resourceFailCache.delete(key);
  }
}

const sweepTimer = setInterval(sweep, 5 * 60 * 1000);
if (typeof sweepTimer.unref === "function") sweepTimer.unref();

/**
 * Normalize session id from URL params (strip slashes, decode).
 * @param {string} raw
 */
function normalizeSessionId(raw) {
  if (typeof raw !== "string" || !raw) return "";
  let id = raw.trim();
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  id = id.replace(/\/+$/, "");
  return id;
}

/**
 * @param {{ targetUrl: string; region?: string }} payload
 * @returns {string}
 */
function createSession(payload) {
  sweep();
  const id = crypto.randomBytes(24).toString("hex");
  store.set(id, {
    targetUrl: payload.targetUrl,
    region: payload.region || "auto",
    createdAt: Date.now(),
  });
  console.log(`[sessions] created id=${id.slice(0, 12)}… storeSize=${store.size}`);
  return id;
}

/** @param {string} id */
function deleteSession(id) {
  const sid = normalizeSessionId(id);
  if (!sid) return;
  const had = store.delete(sid);
  cookieJar.clearSession(sid);
  purgeResourceFailCache(sid);
  if (had) {
    console.log(`[sessions] deleted id=${sid.slice(0, 12)}… storeSize=${store.size}`);
  }
}

/** @param {string} id */
function hasSession(id) {
  return getSession(id) != null;
}

/** @param {string} id */
function getSession(id) {
  const sid = normalizeSessionId(id);
  if (!sid) return undefined;
  const rec = store.get(sid);
  if (!rec) return undefined;
  if (Date.now() - rec.createdAt > SESSION_TTL_MS) {
    store.delete(sid);
    cookieJar.clearSession(sid);
    purgeResourceFailCache(sid);
    console.log(`[sessions] expired id=${sid.slice(0, 12)}…`);
    return undefined;
  }
  return rec;
}

function getStoreSize() {
  sweep();
  return store.size;
}

function absorbSetCookies(sessionId, requestUrl, setCookies) {
  cookieJar.absorbSetCookies(sessionId, requestUrl, setCookies);
}

function getUpstreamCookieHeader(sessionId, targetUrl) {
  return cookieJar.getUpstreamCookieHeader(sessionId, targetUrl);
}

function markResourceFailed(sessionId, url) {
  resourceFailCache.set(`${sessionId}|${url}`, Date.now() + FAIL_CACHE_MS);
}

function isResourceBlocked(sessionId, url) {
  const key = `${sessionId}|${url}`;
  const until = resourceFailCache.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    resourceFailCache.delete(key);
    return false;
  }
  return true;
}

module.exports = {
  createSession,
  getSession,
  hasSession,
  deleteSession,
  normalizeSessionId,
  getStoreSize,
  markResourceFailed,
  isResourceBlocked,
  absorbSetCookies,
  getUpstreamCookieHeader,
};
