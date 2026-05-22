/**
 * Rewrites HTML/CSS/HLS/JS so every asset loads via /api/proxy/resource.
 * Fixes relative URLs (vd01ccf8fa2.variables.css) resolving to daddyproxy.com.
 */

/**
 * @param {string} documentUrl
 * @param {string} backendOrigin
 * @param {string} sessionId
 */
function createResolver(documentUrl, backendOrigin, sessionId) {
  const base = new URL(documentUrl);
  const sid = encodeURIComponent(sessionId);
  const proxyPrefix = `${backendOrigin}/api/proxy/resource?session=${sid}&url=`;

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
    if (t.startsWith(backendOrigin)) return t;

    const hashIdx = t.indexOf("#");
    const pathPart = hashIdx >= 0 ? t.slice(0, hashIdx) : t;
    const hash = hashIdx >= 0 ? t.slice(hashIdx) : "";

    if (!pathPart || pathPart === "#") return t;

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

/**
 * Runtime uses PAGE_BASE (real site URL), not document.baseURI (daddyproxy.com).
 */
function buildProxyRuntimeScript(backendOrigin, sessionId, pageUrl) {
  const O = JSON.stringify(backendOrigin);
  const S = JSON.stringify(sessionId);
  const B = JSON.stringify(pageUrl);
  return `<script id="openrelay-proxy-runtime">(function(){var O=${O},S=${S},B=${B},P=O+"/api/proxy/resource?session="+encodeURIComponent(S)+"&url=",FX=/\\.(css|js|mjs|png|woff2?|svg|m3u8|ts|mp4|vtt)(\\?|$)/i;function abs(u){if(/^https?:\\/\\//i.test(u))return u;if(u.indexOf("//")===0)return"https:"+u;if(u.indexOf("/")<0&&FX.test(u))return new URL(u,B).href;if(/^[a-z0-9][-a-z0-9.]*\\.[a-z]{2,}(\\/|:)/i.test(u)&&!FX.test(u))return"https://"+u.replace(/^\\/+/, "");return new URL(u,B).href}function px(u){if(!u||typeof u!=="string")return u;if(/^(data:|blob:|javascript:|mailto:|tel:)/i.test(u))return u;if(u.indexOf(P)===0)return u;var h="";var p=u;var i=u.indexOf("#");if(i>=0){p=u.slice(0,i);h=u.slice(i)}if(!p)return u;try{var a=abs(p);if(!/^https?:/i.test(a))return u;return P+encodeURIComponent(a)+h}catch(e){return u}}var of=window.fetch;window.fetch=function(i,n){if(typeof i==="string")i=px(i);else if(i&&typeof i==="object"&&i.url)i=new Request(px(i.url),i);return of.call(this,i,n)};var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,b,c){return xo.call(this,m,px(u),a,b,c)};function ps(proto,attr){try{var d=Object.getOwnPropertyDescriptor(proto,attr);if(!d||!d.set)return;var s=d.set;d.set=function(v){return s.call(this,px(v))};Object.defineProperty(proto,attr,d)}catch(e){}}ps(HTMLImageElement.prototype,"src");ps(HTMLScriptElement.prototype,"src");ps(HTMLLinkElement.prototype,"href");ps(HTMLMediaElement.prototype,"src");ps(HTMLSourceElement.prototype,"src");ps(HTMLIFrameElement.prototype,"src");var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(v&&typeof v==="string"&&/^(src|href|poster|action|data-src|data-href|data-url|data-poster)$/i.test(n))v=px(v);return sa.call(this,n,v)};var lc=document.createElement;document.createElement=function(tag){var el=lc.call(document,tag);if(tag&&/^(link|script|img|source|video|audio|iframe)$/i.test(tag)){var _sa=el.setAttribute;el.setAttribute=function(n,v){if(v&&typeof v==="string"&&/^(src|href|poster)$/i.test(n))v=px(v);return _sa.call(this,n,v)}}return el}})();</script>`;
}

function injectProxyRuntime(html, backendOrigin, sessionId, pageUrl) {
  const tag = buildProxyRuntimeScript(backendOrigin, sessionId, pageUrl);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  }
  return tag + html;
}

function rewriteCssDocument(css, cssFileUrl, backendOrigin, sessionId) {
  const { resolveRef } = createResolver(cssFileUrl, backendOrigin, sessionId);
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

function rewriteM3u8Playlist(text, playlistUrl, backendOrigin, sessionId) {
  const { resolveRef } = createResolver(playlistUrl, backendOrigin, sessionId);
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

/** Rewrite absolute https URLs inside proxied JS bundles. */
function rewriteJsDocument(js, jsFileUrl, backendOrigin, sessionId) {
  const { resolveRef } = createResolver(jsFileUrl, backendOrigin, sessionId);
  return js.replace(/https?:\/\/[^\s"'`)<\]]+/gi, (match) => resolveRef(match));
}

function rewriteHtmlDocument(html, documentUrl, backendOrigin, sessionId) {
  const { resolveRef } = createResolver(documentUrl, backendOrigin, sessionId);

  const ATTRS =
    "src|href|poster|action|data-src|data-href|data-poster|data-url|data-lazy-src|data-original|content";

  let out = html;

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

  out = out.replace(
    /<link([^>]*?)href\s*=\s*"([^"]*)"([^>]*)>/gi,
    (_m, pre, href, post) => `<link${pre}href="${resolveRef(href)}"${post}>`,
  );
  out = out.replace(
    /<script([^>]*?)src\s*=\s*"([^"]*)"([^>]*)>/gi,
    (_m, pre, src, post) => `<script${pre}src="${resolveRef(src)}"${post}>`,
  );

  out = injectProxyRuntime(out, backendOrigin, sessionId, documentUrl);
  return out;
}

module.exports = {
  rewriteHtmlDocument,
  rewriteCssDocument,
  rewriteM3u8Playlist,
  rewriteJsDocument,
  createResolver,
  injectProxyRuntime,
};
