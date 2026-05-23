/**
 * Prevent ERR_HTTP_HEADERS_SENT when proxy streams fail mid-response.
 */

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  if (res.headersSent) {
    return false;
  }
  try {
    res.status(status).type("application/json").json(payload);
    return true;
  } catch (err) {
    console.error("[safeResponse] sendJson failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} body
 * @param {string} [contentType]
 */
function sendText(res, status, body, contentType = "text/plain") {
  if (res.headersSent) {
    return false;
  }
  try {
    res.status(status).type(contentType).send(body);
    return true;
  } catch (err) {
    console.error("[safeResponse] sendText failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {unknown} err
 * @param {{ next?: import('express').NextFunction; logTag?: string }} [opts]
 */
function handleRouteError(res, req, err, opts = {}) {
  const tag = opts.logTag || "route";
  const msg = err instanceof Error ? err.message : String(err);

  if (res.headersSent) {
    console.error(`[${tag}] Error after response started (not sending again):`, msg);
    return;
  }

  console.error(`[${tag}]`, msg);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }

  sendText(res, 502, msg || "Proxy error.");
}

module.exports = {
  sendJson,
  sendText,
  handleRouteError,
};
