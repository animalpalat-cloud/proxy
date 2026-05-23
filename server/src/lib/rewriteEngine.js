/**
 * Ultraviolet-inspired rewrite engine (server-side): HTML, CSS, JS, JSON, HLS.
 */
const youtubeProxy = require("./youtubeProxy");
const htmlRewrite = require("./htmlRewrite");

function proxyResourcePrefix(sessionId) {
  return htmlRewrite.proxyResourcePrefix(sessionId);
}

/**
 * @param {string} contentType
 * @param {string} targetUrl
 */
function detectRewriteKind(contentType, targetUrl) {
  if (isBinaryContentType(contentType, targetUrl)) return null;
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return "html";
  if (/text\/css/i.test(contentType)) return "css";
  if (/javascript|ecmascript/i.test(contentType) || /\.mjs(\?|$)/i.test(targetUrl)) {
    return "js";
  }
  if (/\.js(\?|$)/i.test(targetUrl)) return "js";
  if (/json/i.test(contentType) || /\/youtubei\/v1\//i.test(targetUrl)) return "json";
  if (/mpegurl|m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(targetUrl)) return "m3u8";
  if (
    /text\/plain|application\/xml/i.test(contentType) &&
    youtubeProxy.isYouTubeTarget(targetUrl)
  ) {
    return "youtube";
  }
  return null;
}

/**
 * @param {string} contentType
 * @param {string} targetUrl
 */
function isBinaryContentType(contentType, targetUrl) {
  if (
    /video|audio|octet-stream|image\/|font\/|application\/font|application\/wasm|mpegurl|mp2t/i.test(
      contentType,
    )
  ) {
    return true;
  }
  return /\.(mp4|webm|m4v|mov|mp3|m4a|ts|m4s|woff2?|ttf|otf|eot|ico|avif|webp|png|jpe?g|gif|wasm|bin)(\?|$)/i.test(
    targetUrl,
  );
}

/**
 * @param {string} text
 * @param {{ contentType: string; targetUrl: string; finalUrl: string; gatewayOrigin: string; sessionId: string }} meta
 */
function rewriteBody(text, meta) {
  if (isBinaryContentType(meta.contentType, meta.targetUrl)) {
    return text;
  }
  const kind = detectRewriteKind(meta.contentType, meta.targetUrl);
  const { contentType, targetUrl, finalUrl, gatewayOrigin, sessionId } = meta;

  switch (kind) {
    case "html":
      return htmlRewrite.rewriteHtmlDocument(text, finalUrl, gatewayOrigin, sessionId);
    case "css":
      return htmlRewrite.rewriteCssDocument(text, finalUrl, gatewayOrigin, sessionId);
    case "js":
      return htmlRewrite.rewriteJsDocument(text, finalUrl, gatewayOrigin, sessionId);
    case "json":
      return htmlRewrite.rewriteJsonDocument(text, finalUrl, gatewayOrigin, sessionId);
    case "m3u8":
      return htmlRewrite.rewriteM3u8Playlist(text, finalUrl, gatewayOrigin, sessionId);
    case "youtube":
      return htmlRewrite.rewriteYouTubeDocument(text, finalUrl, gatewayOrigin, sessionId);
    default:
      return text;
  }
}

module.exports = {
  proxyResourcePrefix,
  detectRewriteKind,
  isBinaryContentType,
  rewriteBody,
};
