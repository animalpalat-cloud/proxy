/*global UVServiceWorker,__uv$config*/
/*
 * Ultraviolet service worker entry (served from /uv/sw.js).
 * bare-mux assets must bypass UV — proxied fetches for worker.js hang forever.
 */
importScripts('uv.bundle.js');
importScripts('uv.config.js');
importScripts(__uv$config.sw || 'uv.sw.js');

const uv = new UVServiceWorker();

const BARE_MUX_BYPASS_FILES = new Set(['worker.js', 'index.mjs', 'bare-client.mjs']);

function shouldBypassUltraviolet(url) {
  const { pathname } = url;
  if (
    pathname.startsWith('/baremux/') ||
    pathname.startsWith('/bare/') ||
    pathname === '/bare' ||
    pathname === '/baremux-worker.js'
  ) {
    return true;
  }
  const leaf = pathname.split('/').pop() || '';
  return BARE_MUX_BYPASS_FILES.has(leaf);
}

async function handleProxiedRequest(event) {
  if (uv.route(event)) {
    return await uv.fetch(event);
  }
  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (shouldBypassUltraviolet(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(handleProxiedRequest(event));
});
