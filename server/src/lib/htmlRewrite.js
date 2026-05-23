/**
 * Rewrites HTML/CSS/HLS/JS so assets load via /api/proxy/resource on the gateway origin.
 */
const { proxySitePrefix } = require("./proxyPaths");
const { buildServiceWorkerSource } = require("./proxyServiceWorker");

function proxyResourcePrefix(sessionId) {
  const sid = encodeURIComponent(sessionId);
  return `/api/proxy/resource?session=${sid}&url=`;
}

function createResolver(documentUrl, sessionId, proxyBaseOrigin = "") {
  const base = new URL(documentUrl);
  const proxyPrefix = proxyResourcePrefix(sessionId);
  const gatewayOrigin = (proxyBaseOrigin || "").replace(/\/$/, "");

  function proxyify(absUrl) {
    let u;
    try {
      u = new URL(absUrl);
    } catch {
      return absUrl;
    }
    if (!/^https?:$/i.test(u.protocol)) return absUrl;
    if (absUrl.startsWith(proxyPrefix)) return absUrl;
    return proxyPrefix + encodeURIComponent(u.href);
  }

  const FILE_EXT = /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|m3u8|ts|mp4|vtt|json)(\?|$)/i;

  function toAbsoluteUrl(ref) {
    const t = ref.trim();
    if (/^https?:\/\//i.test(t)) return t;
    if (t.startsWith("//")) return `https:${t}`;
    const isFile = FILE_EXT.test(t);
    if (!t.includes("/") && isFile) {
      return new URL(t, base).href;
    }
    if (/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}(\/|:)/i.test(t) && !isFile) {
      return `https://${t.replace(/^\/+/, "")}`;
    }
    return new URL(t, base).href;
  }

  function resolveSitePath(pathPart, hash) {
    const qIdx = pathPart.indexOf("?");
    const pathname = qIdx >= 0 ? pathPart.slice(0, qIdx) : pathPart;
    const search = qIdx >= 0 ? pathPart.slice(qIdx) : "";
    const site = proxySitePrefix(sessionId);
    return (gatewayOrigin ? gatewayOrigin : "") + site + pathname + search + hash;
  }

  function resolveRef(raw) {
    const t = (raw ?? "").trim();
    if (
      !t ||
      /^mailto:/i.test(t) ||
      /^tel:/i.test(t) ||
      /^javascript:/i.test(t) ||
      /^data:/i.test(t) ||
      /^blob:/i.test(t)
    ) {
      return t;
    }
    const hashIdx = t.indexOf("#");
    const pathPart = hashIdx >= 0 ? t.slice(0, hashIdx) : t;
    const hash = hashIdx >= 0 ? t.slice(hashIdx) : "";

    if (t.startsWith(proxyPrefix)) return t;
    if (pathPart.startsWith(proxySitePrefix(sessionId))) {
      return (gatewayOrigin ? gatewayOrigin : "") + pathPart + hash;
    }
    if (pathPart.startsWith("/api/proxy/site/")) {
      return (gatewayOrigin ? gatewayOrigin : "") + pathPart + hash;
    }
    if (pathPart.startsWith("/api/proxy/resource?")) {
      return (gatewayOrigin ? gatewayOrigin + pathPart : pathPart) + hash;
    }
    if (pathPart.startsWith("/") && !pathPart.startsWith("//") && !pathPart.startsWith("/api/")) {
      try {
        const abs = new URL(pathPart, base.origin).href;
        if (/^https?:$/i.test(new URL(abs).protocol)) {
          return resolveSitePath(pathPart, hash);
        }
      } catch {
        /* fall through */
      }
    }
    // Fix doubly-nested paths from earlier bad rewrites: /api/proxy/<session>/api/proxy/resource?...
    const nested = pathPart.match(
      /^\/api\/proxy\/[a-f0-9]+\/api\/proxy\/resource\?(.+)$/i,
    );
    if (nested) {
      return (gatewayOrigin ? gatewayOrigin : "") + `/api/proxy/resource?${nested[1]}` + hash;
    }
    if (/^https?:\/\/[^/]+\/api\/proxy\/resource\?/i.test(pathPart)) {
      try {
        const u = new URL(pathPart);
        const target = u.searchParams.get("url");
        if (target) {
          const fixed = proxyPrefix + encodeURIComponent(target);
          return hash ? fixed + hash : fixed;
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const abs = toAbsoluteUrl(pathPart);
      const proxied = proxyify(abs);
      return hash ? proxied + hash : proxied;
    } catch {
      return t;
    }
  }

  return { resolveRef, proxyify, base };
}

function stripBaseTags(html) {
  return html.replace(/<base\b[^>]*>/gi, "");
}

/** Remove CSP/XFO meta, SRI integrity, and rewrite meta refresh targets (UV-style). */
function stripSecurityMetaAndIntegrity(html, resolveRef) {
  let out = html;
  out = out.replace(
    /<meta\b[^>]*(?:http-equiv|name)\s*=\s*["']?(?:content-security-policy|x-frame-options|x-content-type-options|referrer)[^>]*>/gi,
    "",
  );
  out = out.replace(/\s+integrity\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi, "");
  out = out.replace(/\s+crossorigin\s*=\s*("anonymous"|"use-credentials"|[^\s>]+)/gi, "");
  if (resolveRef) {
    out = out.replace(
      /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'])([^"']*)(["'][^>]*>)/gi,
      (_m, pre, content, post) => {
        const rewritten = content.replace(
          /url\s*=\s*([^\s;]+)/gi,
          (_u, rawUrl) => `url=${resolveRef(String(rawUrl).replace(/^['"]|['"]$/g, ""))}`,
        );
        return pre + rewritten + post;
      },
    );
  }
  return out;
}

function buildProxyRuntimeScript(gatewayOrigin, sessionId, pageUrl) {
  const G = JSON.stringify((gatewayOrigin || "").replace(/\/$/, ""));
  const S = JSON.stringify(sessionId);
  const B = JSON.stringify(pageUrl);
  let pageOrigin = "https://www.youtube.com";
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    /* ignore */
  }
  const O = JSON.stringify(pageOrigin);
  const SITE = JSON.stringify(proxySitePrefix(sessionId));
  const swUrl = `${(gatewayOrigin || "").replace(/\/$/, "")}/sw.js?session=${encodeURIComponent(sessionId)}&origin=${encodeURIComponent(pageOrigin)}`;

  return `<script id="openrelay-proxy-runtime">(function(){var G=${G},S=${S},B=${B},O=${O},SITE=${SITE},P="/api/proxy/resource?session="+encodeURIComponent(S)+"&url=";function gw(){return G?G:location.origin}function sitePx(path,search,hash){var p=path.startsWith("/")?path:"/"+path;return gw()+SITE+p+(search||"")+(hash||"")}function px(u){if(!u||typeof u!=="string")return u;if(/^(data:|blob:|javascript:|mailto:|tel:)/i.test(u))return u;if(u.indexOf(P)===0||u.indexOf(SITE)===0||(G&&u.indexOf(G+SITE)===0))return u;var h="";var p=u;var i=u.indexOf("#");if(i>=0){p=u.slice(0,i);h=u.slice(i)}try{var q="",path=p,search="";var qi=p.indexOf("?");if(qi>=0){path=p.slice(0,qi);search=p.slice(qi)}if(/^https?:\\/\\//i.test(path))return P+encodeURIComponent(path+search)+h;if(path.indexOf("//")===0)return P+encodeURIComponent("https:"+path+search)+h;if(path.indexOf("/api/proxy/")===0)return gw()+path+h;if(path.charAt(0)==="/"&&!path.startsWith("/api/"))return sitePx(path,search,h);var a=new URL(p,B).href;return P+encodeURIComponent(a)+h}catch(e){return u}}function fixWrongHost(u){if(!u||typeof u!=="string")return u;if(u.indexOf("/api/proxy/site/")>=0)return u;var o=gw();if(G&&u.indexOf(G+"/api/proxy/")===0)return u;if(/^\\/(s|yt|embed)\\//i.test(u)||u==="/sw.js"||u.indexOf("/youtubei/")===0)return sitePx(u.split("?")[0],u.indexOf("?")>=0?u.slice(u.indexOf("?")):"","");return px(u)}var of=window.fetch;window.fetch=function(i,n){if(typeof i==="string")i=fixWrongHost(i);else if(i&&typeof i==="object"&&i.url)i=new Request(fixWrongHost(i.url),i);return of.call(this,i,n)};var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,b,c){return xo.call(this,m,fixWrongHost(u),a,b,c)};function ps(proto,attr){try{var d=Object.getOwnPropertyDescriptor(proto,attr);if(!d||!d.set)return;var s=d.set;d.set=function(v){return s.call(this,fixWrongHost(v))};Object.defineProperty(proto,attr,d)}catch(e){}}ps(HTMLImageElement.prototype,"src");ps(HTMLScriptElement.prototype,"src");ps(HTMLLinkElement.prototype,"href");ps(HTMLMediaElement.prototype,"src");ps(HTMLSourceElement.prototype,"src");ps(HTMLIFrameElement.prototype,"src");var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(v&&typeof v==="string"&&/^(src|href|poster|action|data-src|data-href|data-url|data-poster)$/i.test(n))v=fixWrongHost(v);return sa.call(this,n,v)};if("serviceWorker" in navigator){navigator.serviceWorker.register(${JSON.stringify(swUrl)},{scope:"/api/proxy/"}).catch(function(){})}})();</script>`;
}

function injectProxyRuntime(html, gatewayOrigin, sessionId, pageUrl) {
  const tag = buildProxyRuntimeScript(gatewayOrigin, sessionId, pageUrl);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  }
  return tag + html;
}

const YOUTUBE_URL_IN_TEXT =
  /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|googlevideo\.com|ytimg\.com|gstatic\.com|googleapis\.com|ggpht\.com)[^\s"'`)<\]]+/gi;
const PROTO_REL_YOUTUBE =
  /\/\/(?:[\w-]+\.)?(?:youtube\.com|googlevideo\.com|ytimg\.com|gstatic\.com)[^\s"'`)<\]]+/gi;
const YT_RELATIVE_API = /(["'])(\/youtubei\/v1\/[^"']+)\1/gi;
const YT_ROOT_PATH =
  /(["'`])(\/(?:s|yt|embed|iframe_api|sw\.js|youtubei)[^"'`\\]*)\1/gi;
const YT_IMPORT_PATH =
  /import\s*\(\s*["'](\/[^"']+)["']\s*\)/gi;

function rewriteYouTubeDocument(text, documentUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(documentUrl, sessionId, gatewayOrigin);
  let out = text;

  out = out.replace(YOUTUBE_URL_IN_TEXT, (match) => resolveRef(match));
  out = out.replace(PROTO_REL_YOUTUBE, (match) => resolveRef(`https:${match}`));

  out = out.replace(YT_ROOT_PATH, (_m, quote, path) => `${quote}${resolveRef(path)}${quote}`);
  out = out.replace(YT_IMPORT_PATH, (_m, path) => `import("${resolveRef(path)}")`);
  out = out.replace(YT_RELATIVE_API, (_m, quote, path) => {
    try {
      const abs = new URL(path, "https://www.youtube.com").href;
      return `${quote}${resolveRef(abs)}${quote}`;
    } catch {
      return `${quote}${path}${quote}`;
    }
  });

  out = out.replace(
    /https?:\\\/\\\/(?:www\.)?youtube\.com\\\/youtubei\\\/[^"'\\]+/gi,
    (escaped) => {
      const plain = escaped.replace(/\\\//g, "/");
      return resolveRef(plain).replace(/\//g, "\\/");
    },
  );

  out = out.replace(/https?:\/\/[^\s"'`)<\]]+/gi, (match) => resolveRef(match));

  return out;
}

const LARGE_JS_FAST_REWRITE_BYTES = 2 * 1024 * 1024;

function rewriteYouTubeDocumentFast(text, documentUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(documentUrl, sessionId, gatewayOrigin);
  return text.replace(
    /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|googlevideo\.com|ytimg\.com|gstatic\.com|googleapis\.com|ggpht\.com)[^\s"'`)<\]]+/gi,
    (match) => resolveRef(match),
  );
}

function rewriteJsDocument(js, jsFileUrl, gatewayOrigin, sessionId) {
  let hostname = "";
  try {
    hostname = new URL(jsFileUrl).hostname;
  } catch {
    /* ignore */
  }
  const isYt =
    /youtube|googlevideo|ytimg|gstatic|ggpht/i.test(hostname) ||
    /youtube|googlevideo|ytimg/i.test(jsFileUrl);
  if (isYt) {
    if (js.length >= LARGE_JS_FAST_REWRITE_BYTES) {
      return rewriteYouTubeDocumentFast(js, jsFileUrl, gatewayOrigin, sessionId);
    }
    return rewriteYouTubeDocument(js, jsFileUrl, gatewayOrigin, sessionId);
  }
  const { resolveRef } = createResolver(jsFileUrl, sessionId, gatewayOrigin);
  return js.replace(/https?:\/\/[^\s"'`)<\]]+/gi, (match) => resolveRef(match));
}

function rewriteJsonDocument(body, documentUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(documentUrl, sessionId, gatewayOrigin);
  return body.replace(
    /https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|googlevideo\.com|ytimg\.com|gstatic\.com|googleapis\.com)[^\s"',}\\]*/gi,
    (match) => resolveRef(match),
  );
}

function rewriteCssDocument(css, cssFileUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(cssFileUrl, sessionId, gatewayOrigin);
  let out = css.replace(/@import\s+(?:url\s*\(\s*)?["']?([^"')]+)["']?\s*\)?/gi, (m, u) => {
    const r = resolveRef(u.trim());
    return m.replace(u, r);
  });
  out = out.replace(/url\s*\(\s*([^\)]+)\s*\)/gi, (m, inner) => {
    const cleaned = String(inner).trim().replace(/^["']|["']$/g, "");
    if (!cleaned || cleaned.startsWith("data:")) return m;
    return `url("${resolveRef(cleaned)}")`;
  });
  return out;
}

function rewriteM3u8Playlist(text, playlistUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(playlistUrl, sessionId, gatewayOrigin);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) {
        if (t.includes("URI=")) {
          return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${resolveRef(uri)}"`);
        }
        return line;
      }
      return resolveRef(t);
    })
    .join("\n");
}

function rewriteHtmlDocument(html, documentUrl, gatewayOrigin, sessionId) {
  const { resolveRef } = createResolver(documentUrl, sessionId, gatewayOrigin);

  const ATTRS =
    "src|href|poster|action|data-src|data-href|data-poster|data-url|data-lazy-src|data-original|content";

  let out = stripBaseTags(html);
  out = stripSecurityMetaAndIntegrity(out, resolveRef);

  out = out.replace(
    new RegExp(`\\b(${ATTRS})\\s*=\\s*"([^"]*)"`, "gi"),
    (_m, attr, val) => `${attr}="${resolveRef(val)}"`,
  );
  out = out.replace(
    new RegExp(`\\b(${ATTRS})\\s*=\\s*'([^']*)'`, "gi"),
    (_m, attr, val) => `${attr}='${resolveRef(val)}'`,
  );

  out = out.replace(/\bsrcset\s*=\s*"([^"]*)"/gi, (_m, list) => {
    const pieces = list.split(",").map((part) => {
      const seg = part.trim().split(/\s+/);
      if (seg.length === 0) return part;
      const resolved = resolveRef(seg[0]);
      const rest = seg.slice(1).join(" ");
      return rest ? `${resolved} ${rest}` : resolved;
    });
    return `srcset="${pieces.join(", ")}"`;
  });

  out = out.replace(/url\s*\(\s*([^\)]+)\s*\)/gi, (m, inner) => {
    const cleaned = String(inner).trim().replace(/^["']|["']$/g, "");
    if (!cleaned || cleaned.startsWith("data:")) return m;
    return `url("${resolveRef(cleaned)}")`;
  });

  out = injectProxyRuntime(out, gatewayOrigin, sessionId, documentUrl);
  return out;
}

module.exports = {
  rewriteHtmlDocument,
  rewriteCssDocument,
  rewriteM3u8Playlist,
  rewriteJsDocument,
  rewriteYouTubeDocument,
  rewriteJsonDocument,
  createResolver,
  proxyResourcePrefix,
  stripBaseTags,
  stripSecurityMetaAndIntegrity,
};
