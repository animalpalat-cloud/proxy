require("./loadEnv");

const { createApp } = require("./app");
const env = require("./config/env");

env.assertProductionEnv();

const app = createApp();

app.listen(env.port, env.bindHost, () => {
  const base = env.publicApiUrl || `http://${env.bindHost}:${env.port}`;
  const proxy = env.proxySeller;
  console.log(`OpenRelay API listening on ${env.bindHost}:${env.port}`);
  console.log(`Public API URL: ${base}`);
  const { getAllowedOrigins } = require("./lib/allowedOrigins");
  console.log(`CORS allowed origins: ${[...getAllowedOrigins()].join(", ") || "(none — set FRONTEND_URL)"}`);
  console.log(`Health: ${base.replace(/\/$/, "")}/api/health`);
  const transportLabel = proxy.usesSocks
    ? `SOCKS5 ${proxy.host}:${proxy.port || proxy.socksPort}`
    : `HTTP ${proxy.host}:${proxy.port || proxy.httpPort}`;
  console.log(`ProxySeller: ${proxy.host ? transportLabel : "(not configured — check server/.env)"}`);
  console.log(`ProxySeller transport mode: ${proxy.transport} scheme=${proxy.scheme}`);
  console.log(`Proxy timeouts: request=${proxy.requestTimeoutMs}ms probe=${proxy.probeTimeoutMs}ms`);
  if (proxy.authIp) {
    console.log(`ProxySeller whitelist IP (reference): ${proxy.authIp}`);
  }
  console.log(
    "[sessions] In-memory store is empty on startup — existing viewer tabs return 410 after server restart (node --watch). Unblock again after each restart.",
  );
});
