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
  console.log(
    `ProxySeller: ${proxy.host ? `${proxy.host}:${proxy.port}` : "(not configured — check server/.env)"}`,
  );
  if (proxy.authIp) {
    console.log(`ProxySeller whitelist IP (reference): ${proxy.authIp}`);
  }
  console.log(
    "[sessions] In-memory store is empty on startup — existing viewer tabs return 410 after server restart (node --watch). Unblock again after each restart.",
  );
});
