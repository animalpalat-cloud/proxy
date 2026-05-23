/**
 * Central proxy gateway: classify responses, rewrite bodies, stream binary without buffering.
 * Server-side analogue to Ultraviolet's SW rewrite + Bare transport (transport = ProxySeller here).
 */
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { applySafeResponseHeaders } = require("./responseSanitizer");
const { applyProxyCors, shouldStreamBinary } = require("./upstreamHeaders");
const rewriteEngine = require("./rewriteEngine");

/**
 * @param {string} location
 * @param {string} gatewayOrigin
 * @param {string} sessionId
 */
function rewriteRedirectLocation(location, gatewayOrigin, sessionId) {
  if (!location || typeof location !== "string") return location;
  const trimmed = location.trim();
  if (!trimmed) return location;

  try {
    const abs = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : new URL(trimmed, gatewayOrigin).href;
    const prefix = rewriteEngine.proxyResourcePrefix(sessionId);
    return (gatewayOrigin.replace(/\/$/, "") || "") + prefix + encodeURIComponent(abs);
  } catch {
    return location;
  }
}

/**
 * @param {string} targetUrl
 * @param {string} contentType
 * @param {boolean} hasRange
 */
function shouldStreamResponse(targetUrl, contentType, hasRange) {
  if (hasRange) return true;
  if (rewriteEngine.isBinaryContentType(contentType, targetUrl)) return true;
  return shouldStreamBinary(targetUrl, contentType, hasRange);
}

/**
 * @param {string} contentType
 * @param {string} targetUrl
 */
function shouldRewriteBody(contentType, targetUrl) {
  return rewriteEngine.detectRewriteKind(contentType, targetUrl) !== null;
}

/**
 * Pipe upstream stream to client; destroy upstream on client abort.
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {{ status: number; headers: { get: (k: string) => string | null }; stream?: import('stream').Readable }} upstream
 */
async function pipeUpstreamToClient(res, req, upstream) {
  if (res.headersSent) {
    return;
  }

  res.status(upstream.status);
  applySafeResponseHeaders(res, upstream, { streaming: true });
  applyProxyCors(res, req);
  res.flushHeaders?.();

  const onClose = () => {
    try {
      upstream.stream?.destroy?.();
    } catch {
      /* ignore */
    }
  };
  req.on("close", onClose);

  try {
    if (upstream.stream) {
      upstream.stream.on("error", onClose);
      await pipeline(upstream.stream, res);
      return;
    }
    if (!res.headersSent) {
      res.end();
    }
  } catch (err) {
    try {
      upstream.stream?.destroy?.();
    } catch {
      /* ignore */
    }
    if (!res.headersSent) {
      throw err;
    }
    console.error(
      "[proxyGateway] Stream error after headers sent:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    req.off("close", onClose);
  }
}

/**
 * Buffered body with rewrite + explicit Content-Length.
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {{ status: number; headers: { get: (k: string) => string | null } }} upstream
 * @param {Buffer} body
 * @param {string} [contentType]
 */
function sendRewrittenBuffer(res, req, upstream, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  res.status(upstream.status);
  if (contentType) res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buf.length));
  applyProxyCors(res, req);
  res.end(buf);
}

/**
 * Full delivery path for one proxied resource.
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {{ status: number; headers: { get: (k: string) => string | null; forEach?: Function }; stream?: import('stream').Readable; setCookies?: string[] }} upstream
 * @param {{ targetUrl: string; finalUrl: string; gatewayOrigin: string; sessionId: string; hasRange?: boolean }} ctx
 * @param {() => Promise<Buffer>} loadBuffer
 */
async function deliverResource(res, req, upstream, ctx, loadBuffer) {
  if (res.headersSent) {
    return;
  }

  const contentType = upstream.headers.get("content-type") || "";
  const location = upstream.headers.get("location");

  if (location && upstream.status >= 300 && upstream.status < 400) {
    res.status(upstream.status);
    res.setHeader("Location", rewriteRedirectLocation(location, ctx.gatewayOrigin, ctx.sessionId));
    applyProxyCors(res, req);
    res.end();
    return;
  }

  if (
    shouldStreamResponse(ctx.targetUrl, contentType, Boolean(ctx.hasRange)) &&
    upstream.stream
  ) {
    await pipeUpstreamToClient(res, req, upstream);
    return;
  }

  if (
    shouldRewriteBody(contentType, ctx.targetUrl) &&
    upstream.status >= 200 &&
    upstream.status < 300 &&
    !rewriteEngine.isBinaryContentType(contentType, ctx.targetUrl)
  ) {
    const buf = await loadBuffer();
    const rewritten = rewriteEngine.rewriteBody(buf.toString("utf8"), {
      contentType,
      targetUrl: ctx.targetUrl,
      finalUrl: ctx.finalUrl,
      gatewayOrigin: ctx.gatewayOrigin,
      sessionId: ctx.sessionId,
    });
    sendRewrittenBuffer(
      res,
      req,
      upstream,
      Buffer.from(rewritten, "utf8"),
      contentType || undefined,
    );
    return;
  }

  const buf = await loadBuffer();
  res.status(upstream.status);
  applySafeResponseHeaders(res, upstream, { streaming: false });
  applyProxyCors(res, req);
  if (contentType) res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

module.exports = {
  rewriteRedirectLocation,
  shouldStreamResponse,
  shouldRewriteBody,
  pipeUpstreamToClient,
  sendRewrittenBuffer,
  deliverResource,
};
