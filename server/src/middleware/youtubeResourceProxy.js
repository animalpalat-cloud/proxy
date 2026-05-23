/**
 * YouTube-aware resource proxy layer: googlevideo streaming, API rewrite hooks, header hygiene.
 */
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const youtubeProxy = require("../lib/youtubeProxy");
const {
  buildUpstreamRequestHeaders,
  applyProxyCors,
} = require("../lib/upstreamHeaders");
const rewriteEngine = require("../lib/rewriteEngine");
const { applySafeResponseHeaders } = require("../lib/responseSanitizer");

function buildResourceUpstreamHeaders(clientReq, ctx) {
  const googleVideo = youtubeProxy.isGoogleVideoStream(ctx.targetUrl);
  const youtube = youtubeProxy.isYouTubeTarget(ctx.targetUrl);

  if (googleVideo || youtube) {
    return youtubeProxy.buildYouTubeUpstreamHeaders(clientReq, {
      targetUrl: ctx.targetUrl,
      pageUrl: ctx.pageUrl,
      cookieHeader: ctx.cookieHeader,
      streamRequest: ctx.streamRequest || googleVideo,
      googleVideo,
    });
  }

  return buildUpstreamRequestHeaders(clientReq, {
    targetUrl: ctx.targetUrl,
    pageUrl: ctx.pageUrl,
    assetRequest: ctx.assetRequest,
    streamRequest: ctx.streamRequest,
    cookieHeader: ctx.cookieHeader,
  });
}

function mustStreamTarget(targetUrl, hasRange) {
  return (
    hasRange ||
    youtubeProxy.isGoogleVideoStream(targetUrl) ||
    /\.(ts|m4s)(\?|$)/i.test(targetUrl)
  );
}

async function pipeVideoToClient(res, req, upstream) {
  youtubeProxy.applyVideoStreamResponseHeaders(res, req, upstream);
  res.flushHeaders?.();

  if (upstream.stream) {
    upstream.stream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    await pipeline(upstream.stream, res);
    return;
  }
  if (upstream.body) {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } else {
    res.end();
  }
}

function rewriteProxiedBody(text, meta) {
  return rewriteEngine.rewriteBody(text, meta);
}

function sendBuffered(res, req, upstream, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  res.status(upstream.status);
  applySafeResponseHeaders(res, upstream, { streaming: false });
  if (contentType) res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buf.length));
  applyProxyCors(res, req);
  res.end(buf);
}

module.exports = {
  buildResourceUpstreamHeaders,
  mustStreamTarget,
  pipeVideoToClient,
  rewriteProxiedBody,
  sendBuffered,
  youtubeProxy,
};
