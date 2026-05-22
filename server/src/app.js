const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const proxyViewRouter = require("./routes/proxyView");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");
const env = require("./config/env");

function createApp() {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (curl, server-to-server) with no Origin header
        if (!origin) {
          return callback(null, true);
        }
        if (env.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json({ limit: "32kb" }));

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
  // IPRoyal stream gateway (must match frontend: GET /api/proxy/stream-or-view?session=...)
  app.use("/api/proxy", proxyViewRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
