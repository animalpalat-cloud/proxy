/**
 * IPRoyal-backed document & asset gateway.
 */
const express = require("express");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const env = require("../config/env");
const sessions = require("../lib/sessions");
const ipRoyal = require("../lib/ipRoyal");
const {
  rewriteCssDocument,
  rewriteHtmlDocument,
  rewriteM3u8Playlist,
  rewriteJsDocument,
} = require("../lib/htmlRewrite");

const router = express.Router();

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const STREAMING_HEADER_ALLOW = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
]);

function backendOrigin() {
  const base = env.publicApiUrl?.replace(/\/$/, "");
  if (!base) throw new Error("API_PUBLIC_URL is not set on the server.");
  return base;
}

function sessionPageContext(record) {
  try {
    const u = new URL(record.targetUrl);
    return { referer: u.href, origin: u.origin };
  } catch {
    return { referer: record.targetUrl, origin: "" };
  }
}

/** Tracking / broken template URLs — return empty 200 so the player does not retry forever. */
function isNoiseUrl(url) {
  return (
    /googletagmanager\.com\/gtm\.js\?id=\$/i.test(url) ||
    /cdn-cgi\/rum\?$/i.test(url) ||
    /\/cookie-mgmt\/accept$/i.test(url) ||
    /\$\{e\}\$\{/i.test(url)
  );
}

function shouldSkipUpstreamHeader(lower, streaming = false) {
  if (HOP_BY_HOP.has(lower)) return true;
  if (lower === "set-cookie") return true;
  if (lower.startsWith("content-security-policy")) return true;
  if (streaming) return !STREAMING_HEADER_ALLOW.has(lower);
  if (lower === "content-length") return true;
  if (lower === "content-encoding") return true;
  return false;
}

function applyUpstreamHeaders(res, upstream, { streaming = false } = {}) {
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (shouldSkipUpstreamHeader(lower, streaming)) return;
    try {
      res.setHeader(key, value);
    } catch {
      /* ignore */
    }
  });
}

function isTerminalHttpStatus(status) {
  return status === 403 || status === 404;
}

const MAX_TEXT_BYTES = 15 * 1024 * 1024;

async function bufferFromUpstream(upstream) {
  const raw = await upstream.arrayBuffer();
  return Buffer.from(raw);
}

/**
 * GET /api/proxy/resource?session=...&url=...
 */
router.get("/resource", async (req, res, next) => {
  const sessionId =
    typeof req.query.session === "string" ? req.query.session : "";
  const urlEnc = typeof req.query.url === "string" ? req.query.url : "";

  if (!sessionId || !urlEnc) {
    res.status(400).type("text/plain").send("Missing session or url.");
    return;
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(urlEnc);
  } catch {
    res.status(400).type("text/plain").send("Invalid url encoding.");
    return;
  }

  try {
    const parsed = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      res.status(400).type("text/plain").send("Only http/https allowed.");
      return;
    }
  } catch {
    res.status(400).type("text/plain").send("Invalid url.");
    return;
  }

  const record = sessions.getSession(sessionId);
  if (!record) {
    res.status(410).type("text/plain").send("Session expired or invalid.");
    return;
  }

  if (!ipRoyal.isConfigured()) {
    res.status(503).type("text/plain").send("Proxy not configured.");
    return;
  }

  if (isNoiseUrl(targetUrl)) {
    res.status(204).end();
    return;
  }

  if (sessions.isResourceBlocked(sessionId, targetUrl)) {
    res.status(502).type("text/plain").send("Resource unavailable.");
    return;
  }

  const pageCtx = sessionPageContext(record);
  const isPlaylist = /\.m3u8|\.mpd(\?|$)/i.test(targetUrl);
  const isTs = /\.(ts|m4s)(\?|$)/i.test(targetUrl);
  const useStream =
    Boolean(req.headers.range) && /\.(mp4|webm)(\?|$)/i.test(targetUrl);

  const upstreamHeaders = ipRoyal.buildUpstreamRequestHeaders(req, {
    assetRequest: true,
    streamRequest: useStream || isTs,
    referer: pageCtx.referer,
    origin: pageCtx.origin,
  });

  try {
    const upstream = await ipRoyal.fetchThroughProxy(targetUrl, record.region, {
      headers: upstreamHeaders,
      stream: useStream,
      assetRequest: true,
    });

    if (upstream.ipRoyalRegion && upstream.ipRoyalRegion !== record.region) {
      sessions.updateSessionRegion(sessionId, upstream.ipRoyalRegion);
    }

    if (isTerminalHttpStatus(upstream.status)) {
      sessions.markResourceFailed(sessionId, targetUrl);
      const buf = await bufferFromUpstream(upstream).catch(() => Buffer.alloc(0));
      res.status(upstream.status);
      applyUpstreamHeaders(res, upstream);
      res.end(buf);
      return;
    }

    if (!upstream.ok) {
      if (upstream.status >= 502) {
        sessions.markResourceFailed(sessionId, targetUrl);
      }
      const buf = await bufferFromUpstream(upstream).catch(() => Buffer.alloc(0));
      res.status(upstream.status);
      applyUpstreamHeaders(res, upstream, { streaming: Boolean(upstream.stream) });
      if (upstream.stream && buf.length === 0) {
        upstream.stream.pipe(res);
        return;
      }
      res.end(buf);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const finalUrl =
      typeof upstream.url === "string" && upstream.url ? upstream.url : targetUrl;
    const origin = backendOrigin();

    const isM3u8 = isPlaylist || /mpegurl|m3u8/i.test(contentType);
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const isCss = /text\/css/i.test(contentType);
    const isJs =
      /javascript|\/json/i.test(contentType) || /\.js(\?|$)/i.test(targetUrl);

    if (isM3u8) {
      const buf = await bufferFromUpstream(upstream);
      const text = buf.toString("utf8");
      const rewritten = rewriteM3u8Playlist(text, finalUrl, origin, sessionId);
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType || "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(rewritten);
      return;
    }

    if (isHtml || isCss || isJs) {
      const buf = await bufferFromUpstream(upstream);
      if (buf.length > MAX_TEXT_BYTES) {
        res.status(upstream.status);
        applyUpstreamHeaders(res, upstream);
        res.end(buf);
        return;
      }
      const text = buf.toString("utf8");
      let rewritten = text;
      if (isHtml) {
        rewritten = rewriteHtmlDocument(text, finalUrl, origin, sessionId);
      } else if (isCss) {
        rewritten = rewriteCssDocument(text, finalUrl, origin, sessionId);
      } else {
        rewritten = rewriteJsDocument(text, finalUrl, origin, sessionId);
      }
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(rewritten);
      return;
    }

    res.status(upstream.status);
    applyUpstreamHeaders(res, upstream, { streaming: true });
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (isTs || !useStream) {
      const buf = await bufferFromUpstream(upstream);
      if (isTs && !contentType) {
        res.setHeader("Content-Type", "video/mp2t");
      }
      res.end(buf);
      return;
    }

    if (upstream.stream) {
      upstream.stream.on("error", () => {
        if (!res.headersSent) res.status(502).end();
      });
      await pipeline(upstream.stream, res);
      return;
    }

    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
      return;
    }

    res.end();
  } catch (err) {
    sessions.markResourceFailed(sessionId, targetUrl);
    if (!res.headersSent) {
      res
        .status(502)
        .type("text/plain")
        .send(err instanceof Error ? err.message : "Proxy resource error.");
      return;
    }
    next(err);
  }
});

async function streamSessionThroughProxy(req, res, next) {
  const sessionId =
    typeof req.query.session === "string" ? req.query.session : "";

  try {
    const record = sessions.getSession(sessionId);
    if (!record) {
      res.status(410).type("text/plain").send("Session expired or invalid.");
      return;
    }

    if (!ipRoyal.isConfigured()) {
      res.status(503).type("text/plain").send("Proxy not configured.");
      return;
    }

    const pageCtx = sessionPageContext(record);
    const upstream = await ipRoyal.fetchThroughProxy(record.targetUrl, record.region, {
      headers: ipRoyal.buildUpstreamRequestHeaders(req, {
        referer: pageCtx.referer,
        origin: pageCtx.origin,
      }),
    });

    if (upstream.ipRoyalRegion && upstream.ipRoyalRegion !== record.region) {
      sessions.updateSessionRegion(sessionId, upstream.ipRoyalRegion);
    }

    if (isTerminalHttpStatus(upstream.status)) {
      res.status(upstream.status);
      applyUpstreamHeaders(res, upstream);
      res.end(await bufferFromUpstream(upstream));
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const finalPageUrl =
      typeof upstream.url === "string" && upstream.url ? upstream.url : record.targetUrl;
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);

    if (isHtml) {
      const html = (await bufferFromUpstream(upstream)).toString("utf8");
      const rewritten = rewriteHtmlDocument(
        html,
        finalPageUrl,
        backendOrigin(),
        sessionId,
      );
      res.status(upstream.status);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(rewritten);
      return;
    }

    res.status(upstream.status);
    applyUpstreamHeaders(res, upstream);
    res.end(await bufferFromUpstream(upstream));
  } catch (err) {
    if (!res.headersSent) {
      res
        .status(502)
        .type("text/plain")
        .send(err instanceof Error ? err.message : "Proxy error.");
      return;
    }
    next(err);
  }
}

router.get("/view", streamSessionThroughProxy);
router.get("/stream-or-view", streamSessionThroughProxy);

module.exports = router;
