const crypto = require("node:crypto");

/** @typedef {{ targetUrl: string; region: string; createdAt: number }} SessionRecord */

const SESSION_TTL_MS = 60 * 60 * 1000;
const FAIL_CACHE_MS = 45 * 1000;

/** @type {Map<string, SessionRecord>} */
const store = new Map();

/** @type {Map<string, number>} sessionId|url → failUntil timestamp */
const resourceFailCache = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, rec] of store) {
    if (now - rec.createdAt > SESSION_TTL_MS) store.delete(id);
  }
  for (const [key, until] of resourceFailCache) {
    if (now > until) resourceFailCache.delete(key);
  }
}

const sweepTimer = setInterval(sweep, 5 * 60 * 1000);
if (typeof sweepTimer.unref === "function") sweepTimer.unref();

/**
 * @param {{ targetUrl: string; region: string }} payload
 * @returns {string}
 */
function createSession(payload) {
  sweep();
  const id = crypto.randomBytes(24).toString("hex");
  store.set(id, {
    targetUrl: payload.targetUrl,
    region: payload.region,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * @param {string} id
 * @returns {SessionRecord | undefined}
 */
function getSession(id) {
  if (typeof id !== "string" || !id) return undefined;
  const rec = store.get(id);
  if (!rec) return undefined;
  if (Date.now() - rec.createdAt > SESSION_TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return rec;
}

/**
 * @param {string} id
 * @param {string} region
 */
function updateSessionRegion(id, region) {
  const rec = getSession(id);
  if (!rec || typeof region !== "string" || !region) return;
  rec.region = region;
}

/**
 * Block repeat proxy attempts for the same URL (stops player retry storms).
 * @param {string} sessionId
 * @param {string} url
 */
function markResourceFailed(sessionId, url) {
  resourceFailCache.set(`${sessionId}|${url}`, Date.now() + FAIL_CACHE_MS);
}

/**
 * @param {string} sessionId
 * @param {string} url
 */
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
  updateSessionRegion,
  markResourceFailed,
  isResourceBlocked,
};
