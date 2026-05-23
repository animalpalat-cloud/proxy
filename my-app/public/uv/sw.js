/*global UVServiceWorker,__uv$config*/
/*
 * Ultraviolet service worker entry (served from /uv/sw.js).
 * bare-mux and /bare/ must bypass UV — otherwise worker.js and Bare API hang.
 */
importScripts('uv.bundle.js');
importScripts('uv.config.js');
importScripts(__uv$config.sw || 'uv.sw.js');

const uv = new UVServiceWorker();

function isBareMuxOrBareAsset(pathname) {
  return (
    pathname.startsWith('/baremux/') ||
    pathname.startsWith('/bare/') ||
    pathname === '/bare'
  );
}

async function handleRequest(event) {
  const url = new URL(event.request.url);

  if (isBareMuxOrBareAsset(url.pathname)) {
    return fetch(event.request);
  }

  if (uv.route(event)) {
    return await uv.fetch(event);
  }

  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});
