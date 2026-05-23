/**
 * Centralized environment configuration.
 * Requires ../loadEnv.js first (see src/index.js).
 *
 * Uses getters so values stay correct when node --watch restarts the entry
 * file without clearing this module's cache.
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

function normalizeProxyHost(raw) {
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

function readProxySellerScheme() {
  const raw = (stripEnv(process.env.PROXYSELLER_SCHEME || "http") || "http").toLowerCase();
  if (raw === "socks5" || raw === "socks") return "socks5";
  if (raw === "https") return "https";
  return "http";
}

function readProxySellerTransport(usesSocks) {
  const raw = (stripEnv(process.env.PROXYSELLER_TRANSPORT || "auto") || "auto").toLowerCase();
  if (raw === "socks") return "socks";
  if (usesSocks && raw === "auto") return "socks";
  if (raw === "tunnel" || raw === "hpa") return raw;
  return "auto";
}

function readProxySeller() {
  const scheme = readProxySellerScheme();
  const usesSocks = scheme === "socks5";
  const httpPort = Number(stripEnv(process.env.PROXYSELLER_HTTP_PORT || "")) || 0;
  const socksPort = Number(stripEnv(process.env.PROXYSELLER_SOCKS_PORT || "")) || 0;
  const port = usesSocks ? socksPort || httpPort : httpPort || socksPort;

  return {
    host: normalizeProxyHost(process.env.PROXYSELLER_HOST),
    port,
    httpPort,
    socksPort,
    usesSocks,
    username: stripEnv(process.env.PROXYSELLER_USERNAME || ""),
    password: stripEnv(process.env.PROXYSELLER_PASSWORD || ""),
    scheme,
    authIp: stripEnv(process.env.PROXYSELLER_AUTH_IP || ""),
    appendCountrySuffix: process.env.PROXYSELLER_APPEND_COUNTRY === "true",
    regionFailover: false,
    userAgent: stripEnv(process.env.PROXYSELLER_USER_AGENT || ""),
    probeTimeoutMs: Number(process.env.PROXYSELLER_PROBE_TIMEOUT_MS) || 120_000,
    requestTimeoutMs: Number(process.env.PROXYSELLER_REQUEST_TIMEOUT_MS) || 120_000,
    retryDelayMs: Number(process.env.PROXYSELLER_RETRY_DELAY_MS) || 800,
    tlsInsecure: process.env.PROXYSELLER_TLS_INSECURE !== "false",
    transport: readProxySellerTransport(usesSocks),
    alpnHttp1Only: process.env.PROXYSELLER_ALPN_HTTP1_ONLY !== "false",
    keepAlive: process.env.PROXYSELLER_KEEP_ALIVE !== "false",
    debug: process.env.PROXY_DEBUG === "true",
  };
}

function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const missing = [];
  if (!stripEnv(process.env.API_PUBLIC_URL || "")) missing.push("API_PUBLIC_URL");
  if (parseOrigins(process.env.FRONTEND_URL).length === 0) missing.push("FRONTEND_URL");

  if (missing.length > 0) {
    throw new Error(
      `Production requires: ${missing.join(", ")}. See server/.env.example and DEPLOYMENT.md.`,
    );
  }
}

module.exports = {
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get port() {
    return Number(stripEnv(process.env.PORT || "")) || 8000;
  },
  get bindHost() {
    return stripEnv(process.env.BIND_HOST) || "127.0.0.1";
  },
  get publicApiUrl() {
    return stripEnv(process.env.API_PUBLIC_URL || "");
  },
  get frontendOrigins() {
    return parseOrigins(process.env.FRONTEND_URL);
  },
  get proxySeller() {
    return readProxySeller();
  },
  get proxyDebug() {
    return process.env.PROXY_DEBUG === "true";
  },
  assertProductionEnv,
};
