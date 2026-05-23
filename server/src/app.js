const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const proxyViewRouter = require("./routes/proxyView");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");
const env = require("./config/env");
const { CORS_ALLOW_HEADERS } = require("./lib/upstreamHeaders");
const { getAllowedOrigins, isOriginAllowed } = require("./lib/allowedOrigins");

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Nginx terminates TLS and sets X-Forwarded-* — required for correct Origin/cookies
  app.set("trust proxy", 1);

  const allowedList = [...getAllowedOrigins()];

  app.use(
    cors({
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }
        console.warn(
          `[cors] Rejected origin="${origin || "(none)"}" allowed=[${allowedList.join(", ")}]`,
        );
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowedHeaders: CORS_ALLOW_HEADERS,
      exposedHeaders: [
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "Content-Type",
      ],
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
