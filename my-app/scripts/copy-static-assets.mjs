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

// bare-mux setTransport() does: `const { default: BareTransport } = await import(path)`
let bareClient = await readFile(bareClientDest, "utf8");
if (!/export\s*\{[^}]*\bdefault\b/.test(bareClient)) {
  bareClient = bareClient.replace(
    "export { BareClient,",
    "export { BareClient as default, BareClient,",
  );
  await writeFile(bareClientDest, bareClient);
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
    sw: '/uv/uv.sw.js',
};
`;
await writeFile(join(publicDir, "uv", "uv.config.js"), uvConfig);

console.log("Copied Ultraviolet → public/uv");
console.log("Copied bare-mux → public/baremux");
console.log("Copied bare-client → public/baremux/bare-client.mjs (default export patched)");
console.log("Wrote public/uv/uv.config.js (prefix /uv/service/, /bare/ via bare-mux)");
