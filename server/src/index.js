require("dotenv").config();

const { createApp } = require("./app");
const env = require("./config/env");

env.assertProductionEnv();

const app = createApp();

app.listen(env.port, env.bindHost, () => {
  const base = env.publicApiUrl || `http://${env.bindHost}:${env.port}`;
  console.log(`OpenRelay API listening on ${env.bindHost}:${env.port}`);
  console.log(`Public API URL: ${base}`);
  console.log(`CORS origins: ${env.frontendOrigins.join(", ") || "(none — set FRONTEND_URL)"}`);
  console.log(`Health: ${base.replace(/\/$/, "")}/api/health`);
});
