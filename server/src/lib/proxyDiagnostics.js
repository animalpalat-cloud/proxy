/**
 * Structured logging and error formatting for ProxySeller CONNECT/TLS failures.
 */
const env = require("../config/env");

/**
 * @param {unknown} err
 */
function classifyPhase(err) {
  const msg = String(err instanceof Error ? err.message : err || "").toLowerCase();
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";

  if (/connect aborted|proxy authentication|407|403 forbidden/i.test(msg)) {
    return "proxy_connect";
  }
  if (
    /secure tls connection|alpn|handshake|econnreset|socket disconnected|tls/i.test(msg) ||
    code === "ERR_ALPN_NEGOTIATION_FAILED" ||
    code === "ECONNRESET" ||
    code === "EPROTO"
  ) {
    return "tls_handshake";
  }
  if (/timeout|etimedout|abort/i.test(msg) || code === "ETIMEDOUT" || code === "ECONNABORTED") {
    return "timeout";
  }
  return "unknown";
}

/**
 * @param {unknown} err
 * @param {{ transport?: string; alpnProfile?: string; targetUrl?: string; attempt?: number }} [ctx]
 */
function formatProxyError(err, ctx = {}) {
  const message = err instanceof Error ? err.message : String(err || "unknown");
  const code =
    err && typeof err === "object" && "code" in err && err.code != null
      ? String(err.code)
      : undefined;
  const cause =
    err && typeof err === "object" && "cause" in err && err.cause instanceof Error
      ? err.cause.message
      : undefined;

  let host;
  let port;
  if (err && typeof err === "object") {
    if ("host" in err && err.host) host = String(err.host);
    if ("port" in err && err.port != null) port = Number(err.port);
  }

  const { host: proxyHost, port: proxyPort } = env.proxySeller;

  return {
    code,
    message,
    cause,
    transport: ctx.transport ?? "unknown",
    alpnProfile: ctx.alpnProfile ?? "unknown",
    phase: classifyPhase(err),
    host: host ?? proxyHost,
    port: port ?? proxyPort,
    targetUrl: ctx.targetUrl,
    attempt: ctx.attempt,
    proxy: proxyHost && proxyPort ? `${proxyHost}:${proxyPort}` : undefined,
    stackSnippet:
      err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 4).join("\n")
        : undefined,
  };
}

/**
 * @param {{ transport: string; alpnProfile: string; targetUrl?: string; attempt?: number }} ctx
 */
function logProxyAttempt(ctx) {
  if (!env.proxyDebug) return;
  console.log(
    `[proxySeller] TRY transport=${ctx.transport} alpn=${ctx.alpnProfile}` +
      (ctx.targetUrl ? ` target=${ctx.targetUrl}` : "") +
      (ctx.attempt != null ? ` attempt=${ctx.attempt}` : ""),
  );
}

/**
 * @param {{ transport: string; alpnProfile: string; targetUrl?: string; attempt?: number }} ctx
 * @param {unknown} err
 */
function logProxyFailure(ctx, err) {
  const d = formatProxyError(err, ctx);
  const line =
    `[proxySeller] FAIL transport=${d.transport} alpn=${d.alpnProfile} phase=${d.phase}` +
    (d.code ? ` code=${d.code}` : "") +
    (d.targetUrl ? ` target=${d.targetUrl}` : "") +
    (d.proxy ? ` proxy=${d.proxy}` : "") +
    ` msg=${d.message}`;
  console.error(line);
  if (env.proxyDebug && d.stackSnippet) {
    console.error(d.stackSnippet);
  }
}

/**
 * @param {string} message
 * @param {ReturnType<typeof formatProxyError>} diagnostics
 */
function logProxySummary(message, diagnostics) {
  console.error(`[proxySeller] ${message}`, JSON.stringify(diagnostics, null, 0));
}

module.exports = {
  classifyPhase,
  formatProxyError,
  logProxyAttempt,
  logProxyFailure,
  logProxySummary,
};
