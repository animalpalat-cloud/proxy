/**
 * Upstream request headers, CORS for proxied assets, and site-specific profiles.
 */
const env = require("../config/env");
const proxySeller = require("./proxySeller");

const CLIENT_IP_HEADERS = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "forwarded",
]);

function stripForwardedClientIp(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    if (CLIENT_IP_HEADERS.has(k.toLowerCase())) delete out[k];
  }
  return out;
}

function siteProfile(targetUrl) {
  try {
    const h = new URL(targetUrl).hostname.toLowerCase();
    if (/youtube|googlevideo|ytimg|ggpht|gstatic/i.test(h)) return "youtube";
    if (/tiktok/i.test(h)) return "tiktok";
    if (/reddit/i.test(h)) return "reddit";
  } catch {
    /* ignore */
  }
  return "default";
}

/**
 * @param {import('express').Request} [clientReq]
 * @param {{ targetUrl: string; pageUrl?: string; assetRequest?: boolean; streamRequest?: boolean; cookieHeader?: string }} ctx
 */
function buildUpstreamRequestHeaders(clientReq, ctx) {
  const profile = siteProfile(ctx.targetUrl);
  const pageUrl = ctx.pageUrl || ctx.targetUrl;
  let pageOrigin = "";
  let pageHost = "";
  try {
    const p = new URL(pageUrl);
    pageOrigin = p.origin;
    pageHost = p.hostname;
  } catch {
    /* ignore */
  }

  const extra = {};
  if (ctx.cookieHeader) extra.Cookie = ctx.cookieHeader;

  if (clientReq?.headers) {
    const h = clientReq.headers;
    if (typeof h.range === "string") extra.Range = h.range;
    if (typeof h["if-range"] === "string") extra["If-Range"] = h["if-range"];
    if (typeof h["if-none-match"] === "string") extra["If-None-Match"] = h["if-none-match"];
    for (const name of [
      "x-goog-api-key",
      "x-goog-authuser",
      "x-goog-visitor-id",
      "x-youtube-client-name",
      "x-youtube-client-version",
      "x-client-data",
    ]) {
      if (typeof h[name] === "string") extra[name] = h[name];
    }
  }

  if (profile === "youtube") {
    extra["User-Agent"] = proxySeller.DEFAULT_DESKTOP_UA;
    extra.Accept = extra.Accept || "*/*";
    extra["Accept-Language"] = "en-US,en;q=0.9";
    extra["Accept-Encoding"] = "identity";
    extra.Connection = "close";
    extra.Referer = pageUrl;
    extra.Origin = pageOrigin || "https://www.youtube.com";
    extra["Sec-Fetch-Site"] = ctx.assetRequest ? "same-origin" : "none";
    extra["Sec-Fetch-Mode"] = ctx.streamRequest ? "cors" : ctx.assetRequest ? "cors" : "navigate";
    extra["Sec-Fetch-Dest"] = ctx.streamRequest ? "video" : ctx.assetRequest ? "empty" : "document";
    return stripForwardedClientIp(extra);
  }

  const ua = env.proxySeller.userAgent || proxySeller.DEFAULT_DESKTOP_UA;
  const base = {
    "User-Agent": ua,
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "close",
    ...extra,
  };

  if (ctx.streamRequest || ctx.assetRequest) {
    return stripForwardedClientIp({
      ...base,
      Accept: extra.Accept || "*/*",
      Referer: pageUrl,
      Origin: pageOrigin,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
    });
  }

  return stripForwardedClientIp({
    ...base,
    Accept:
      extra.Accept ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: pageUrl,
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  });
}

function applyUpstreamHeaders(res, upstream, { streaming = false } = {}) {
  const hop = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "upgrade",
  ]);
  const strip = new Set([
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "permissions-policy",
  ]);

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hop.has(lower)) return;
    if (strip.has(lower) || lower.startsWith("content-security-policy")) return;
    if (lower === "set-cookie") return;
    if (!streaming && (lower === "content-length" || lower === "content-encoding")) return;
    try {
      res.setHeader(key, value);
    } catch {
      /* ignore */
    }
  });
}

function isAllowedBrowserOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  if (env.frontendOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (!env.isProduction && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function applyProxyCors(res, req) {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin : "";

  if (origin && isAllowedBrowserOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  );
}

const CORS_ALLOW_HEADERS = [
  "Accept",
  "Accept-Language",
  "Authorization",
  "Content-Type",
  "Origin",
  "Referer",
  "Range",
  "If-Range",
  "If-None-Match",
  "If-Modified-Since",
  "X-Requested-With",
  "x-goog-api-key",
  "x-goog-authuser",
  "x-goog-visitor-id",
  "x-youtube-client-name",
  "x-youtube-client-version",
  "x-browser-channel",
  "x-browser-copyright",
  "x-browser-validation",
  "x-browser-year",
  "x-client-data",
];

function sanitizeCorsAllowHeaders(requested) {
  const allowed = new Map();
  for (const h of CORS_ALLOW_HEADERS) {
    allowed.set(h.toLowerCase(), h);
  }

  const raw = Array.isArray(requested) ? requested.join(",") : String(requested || "");
  for (const part of raw.split(",")) {
    const cleaned = part.trim().replace(/[\r\n\0]/g, "");
    if (!cleaned) continue;
    if (!/^[\w!#$%&'*+.^`|~-]+$/i.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (!allowed.has(key)) allowed.set(key, cleaned);
  }

  return [...allowed.values()].join(", ");
}

function handleProxyPreflight(req, res) {
  applyProxyCors(res, req);
  res.setHeader(
    "Access-Control-Allow-Headers",
    sanitizeCorsAllowHeaders(req.headers["access-control-request-headers"]),
  );
  res.status(204).end();
}

function shouldStreamBinary(url, contentType = "", hasRange = false) {
  if (hasRange) return true;
  if (/video|audio|octet-stream|image\/|font\/|application\/font|application\/wasm|mpegurl|mp2t/i.test(
    contentType,
  )) {
    return true;
  }
  return /\.(mp4|webm|m4v|mov|mp3|m4a|ts|m4s|jpg|jpeg|png|gif|webp|avif|woff2?|ttf|otf|wasm)(\?|$)/i.test(
    url,
  );
}

module.exports = {
  buildUpstreamRequestHeaders,
  applyUpstreamHeaders,
  applyProxyCors,
  handleProxyPreflight,
  sanitizeCorsAllowHeaders,
  CORS_ALLOW_HEADERS,
  isAllowedBrowserOrigin,
  stripForwardedClientIp,
  shouldStreamBinary,
  siteProfile,
};
