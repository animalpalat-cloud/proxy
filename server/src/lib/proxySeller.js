/**
 * ProxySeller upstream client — single auto-rotating Thailand proxy (no manual region picker).
 */
const http = require("node:http");
const https = require("node:https");
const { Readable } = require("node:stream");
const tunnel = require("tunnel");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const env = require("../config/env");
const diagnostics = require("./proxyDiagnostics");

const DEFAULT_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const NO_RETRY_HTTP = new Set([404]);

const RETRYABLE_NETWORK = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_SOCKET_CLOSED",
  "ERR_ALPN_NEGOTIATION_FAILED",
  "EPROTO",
]);

const tunnelAgentCache = new Map();
const hpaCache = new Map();
const axiosTunnelCache = new Map();
const axiosHpaCache = new Map();

class ProxyConfigError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ProxyConfigError";
    this.details = details;
  }
}

class ProxyFetchError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "ProxyFetchError";
    this.status = meta.status;
    this.cause = meta.cause;
    this.diagnostics = meta.diagnostics;
  }
}

function buildProxyUri() {
  const { host, port, scheme, username, password } = env.proxySeller;
  const base = new URL(`${scheme}://${host}:${port}`);
  base.username = username;
  base.password = password;
  return base.href;
}

function buildProxyUriForLog() {
  const { host, port, scheme, username } = env.proxySeller;
  return `${scheme}://${username}:***@${host}:${port}`;
}

function proxyAuth() {
  return `${env.proxySeller.username}:${env.proxySeller.password}`;
}

function tlsRejectUnauthorized() {
  return !env.proxySeller.tlsInsecure;
}

/** @param {boolean} useHttp1Alpn */
function buildDestinationTlsOptions(useHttp1Alpn) {
  const opts = {
    rejectUnauthorized: tlsRejectUnauthorized(),
    minVersion: "TLSv1.2",
  };
  if (useHttp1Alpn) {
    opts.ALPNProtocols = ["http/1.1"];
  }
  return opts;
}

/** @param {boolean} useHttp1Alpn */
function alpnProfileLabel(useHttp1Alpn) {
  return useHttp1Alpn ? "http1-only" : "default";
}

function clearAgentCaches() {
  tunnelAgentCache.clear();
  hpaCache.clear();
  axiosTunnelCache.clear();
  axiosHpaCache.clear();
}

function validateConfig() {
  const details = [];
  const { host, port, username, password } = env.proxySeller;
  if (!host) details.push("PROXYSELLER_HOST is missing.");
  if (!port || port < 1 || port > 65535) details.push("PROXYSELLER_HTTP_PORT is invalid.");
  if (!username) details.push("PROXYSELLER_USERNAME is missing.");
  if (!password) details.push("PROXYSELLER_PASSWORD is missing.");
  if (details.length > 0) {
    return { ok: false, error: "ProxySeller configuration incomplete.", details };
  }
  return { ok: true };
}

function assertConfig() {
  const check = validateConfig();
  if (!check.ok) throw new ProxyConfigError(check.error, check.details);
}

/**
 * @param {boolean} useHttp1Alpn
 */
function getTunnelAgents(useHttp1Alpn) {
  const key = `tunnel:${buildProxyUri()}:alpn=${useHttp1Alpn ? 1 : 0}:ka=${env.proxySeller.keepAlive ? 1 : 0}`;
  if (tunnelAgentCache.has(key)) return tunnelAgentCache.get(key);

  const proxy = {
    host: env.proxySeller.host,
    port: env.proxySeller.port,
    proxyAuth: proxyAuth(),
  };

  const destTls = buildDestinationTlsOptions(useHttp1Alpn);
  const keepAlive = env.proxySeller.keepAlive;

  const keepAliveHttp = new http.Agent({
    keepAlive,
    maxSockets: 128,
    maxFreeSockets: keepAlive ? 8 : 0,
    timeout: env.proxySeller.requestTimeoutMs,
  });
  const keepAliveHttps = new https.Agent({
    keepAlive,
    maxSockets: 128,
    maxFreeSockets: keepAlive ? 8 : 0,
    timeout: env.proxySeller.requestTimeoutMs,
    ...destTls,
  });

  const agents = {
    httpAgent: tunnel.httpOverHttp({ proxy, agent: keepAliveHttp }),
    httpsAgent: tunnel.httpsOverHttp({
      proxy,
      rejectUnauthorized: tlsRejectUnauthorized(),
      agent: keepAliveHttps,
    }),
  };
  tunnelAgentCache.set(key, agents);
  return agents;
}

/**
 * @param {boolean} useHttp1Alpn
 */
function getHpaAgent(useHttp1Alpn) {
  const uri = buildProxyUri();
  const key = `${uri}:alpn=${useHttp1Alpn ? 1 : 0}:ka=${env.proxySeller.keepAlive ? 1 : 0}`;
  if (!hpaCache.has(key)) {
    hpaCache.set(
      key,
      new HttpsProxyAgent(uri, {
        keepAlive: env.proxySeller.keepAlive,
        rejectUnauthorized: tlsRejectUnauthorized(),
        timeout: env.proxySeller.requestTimeoutMs,
        ...buildDestinationTlsOptions(useHttp1Alpn),
      }),
    );
  }
  return hpaCache.get(key);
}

/**
 * @param {"tunnel"|"hpa"} transport
 * @param {boolean} useHttp1Alpn
 * @param {import('axios').ResponseType} responseType
 */
function getAxiosClientForStrategy(transport, useHttp1Alpn, responseType) {
  const alpnKey = useHttp1Alpn ? 1 : 0;
  const cacheKey = `${transport}:${responseType}:${buildProxyUri()}:alpn=${alpnKey}`;

  if (transport === "tunnel") {
    if (axiosTunnelCache.has(cacheKey)) return axiosTunnelCache.get(cacheKey);
    const { httpAgent, httpsAgent } = getTunnelAgents(useHttp1Alpn);
    const client = axios.create({
      httpAgent,
      httpsAgent,
      proxy: false,
      maxRedirects: 8,
      timeout: env.proxySeller.requestTimeoutMs,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
      decompress: responseType !== "stream",
      responseType,
    });
    axiosTunnelCache.set(cacheKey, client);
    return client;
  }

  if (axiosHpaCache.has(cacheKey)) return axiosHpaCache.get(cacheKey);
  const agent = getHpaAgent(useHttp1Alpn);
  const hpaClient = axios.create({
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    maxRedirects: 8,
    timeout: env.proxySeller.requestTimeoutMs,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
    decompress: responseType !== "stream",
    responseType,
  });
  axiosHpaCache.set(cacheKey, hpaClient);
  return hpaClient;
}

/**
 * @returns {Array<{ transport: "tunnel"|"hpa"; useHttp1Alpn: boolean }>}
 */
function buildStrategyLadder() {
  const mode = env.proxySeller.transport;
  const strategies = [
    { transport: "tunnel", useHttp1Alpn: true },
    { transport: "tunnel", useHttp1Alpn: false },
    { transport: "hpa", useHttp1Alpn: true },
    { transport: "hpa", useHttp1Alpn: false },
  ];

  if (mode === "tunnel") {
    return strategies.filter((s) => s.transport === "tunnel");
  }
  if (mode === "hpa") {
    return strategies.filter((s) => s.transport === "hpa");
  }

  const preferAlpn = env.proxySeller.alpnHttp1Only;
  if (!preferAlpn) {
    return [
      { transport: "tunnel", useHttp1Alpn: false },
      { transport: "tunnel", useHttp1Alpn: true },
      { transport: "hpa", useHttp1Alpn: false },
      { transport: "hpa", useHttp1Alpn: true },
    ];
  }
  return strategies;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkRetryable(err) {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && RETRYABLE_NETWORK.has(code)) return true;
  return /ECONNRESET|ENOTFOUND|ERR_ALPN|ALPN|socket hang up|socket disconnected before secure TLS/i.test(
    String(err.message || ""),
  );
}

function isSuccessHttp(status) {
  return status >= 200 && status < 400;
}

function wrapAxiosResponse(axiosRes) {
  const headerMap = new Map();
  for (const [key, value] of Object.entries(axiosRes.headers || {})) {
    if (value === undefined) continue;
    headerMap.set(key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }

  const rawSetCookie = axiosRes.headers?.["set-cookie"];
  const setCookies = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : rawSetCookie
      ? [String(rawSetCookie)]
      : [];

  const isStream = axiosRes.config?.responseType === "stream";
  const bodyBuffer = !isStream ? axiosRes.data : null;
  const streamBody = isStream && axiosRes.data ? axiosRes.data : null;

  return {
    ok: axiosRes.status >= 200 && axiosRes.status < 300,
    status: axiosRes.status,
    statusText: axiosRes.statusText || "",
    url:
      typeof axiosRes.request?.res?.responseUrl === "string"
        ? axiosRes.request.res.responseUrl
        : axiosRes.config?.url || "",
    headers: {
      get: (name) => headerMap.get(String(name).toLowerCase()) ?? null,
      forEach: (fn) => {
        for (const [k, v] of headerMap) fn(v, k);
      },
    },
    setCookies,
    stream: streamBody,
    async arrayBuffer() {
      if (Buffer.isBuffer(bodyBuffer)) {
        return bodyBuffer.buffer.slice(
          bodyBuffer.byteOffset,
          bodyBuffer.byteOffset + bodyBuffer.byteLength,
        );
      }
      if (bodyBuffer?.byteLength) return bodyBuffer;
      return new ArrayBuffer(0);
    },
    body:
      streamBody != null
        ? Readable.toWeb(streamBody)
        : bodyBuffer && bodyBuffer.byteLength > 0
          ? Readable.toWeb(Readable.from(Buffer.from(bodyBuffer)))
          : null,
  };
}

async function fetchOnce(targetUrl, options = {}) {
  const responseType = options.stream ? "stream" : "arraybuffer";
  const reqConfig = {
    url: targetUrl,
    method: options.method || "GET",
    headers: options.headers || {},
    data: options.data,
    signal: options.signal,
    responseType,
  };

  const strategies = buildStrategyLadder();
  const failures = [];

  for (const strategy of strategies) {
    const ctx = {
      transport: strategy.transport,
      alpnProfile: alpnProfileLabel(strategy.useHttp1Alpn),
      targetUrl,
    };
    diagnostics.logProxyAttempt(ctx);

    try {
      const client = getAxiosClientForStrategy(
        strategy.transport,
        strategy.useHttp1Alpn,
        responseType,
      );
      const axiosRes = await client.request(reqConfig);
      if (env.proxyDebug) {
        console.log(
          `[proxySeller] OK transport=${strategy.transport} alpn=${ctx.alpnProfile} status=${axiosRes.status} target=${targetUrl}`,
        );
      }
      return wrapAxiosResponse(axiosRes);
    } catch (err) {
      const formatted = diagnostics.formatProxyError(err, ctx);
      failures.push(formatted);
      diagnostics.logProxyFailure(ctx, err);
    }
  }

  const last = failures[failures.length - 1];
  throw new ProxyFetchError(
    `Proxy request failed: ${last?.message ?? "all transport strategies failed"}`,
    { cause: last, diagnostics: { failures, last } },
  );
}

async function fetchThroughProxy(targetUrl, options = {}) {
  assertConfig();

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchOnce(targetUrl, options);
      if (NO_RETRY_HTTP.has(res.status)) return res;
      if (isSuccessHttp(res.status) || res.status < 500) return res;
      await cancelBody(res);
      lastError = new ProxyFetchError(`Upstream HTTP ${res.status}`, { status: res.status });
    } catch (err) {
      lastError = err;
      if (env.proxyDebug && err instanceof ProxyFetchError && err.diagnostics) {
        diagnostics.logProxySummary(`attempt ${attempt + 1} failed`, err.diagnostics.last ?? err.diagnostics);
      }
    }

    const retryable =
      lastError instanceof ProxyFetchError
        ? lastError.status != null && lastError.status >= 500
        : isNetworkRetryable(lastError);

    if (!retryable || attempt >= maxAttempts - 1) break;
    clearAgentCaches();
    await sleep(env.proxySeller.retryDelayMs * (attempt + 1));
  }

  const diag =
    lastError instanceof ProxyFetchError ? lastError.diagnostics?.last : undefined;
  throw new ProxyFetchError(
    `Proxy request failed: ${lastError instanceof Error ? lastError.message : "unknown"}`,
    { cause: lastError, diagnostics: diag },
  );
}

async function cancelBody(res) {
  try {
    if (res.stream?.destroy) res.stream.destroy();
    else if (res.body?.cancel) await res.body.cancel();
  } catch {
    /* ignore */
  }
}

async function probeTarget(targetUrl, options = {}) {
  const configCheck = validateConfig();
  if (!configCheck.ok) {
    return { ok: false, message: configCheck.error, details: configCheck.details };
  }

  const maxAttempts = 3;
  let lastMessage = "Probe failed";
  let lastDiagnostics = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), env.proxySeller.probeTimeoutMs);

    try {
      const res = await fetchThroughProxy(targetUrl, {
        method: "GET",
        signal: ac.signal,
        headers: options.headers,
      });
      const cookieUrl =
        typeof res.url === "string" && res.url ? res.url : targetUrl;
      if (res.setCookies?.length) {
        options.onSetCookies?.(cookieUrl, res.setCookies);
      }
      await cancelBody(res);

      if (res.status === 403) {
        const finalUrl =
          typeof res.url === "string" && res.url ? res.url : targetUrl;
        let probeHost = "";
        try {
          probeHost = new URL(finalUrl).hostname.toLowerCase();
        } catch {
          /* ignore */
        }
        const proxyHost = (env.proxySeller.host || "").toLowerCase();
        const isProxyGateway403 =
          (proxyHost && probeHost === proxyHost) ||
          /proxyseller|proxy-seller/i.test(probeHost);

        if (isProxyGateway403) {
          return {
            ok: false,
            status: 403,
            message:
              `Proxy provider returned 403 Forbidden. Whitelist your VPS outbound IP in ProxySeller (reference PROXYSELLER_AUTH_IP=${env.proxySeller.authIp || "unset"}).`,
          };
        }
        return { ok: true, softFail: true, status: 403 };
      }
      if (!isSuccessHttp(res.status)) {
        lastMessage = `Probe HTTP ${res.status}`;
        if (res.status < 500 || attempt >= maxAttempts - 1) {
          return {
            ok: false,
            status: res.status,
            message:
              res.status === 403
                ? `Target returned 403 Forbidden (${targetUrl}).`
                : lastMessage,
          };
        }
      } else {
        return { ok: true };
      }
    } catch (err) {
      lastMessage = err instanceof ProxyFetchError ? err.message : String(err);
      if (err instanceof ProxyFetchError && err.diagnostics) {
        lastDiagnostics = err.diagnostics;
      }
      if (!isNetworkRetryable(err) || attempt >= maxAttempts - 1) {
        return { ok: false, message: lastMessage, diagnostics: lastDiagnostics };
      }
      clearAgentCaches();
    } finally {
      clearTimeout(t);
    }

    await sleep(env.proxySeller.retryDelayMs * (attempt + 1));
  }

  return { ok: false, message: lastMessage, diagnostics: lastDiagnostics };
}

function isConfigured() {
  return validateConfig().ok;
}

function isStreamUrl(url) {
  return (
    /\.(m3u8|mpd|ts|m4s|mp4|webm|m4v|mov)(\?|$)/i.test(url) ||
    /\/manifest|\/playlist|\.m3u8/i.test(url) ||
    /googlevideo\.com/i.test(url) ||
    /videoplayback/i.test(url)
  );
}

module.exports = {
  fetchThroughProxy,
  probeTarget,
  validateConfig,
  assertConfig,
  buildProxyUriForLog,
  isConfigured,
  isStreamUrl,
  clearAgentCaches,
  ProxyConfigError,
  ProxyFetchError,
  DEFAULT_DESKTOP_UA,
};
