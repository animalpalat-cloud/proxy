/**
 * Global Express error handler.
 * Must be registered after all routes.
 */

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    console.error(
      "[server] Error after response started — skipping body:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const status = err.status || err.statusCode || 500;
  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  if (status >= 500) {
    console.error("[server]", err);
  }

  try {
    res.status(status).json({
      success: false,
      error: message,
      ...(err.code && { code: err.code }),
    });
  } catch (sendErr) {
    console.error(
      "[server] Failed to send error JSON:",
      sendErr instanceof Error ? sendErr.message : sendErr,
    );
  }
}

module.exports = { errorHandler };
