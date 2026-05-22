/**
 * Centralized environment configuration.
 * Load .env before importing this module (see src/index.js).
 */

function stripEnv(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseOrigins(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

function normalizeIproyalHost(raw) {
  let h = stripEnv(raw);
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) {
    try {
      h = new URL(h).hostname;
    } catch {
      return "";
    }
  }
  return h.replace(/\/+$/, "").trim();
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

const port = Number(stripEnv(process.env.PORT || "")) || 8000;
const bindHost = stripEnv(process.env.BIND_HOST) || "127.0.0.1";

const publicApiUrl = stripEnv(process.env.API_PUBLIC_URL || "");
const frontendOrigins = parseOrigins(process.env.FRONTEND_URL);

/**
 * Fail fast in production when public URLs are missing.
 */
function assertProductionEnv() {
  if (!isProduction) return;

  const missing = [];
  if (!publicApiUrl) missing.push("API_PUBLIC_URL");
  if (frontendOrigins.length === 0) missing.push("FRONTEND_URL");

  if (missing.length > 0) {
    throw new Error(
      `Production requires: ${missing.join(", ")}. See server/.env.example and DEPLOYMENT.md.`,
    );
  }
}

module.exports = {
  port,
  bindHost,
  publicApiUrl,
  nodeEnv,
  isProduction,
  frontendOrigins,
  assertProductionEnv,

  iproyal: {
    host: normalizeIproyalHost(process.env.IPROYAL_HOST),
    port: Number(stripEnv(process.env.IPROYAL_PORT || "")) || 0,
    username: stripEnv(process.env.IPROYAL_USERNAME || ""),
    password: stripEnv(process.env.IPROYAL_PASSWORD || ""),
    scheme: (stripEnv(process.env.IPROYAL_SCHEME || "http") || "http").toLowerCase(),
    /** When true, username becomes user_country-xx (required for geo rotation on most plans). */
    appendCountrySuffix: process.env.IPROYAL_APPEND_COUNTRY === "true",
    /** Set IPROYAL_REGION_FAILOVER=false to disable multi-region rotation. */
    regionFailover: process.env.IPROYAL_REGION_FAILOVER !== "false",
    userAgent: stripEnv(process.env.IPROYAL_USER_AGENT || ""),
    probeTimeoutMs: Number(process.env.IPROYAL_PROBE_TIMEOUT_MS) || 45_000,
    requestTimeoutMs: Number(process.env.IPROYAL_REQUEST_TIMEOUT_MS) || 90_000,
    /** Transport retries per region — keep at 1 to avoid loops. */
    maxRetries: 1,
    retryDelayMs: Number(process.env.IPROYAL_RETRY_DELAY_MS) || 800,
    tlsInsecure: process.env.IPROYAL_TLS_INSECURE !== "false",
  },
};
