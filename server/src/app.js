const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const proxyViewRouter = require("./routes/proxyView");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");
const env = require("./config/env");
const { CORS_ALLOW_HEADERS } = require("./lib/upstreamHeaders");

function createApp() {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (env.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }
        try {
          const { hostname } = new URL(origin);
          if (
            !env.isProduction &&
            (hostname === "localhost" || hostname === "127.0.0.1")
          ) {
            return callback(null, true);
          }
        } catch {
          /* reject */
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowedHeaders: CORS_ALLOW_HEADERS,
      exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "Content-Type"],
    }),
  );

  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "OpenRelay API",
      version: "1.0.0",
      endpoints: {
        health: "GET /api/health",
        unblock: "POST /api/unblock",
        proxyStream: "GET /api/proxy/stream-or-view?session= (also /api/proxy/view)",
      },
    });
  });

  app.use("/api", apiRoutes);
  app.use("/api/proxy", proxyViewRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
