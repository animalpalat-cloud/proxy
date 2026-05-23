/**
 * Allowed browser origins for CORS (FRONTEND_URL + API_PUBLIC_URL + www variants).
 */
const env = require("../config/env");

/** @param {string} origin */
function expandOriginVariants(origin) {
  const set = new Set();
  const o = (origin || "").trim().replace(/\/$/, "");
  if (!o) return set;
  set.add(o);
  try {
    const u = new URL(o);
    if (u.hostname.startsWith("www.")) {
      set.add(`${u.protocol}//${u.hostname.slice(4)}`);
    } else {
      set.add(`${u.protocol}//www.${u.hostname}`);
    }
  } catch {
    /* ignore */
  }
  return set;
}

function getAllowedOrigins() {
  const set = new Set();
  for (const o of env.frontendOrigins) {
    for (const v of expandOriginVariants(o)) set.add(v);
  }
  const api = env.publicApiUrl?.trim().replace(/\/$/, "");
  if (api) {
    for (const v of expandOriginVariants(api)) set.add(v);
  }
  return set;
}

/**
 * @param {string | undefined} origin
 */
function isOriginAllowed(origin) {
  if (!origin || typeof origin !== "string") return true;
  if (getAllowedOrigins().has(origin)) return true;
  if (!env.isProduction) {
    try {
      const { hostname } = new URL(origin);
      if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed,
  expandOriginVariants,
};
