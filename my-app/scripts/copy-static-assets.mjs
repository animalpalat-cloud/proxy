import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "public");

const { uvPath } = require("@titaniumnetwork-dev/ultraviolet");
const { baremuxPath } = require("@mercuryworkshop/bare-mux/node");

await mkdir(publicDir, { recursive: true });
await cp(uvPath, join(publicDir, "uv"), { recursive: true });
await cp(baremuxPath, join(publicDir, "baremux"), { recursive: true });

const bareClientDest = join(publicDir, "baremux", "bare-client.mjs");
const bareClientSrc = join(root, "node_modules", "@tomphttp", "bare-client", "dist", "index.js");
await cp(bareClientSrc, bareClientDest);

// Root-level worker script — outside UV scope (/uv/service/) so the SW never proxies it.
await cp(join(publicDir, "baremux", "worker.js"), join(publicDir, "baremux-worker.js"));

// bare-mux setTransport() does: `const { default: BareTransport } = await import(path)`
let bareClient = await readFile(bareClientDest, "utf8");
if (!/export\s*\{[^}]*\bdefault\b/.test(bareClient)) {
  bareClient = bareClient.replace(
    "export { BareClient,",
    "export { BareClient as default, BareClient,",
  );
  await writeFile(bareClientDest, bareClient);
}

// Do not register the page-side SW listener that spawns a second SharedWorker on getPort.
for (const bareMuxBundle of ["index.mjs", "index.js"]) {
  const bareMuxPath = join(publicDir, "baremux", bareMuxBundle);
  let bareMux = await readFile(bareMuxPath, "utf8");
  if (bareMux.includes("this.createChannel(e,!0)")) {
    bareMux = bareMux.replaceAll("this.createChannel(e,!0)", "this.createChannel(e,!1)");
    await writeFile(bareMuxPath, bareMux);
    console.log(`Patched ${bareMuxBundle}: disable duplicate getPort SharedWorker`);
  }
}

const uvConfig = `/*global Ultraviolet*/
self.__uv$config = {
    prefix: '/uv/service/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv/uv.handler.js',
    client: '/uv/uv.client.js',
    bundle: '/uv/uv.bundle.js',
    config: '/uv/uv.config.js',
    sw: 'uv.sw.js',
};
`;
await writeFile(join(publicDir, "uv", "uv.config.js"), uvConfig);

const uvSw = `/*global UVServiceWorker,__uv$config*/
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
`;
await writeFile(join(publicDir, "uv", "sw.js"), uvSw);

console.log("Copied Ultraviolet → public/uv");
console.log("Copied bare-mux → public/baremux");
console.log("Copied bare-client → public/baremux/bare-client.mjs (default export patched)");
console.log("Wrote public/uv/uv.config.js (prefix /uv/service/, /bare/ via bare-mux)");
