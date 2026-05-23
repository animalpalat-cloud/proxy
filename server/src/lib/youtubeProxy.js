/**
 * YouTube / googlevideo-specific upstream headers and stream response handling.
 */
const { applyProxyCors } = require("./upstreamHeaders");

const CLIENT_IP_HEADERS = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "forwarded",
]);

function isYouTubeFamilyHost(hostname) {
  return /(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$|(?:^|\.)googlevideo\.com$|(?:^|\.)ytimg\.com$|(?:^|\.)ggpht\.com$|(?:^|\.)gstatic\.com$/i.test(
    hostname || "",
  );
}

function isGoogleVideoStream(url) {
  return /googlevideo\.com/i.test(url) || /videoplayback/i.test(url);
}

function isYouTubeTarget(url) {
  try {
    return isYouTubeFamilyHost(new URL(url).hostname);
  } catch {
    return /youtube|googlevideo|ytimg/i.test(url);
  }
}

function stripClientIpHeaders(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    if (CLIENT_IP_HEADERS.has(k.toLowerCase())) delete out[k];
  }
  return out;
}

/**
 * @param {import('express').Request} clientReq
 * @param {{ targetUrl: string; pageUrl: string; cookieHeader?: string; streamRequest?: boolean; googleVideo?: boolean }} ctx
 */
function buildYouTubeUpstreamHeaders(clientReq, ctx) {
  let pageUrl = ctx.pageUrl;
  let origin = "https://www.youtube.com";
  try {
    const p = new URL(ctx.pageUrl);
    pageUrl = p.href;
    origin = p.origin;
  } catch {
    /* ignore */
  }

  const h = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    Connection: "close",
    Referer: pageUrl,
    Origin: origin,
    "Sec-Fetch-Site": ctx.googleVideo ? "cross-site" : "same-origin",
    "Sec-Fetch-Mode": ctx.streamRequest ? "cors" : "no-cors",
    "Sec-Fetch-Dest": ctx.streamRequest ? "video" : "empty",
  };

  if (ctx.cookieHeader) h.Cookie = ctx.cookieHeader;

  if (clientReq?.headers) {
    const cr = clientReq.headers;
    if (typeof cr.range === "string") h.Range = cr.range;
    if (typeof cr["if-range"] === "string") h["If-Range"] = cr["if-range"];
    for (const name of [
      "x-goog-api-key",
      "x-goog-authuser",
      "x-goog-visitor-id",
      "x-youtube-client-name",
      "x-youtube-client-version",
      "x-client-data",
    ]) {
      if (typeof cr[name] === "string") h[name] = cr[name];
    }
  }

  return stripClientIpHeaders(h);
}

/**
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {{ status: number; headers: { get: (k: string) => string | null } }} upstream
 */
function applyVideoStreamResponseHeaders(res, req, upstream) {
  res.status(upstream.status);
  applyProxyCors(res, req);

  const allow = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!allow.includes(lower)) return;
    try {
      res.setHeader(key, value);
    } catch {
      /* ignore */
    }
  });

  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "video/mp4");
  }
}

module.exports = {
  isYouTubeFamilyHost,
  isGoogleVideoStream,
  isYouTubeTarget,
  buildYouTubeUpstreamHeaders,
  applyVideoStreamResponseHeaders,
  stripClientIpHeaders,
};
