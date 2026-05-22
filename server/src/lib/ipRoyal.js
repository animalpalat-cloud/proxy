/**
 * IPRoyal client — strict region failover (max 2 attempts), no infinite retries.
 * Supports buffered + streaming (Range) fetches for video/HLS.
 */
const http = require("node:http");
const https = require("node:https");
const { Readable } = require("node:stream");
const tunnel = require("tunnel");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const env = require("../config/env");

const REGION_COUNTRY = {
  us: "us",
  uk: "gb",
  gb: "gb",
  de: "de",
  fr: "fr",
  ca: "ca",
  es: "es",
};

const ROTATION_REGIONS = ["us", "gb", "de", "fr", "ca", "es"];

/** 1 initial region + 1 failover = 2 attempts total (no more). */
const MAX_REGION_ATTEMPTS = Math.min(
  2,
  Math.max(1, Number(process.env.IPROYAL_MAX_REGION_FAILOVER) || 2),
);

const DEFAULT_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Never retry these — return to client immediately. */
const NO_RETRY_HTTP = new Set([403, 404]);

/** Failover only for transient upstream/proxy errors. */
const FAILOVER_HTTP = new Set([400, 407, 429, 502, 503, 504]);

const RETRYABLE_NETWORK = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_SOCKET_CLOSED",
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
    this.regionsTried = meta.regionsTried;
    this.cause = meta.cause;
  }
}

function normalizeRegionKey(region) {
  const r = String(region || "us").toLowerCase().trim();
  if (r === "uk") return "gb";
  if (ROTATION_REGIONS.includes(r)) return r;
  return "us";
}

function buildFailoverRegionList(preferredRegion) {
  const start = normalizeRegionKey(preferredRegion);
  if (env.iproyal.regionFailover === false) return [start];
  const list = [start];
  for (const r of ROTATION_REGIONS) {
    if (r !== start) list.push(r);
  }
  return list.slice(0, MAX_REGION_ATTEMPTS);
}

function effectiveUsername(region, opts = {}) {
  const base = env.iproyal.username;
  const cc = REGION_COUNTRY[normalizeRegionKey(region)] || "us";
  const useSuffix =
    opts.forceCountrySuffix === true ||
    (opts.forceCountrySuffix !== false && env.iproyal.appendCountrySuffix);
  if (!useSuffix) return base;
  return `${base}_country-${cc}`;
}

function buildProxyUri(region, opts = {}) {
  const { host, port, scheme } = env.iproyal;
  const base = new URL(`${scheme}://${host}:${port}`);
  base.username = effectiveUsername(region, opts);
  base.password = env.iproyal.password;
  return base.href;
}

function buildProxyUriForLog(region) {
  const { host, port, scheme } = env.iproyal;
  return `${scheme}://${effectiveUsername(region, { forceCountrySuffix: true })}:***@${host}:${port}`;
}

function proxyAuth(region, opts = {}) {
  return `${effectiveUsername(region, opts)}:${env.iproyal.password}`;
}

function tlsRejectUnauthorized() {
  return !env.iproyal.tlsInsecure;
}

/**
 * Build upstream request headers from the browser request (Range, encoding, UA).
 * @param {import('express').Request} [clientReq]
 * @param {{ assetRequest?: boolean; streamRequest?: boolean }} [opts]
 */
function buildUpstreamRequestHeaders(clientReq, opts = {}) {
  const extra = {};
  if (clientReq?.headers) {
    const h = clientReq.headers;
    if (typeof h.range === "string") extra.Range = h.range;
    if (typeof h["accept-encoding"] === "string") {
      extra["Accept-Encoding"] = h["accept-encoding"];
    }
    if (typeof h.accept === "string") extra.Accept = h.accept;
  }
  if (typeof opts.referer === "string" && opts.referer) {
    extra.Referer = opts.referer;
  } else if (clientReq?.headers?.referer) {
    extra.Referer = clientReq.headers.referer;
  }
  if (typeof opts.origin === "string" && opts.origin) {
    extra.Origin = opts.origin;
  }
  return getBrowserHeaders(extra, opts.assetRequest, opts.streamRequest);
}

function getBrowserHeaders(extra = {}, assetRequest = false, streamRequest = false) {
  const ua = env.iproyal.userAgent || DEFAULT_DESKTOP_UA;
  const base = {
    "User-Agent": extra["User-Agent"] || extra["user-agent"] || ua,
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    ...extra,
  };

  if (streamRequest || assetRequest) {
    return {
      ...base,
      Accept: extra.Accept || "*/*",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
    };
  }

  return {
    ...base,
    Accept:
      extra.Accept ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Encoding": extra["Accept-Encoding"] || "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
  };
}

function validateConfig() {
  const details = [];
  const { host, port, username, password, scheme } = env.iproyal;
  if (!host) details.push("IPROYAL_HOST is missing.");
  if (!port || port < 1 || port > 65535) details.push("IPROYAL_PORT is invalid.");
  if (!username) details.push("IPROYAL_USERNAME is missing.");
  if (!password) details.push("IPROYAL_PASSWORD is missing.");
  if (details.length > 0) {
    return { ok: false, error: "IPRoyal configuration incomplete.", details };
  }
  return { ok: true };
}

function assertConfig() {
  const check = validateConfig();
  if (!check.ok) throw new ProxyConfigError(check.error, check.details);
}

function getTunnelAgents(region, suffixOpts = { forceCountrySuffix: false }) {
  const key = `tunnel:${buildProxyUri(region, suffixOpts)}`;
  if (tunnelAgentCache.has(key)) return tunnelAgentCache.get(key);

  const proxy = {
    host: env.iproyal.host,
    port: env.iproyal.port,
    proxyAuth: proxyAuth(region, suffixOpts),
  };

  const tlsOpts = { rejectUnauthorized: tlsRejectUnauthorized() };
  const keepAliveHttp = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 20_000,
    maxSockets: 48,
    timeout: env.iproyal.requestTimeoutMs,
  });
  const keepAliveHttps = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 20_000,
    maxSockets: 48,
    timeout: env.iproyal.requestTimeoutMs,
    ...tlsOpts,
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

function getHpaAgent(region, suffixOpts = { forceCountrySuffix: false }) {
  const uri = buildProxyUri(region, suffixOpts);
  if (!hpaCache.has(uri)) {
    hpaCache.set(
      uri,
      new HttpsProxyAgent(uri, {
        keepAlive: true,
        rejectUnauthorized: tlsRejectUnauthorized(),
      }),
    );
  }
  return hpaCache.get(uri);
}

function getAxiosClient(region, suffixOpts, responseType) {
  const uri = buildProxyUri(region, suffixOpts);
  const cache = responseType === "stream" ? axiosTunnelCache : axiosTunnelCache;
  const key = `${responseType}:${uri}`;
  if (cache.has(key)) return cache.get(key);

  const { httpAgent, httpsAgent } = getTunnelAgents(region, suffixOpts);
  const client = axios.create({
    httpAgent,
    httpsAgent,
    proxy: false,
    maxRedirects: 5,
    timeout: env.iproyal.requestTimeoutMs,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
    decompress: responseType !== "stream",
    responseType,
  });
  cache.set(key, client);
  return client;
}

function isNetworkRetryable(err) {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && RETRYABLE_NETWORK.has(code)) return true;
  return /ECONNRESET|ENOTFOUND|socket hang up/i.test(String(err.message || ""));
}

function shouldFailoverHttp(status) {
  if (NO_RETRY_HTTP.has(status)) return false;
  return FAILOVER_HTTP.has(status) || status >= 500;
}

function isSuccessHttp(status) {
  return status >= 200 && status < 400;
}

function wrapAxiosResponse(axiosRes, region, regionsTried) {
  const headerMap = new Map();
  for (const [key, value] of Object.entries(axiosRes.headers || {})) {
    if (value === undefined) continue;
    headerMap.set(key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }

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
    ipRoyalRegion: region,
    ipRoyalRegionsTried: regionsTried,
  };
}

/**
 * Exactly one HTTP attempt for one region (tunnel only — no inner retry loop).
 */
async function fetchOneRegion(targetUrl, region, options = {}) {
  const suffixOpts = {
    forceCountrySuffix: env.iproyal.appendCountrySuffix,
  };
  const responseType = options.stream ? "stream" : "arraybuffer";
  const headers = options.headers || getBrowserHeaders({}, options.assetRequest, options.stream);
  const client = getAxiosClient(region, suffixOpts, responseType);

  try {
    const axiosRes = await client.request({
      url: targetUrl,
      method: options.method || "GET",
      headers,
      signal: options.signal,
      responseType,
    });
    return wrapAxiosResponse(axiosRes, region, [region]);
  } catch (tunnelErr) {
    const uri = buildProxyUri(region, suffixOpts);
    const key = `hpa-stream:${uri}:${responseType}`;
    let hpaClient = axiosHpaCache.get(key);
    if (!hpaClient) {
      const agent = getHpaAgent(region, suffixOpts);
      hpaClient = axios.create({
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        maxRedirects: 5,
        timeout: env.iproyal.requestTimeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        decompress: responseType !== "stream",
        responseType,
      });
      axiosHpaCache.set(key, hpaClient);
    }
    const axiosRes = await hpaClient.request({
      url: targetUrl,
      method: options.method || "GET",
      headers,
      signal: options.signal,
      responseType,
    });
    return wrapAxiosResponse(axiosRes, region, [region]);
  }
}

/**
 * Strict failover: at most MAX_REGION_ATTEMPTS regions, then stop.
 * @param {string} targetUrl
 * @param {string} [preferredRegion]
 * @param {Record<string, unknown>} [options]
 */
async function fetchThroughProxy(targetUrl, preferredRegion, options = {}) {
  assertConfig();

  const regions = buildFailoverRegionList(preferredRegion);
  const regionsTried = [];
  let lastResponse = null;
  let lastError = null;

  for (const region of regions) {
    if (regionsTried.length >= MAX_REGION_ATTEMPTS) break;
    regionsTried.push(region);

    try {
      const res = await fetchOneRegion(targetUrl, region, options);
      res.ipRoyalRegionsTried = [...regionsTried];

      if (NO_RETRY_HTTP.has(res.status)) {
        return res;
      }

      if (isSuccessHttp(res.status)) {
        return res;
      }

      if (shouldFailoverHttp(res.status) && regionsTried.length < MAX_REGION_ATTEMPTS) {
        await cancelBody(res);
        lastResponse = res;
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (!isNetworkRetryable(err) || regionsTried.length >= MAX_REGION_ATTEMPTS) {
        break;
      }
    }
  }

  if (lastResponse) {
    lastResponse.ipRoyalRegionsTried = regionsTried;
    return lastResponse;
  }

  throw new ProxyFetchError(
    `Proxy failed after ${regionsTried.length} region(s) [${regionsTried.join(", ")}]: ${lastError instanceof Error ? lastError.message : "unknown"}`,
    { regionsTried, cause: lastError },
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

async function probeTarget(targetUrl, preferredRegion, options = {}) {
  const configCheck = validateConfig();
  if (!configCheck.ok) {
    return { ok: false, message: configCheck.error, details: configCheck.details };
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), env.iproyal.probeTimeoutMs);

  try {
    const res = await fetchThroughProxy(targetUrl, preferredRegion, {
      method: "GET",
      signal: ac.signal,
    });
    await cancelBody(res);

    if (NO_RETRY_HTTP.has(res.status)) {
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    if (!isSuccessHttp(res.status)) {
      return {
        ok: false,
        status: res.status,
        message: `Probe HTTP ${res.status} (regions: ${(res.ipRoyalRegionsTried || []).join(", ")})`,
      };
    }
    return { ok: true, regionUsed: res.ipRoyalRegion };
  } catch (err) {
    const msg = err instanceof ProxyFetchError ? err.message : String(err);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(t);
  }
}

function isConfigured() {
  return validateConfig().ok;
}

function isStreamUrl(url) {
  return /\.(m3u8|mpd|ts|m4s|mp4|webm|m4v|mov)(\?|$)/i.test(url) ||
    /\/manifest|\/playlist|\.m3u8/i.test(url);
}

function isLikelyAssetUrl(url) {
  return (
    isStreamUrl(url) ||
    /\.(js|css|jsx|mjs|cjs|woff2?|ttf|otf|svg|jpg|jpeg|png|gif|webp|ico|json)(\?|$)/i.test(url)
  );
}

function isTextRewriteUrl(url, contentType) {
  if (/text\/html|text\/css/i.test(contentType || "")) return true;
  if (/application\/javascript|text\/javascript/i.test(contentType || "")) return true;
  if (/mpegurl|m3u8/i.test(contentType || "")) return true;
  if (/\.m3u8|\.mpd/i.test(url)) return true;
  return false;
}

module.exports = {
  fetchThroughProxy,
  probeTarget,
  validateConfig,
  assertConfig,
  buildProxyUriForLog,
  buildFailoverRegionList,
  buildUpstreamRequestHeaders,
  normalizeRegionKey,
  MAX_REGION_ATTEMPTS,
  isConfigured,
  isLikelyAssetUrl,
  isStreamUrl,
  isTextRewriteUrl,
  ProxyConfigError,
  ProxyFetchError,
  getBrowserHeaders,
};
