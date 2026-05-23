/**
 * ProxySeller-backed document and asset gateway with cookie jar, header spoofing, and YouTube streaming.
 */
const express = require("express");

const env = require("../config/env");
const sessions = require("../lib/sessions");
const proxySeller = require("../lib/proxySeller");
const { handleProxyPreflight, shouldStreamBinary } = require("../lib/upstreamHeaders");
const proxyGateway = require("../lib/proxyGateway");
const rewriteEngine = require("../lib/rewriteEngine");
const { resolveSiteTargetUrl } = require("../lib/proxyPaths");
const { buildServiceWorkerSource } = require("../lib/proxyServiceWorker");
const youtubeLayer = require("../middleware/youtubeResourceProxy");
const { handleRouteError } = require("../lib/safeResponse");

const router = express.Router();

router.use((_req, res, next) => {
  res.setHeader("Connection", "close");
  next();
});

function backendOrigin() {
  const frontend = env.frontendOrigins[0]?.replace(/\/$/, "");
  if (frontend) return frontend;
  const base = env.publicApiUrl?.replace(/\/$/, "");
  if (!base) throw new Error("API_PUBLIC_URL or FRONTEND_URL must be set in server/.env.");
  return base;
}

function isNoiseUrl(url) {
  return (
    /googletagmanager\.com\/gtm\.js\?id=\$/i.test(url) ||
    /cdn-cgi\/rum\?$/i.test(url) ||
    /\/cookie-mgmt\/accept$/i.test(url) ||
    /\$\{e\}\$\{/i.test(url)
  );
}

async function bufferFromUpstream(upstream) {
  if (upstream.stream) {
    const chunks = [];
    for await (const chunk of upstream.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const raw = await upstream.arrayBuffer();
  return Buffer.from(raw);
}

function absorbUpstreamCookies(sessionId, requestUrl, upstream) {
  if (upstream.setCookies?.length) {
    sessions.absorbSetCookies(sessionId, requestUrl, upstream.setCookies);
  }
}

async function fetchForSession(sessionId, record, targetUrl, clientReq, opts = {}) {
  const cookieHeader = sessions.getUpstreamCookieHeader(sessionId, targetUrl);
  const headers = youtubeLayer.buildResourceUpstreamHeaders(clientReq, {
    targetUrl,
    pageUrl: record.targetUrl,
    assetRequest: opts.assetRequest,
    streamRequest: opts.streamRequest,
    cookieHeader,
  });

  const method = (opts.method || clientReq?.method || "GET").toUpperCase();
  const fetchOpts = { headers, stream: opts.stream, method };
  if (method !== "GET" && method !== "HEAD" && clientReq?.body != null) {
    fetchOpts.data =
      Buffer.isBuffer(clientReq.body) || typeof clientReq.body === "string"
        ? clientReq.body
        : clientReq.body;
  }

  const upstream = await proxySeller.fetchThroughProxy(targetUrl, fetchOpts);

  const finalUrl =
    typeof upstream.url === "string" && upstream.url ? upstream.url : targetUrl;
  absorbUpstreamCookies(sessionId, finalUrl, upstream);
  return upstream;
}

router.options("/resource", (req, res) => handleProxyPreflight(req, res));
router.options("/view", (req, res) => handleProxyPreflight(req, res));
router.options("/stream-or-view", (req, res) => handleProxyPreflight(req, res));
router.options("/site/:sessionId{/*path}", (req, res) => handleProxyPreflight(req, res));
router.options("/sw.js", (req, res) => handleProxyPreflight(req, res));

router.get("/sw.js", (req, res) => {
  const sessionId = typeof req.query.session === "string" ? req.query.session : "";
  const pageOrigin = typeof req.query.origin === "string" ? req.query.origin : "https://www.youtube.com";
  if (!sessionId) {
    res.status(400).type("text/plain").send("Missing session");
    return;
  }
  const source = buildServiceWorkerSource({
    gatewayOrigin: backendOrigin(),
    sessionId,
    pageOrigin,
  });
  res
    .status(200)
    .type("application/javascript")
    .setHeader("Service-Worker-Allowed", "/")
    .setHeader("Cache-Control", "no-store")
    .send(source);
});

async function proxyResourceHandler(req, res, next) {
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
    res.status(410).type("text/plain").send("Session expired or invalid. Unblock the site again.");
    return;
  }

  if (!proxySeller.isConfigured()) {
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

  const hasRange = Boolean(req.headers.range);
  const isGoogleVideo = youtubeLayer.youtubeProxy.isGoogleVideoStream(targetUrl);
  const likelyStream =
    youtubeLayer.mustStreamTarget(targetUrl, hasRange) ||
    proxySeller.isStreamUrl(targetUrl) ||
    shouldStreamBinary(targetUrl, "", hasRange);

  try {
    const rewriteKind = rewriteEngine.detectRewriteKind("", targetUrl);
    const upstream = await fetchForSession(sessionId, record, targetUrl, req, {
      assetRequest: true,
      streamRequest: likelyStream,
      stream: likelyStream && !rewriteKind,
      method: req.method,
    });

    const finalUrl =
      typeof upstream.url === "string" && upstream.url ? upstream.url : targetUrl;
    const gatewayOrigin = backendOrigin();

    if (!upstream.ok && upstream.status >= 500) {
      sessions.markResourceFailed(sessionId, targetUrl);
    }

    if (isGoogleVideo && upstream.stream) {
      await youtubeLayer.pipeVideoToClient(res, req, upstream);
      return;
    }

    await proxyGateway.deliverResource(
      res,
      req,
      upstream,
      { targetUrl, finalUrl, gatewayOrigin, sessionId, hasRange },
      () => bufferFromUpstream(upstream),
    );
  } catch (err) {
    sessions.markResourceFailed(sessionId, targetUrl);
    handleRouteError(res, req, err, { logTag: "proxy/resource" });
  }
}

router.get("/resource", proxyResourceHandler);
router.post("/resource", proxyResourceHandler);

async function proxySiteHandler(req, res, next) {
  const sessionId = sessions.normalizeSessionId(
    typeof req.params.sessionId === "string" ? req.params.sessionId : "",
  );
  const sitePath =
    typeof req.params.path === "string"
      ? req.params.path
      : Array.isArray(req.params.path)
        ? req.params.path.join("/")
        : "";

  if (!sessionId) {
    res.status(400).type("text/plain").send("Missing session.");
    return;
  }

  const record = sessions.getSession(sessionId);
  if (!record) {
    console.warn(
      `[proxy/site] 410 session not found id=${sessionId.slice(0, 12)}… storeSize=${sessions.getStoreSize()} url=${req.originalUrl}`,
    );
    res.status(410).type("text/plain").send("Session expired or invalid. Unblock the site again.");
    return;
  }

  if (!proxySeller.isConfigured()) {
    res.status(503).type("text/plain").send("Proxy not configured.");
    return;
  }

  const query = { ...req.query };
  delete query.session;
  const targetUrl = resolveSiteTargetUrl(record.targetUrl, sitePath, query);

  if (isNoiseUrl(targetUrl)) {
    res.status(204).end();
    return;
  }

  if (sessions.isResourceBlocked(sessionId, targetUrl)) {
    res.status(502).type("text/plain").send("Resource unavailable.");
    return;
  }

  const hasRange = Boolean(req.headers.range);
  const isGoogleVideo = youtubeLayer.youtubeProxy.isGoogleVideoStream(targetUrl);
  const likelyStream =
    youtubeLayer.mustStreamTarget(targetUrl, hasRange) ||
    proxySeller.isStreamUrl(targetUrl) ||
    shouldStreamBinary(targetUrl, "", hasRange);

  try {
    const rewriteKind = rewriteEngine.detectRewriteKind("", targetUrl);
    const upstream = await fetchForSession(sessionId, record, targetUrl, req, {
      assetRequest: true,
      streamRequest: likelyStream,
      stream: likelyStream && !rewriteKind,
      method: req.method,
    });

    const finalUrl =
      typeof upstream.url === "string" && upstream.url ? upstream.url : targetUrl;
    const gatewayOrigin = backendOrigin();

    if (!upstream.ok && upstream.status >= 500) {
      sessions.markResourceFailed(sessionId, targetUrl);
    }

    if (isGoogleVideo && upstream.stream) {
      await youtubeLayer.pipeVideoToClient(res, req, upstream);
      return;
    }

    await proxyGateway.deliverResource(
      res,
      req,
      upstream,
      { targetUrl, finalUrl, gatewayOrigin, sessionId, hasRange },
      () => bufferFromUpstream(upstream),
    );
  } catch (err) {
    sessions.markResourceFailed(sessionId, targetUrl);
    handleRouteError(res, req, err, { logTag: "proxy/site" });
  }
}

router.get("/site/:sessionId", proxySiteHandler);
router.get("/site/:sessionId/", proxySiteHandler);
router.get("/site/:sessionId{/*path}", proxySiteHandler);

async function streamSessionThroughProxy(req, res, next) {
  const sessionId =
    typeof req.query.session === "string" ? req.query.session : "";

  try {
    const record = sessions.getSession(sessionId);
    if (!record) {
      res.status(410).type("text/plain").send("Session expired or invalid. Unblock the site again.");
      return;
    }

    if (!proxySeller.isConfigured()) {
      res.status(503).type("text/plain").send("Proxy not configured.");
      return;
    }

    const upstream = await fetchForSession(sessionId, record, record.targetUrl, req, {
      assetRequest: false,
      streamRequest: false,
      stream: false,
    });

    const finalPageUrl =
      typeof upstream.url === "string" && upstream.url ? upstream.url : record.targetUrl;
    const gatewayOrigin = backendOrigin();
    await proxyGateway.deliverResource(
      res,
      req,
      upstream,
      {
        targetUrl: finalPageUrl,
        finalUrl: finalPageUrl,
        gatewayOrigin,
        sessionId,
        hasRange: false,
      },
      () => bufferFromUpstream(upstream),
    );
  } catch (err) {
    handleRouteError(res, req, err, { logTag: "proxy/view" });
  }
}

router.get("/view", streamSessionThroughProxy);
router.get("/stream-or-view", streamSessionThroughProxy);

module.exports = router;
