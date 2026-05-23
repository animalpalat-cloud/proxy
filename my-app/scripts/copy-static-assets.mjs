import { cp, mkdir } from "node:fs/promises";
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

const bareClientSrc = join(root, "node_modules", "@tomphttp", "bare-client", "dist", "index.js");
await cp(bareClientSrc, join(publicDir, "baremux", "bare-client.mjs"));

console.log("Copied Ultraviolet → public/uv");
console.log("Copied bare-mux → public/baremux");
console.log("Copied bare-client → public/baremux/bare-client.mjs");
