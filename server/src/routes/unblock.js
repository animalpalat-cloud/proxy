const express = require("express");
const env = require("../config/env");
const sessions = require("../lib/sessions");
const proxySeller = require("../lib/proxySeller");
const { buildUpstreamRequestHeaders } = require("../lib/upstreamHeaders");

const router = express.Router();

function sendJson(res, status, payload) {
  if (res.headersSent) {
    console.warn("[/api/unblock] Attempted to send after headers were already sent — skipping.");
    return;
  }
  res.status(status).type("application/json").json(payload);
}

function buildViewerUrl(sessionId) {
  const id = sessions.normalizeSessionId(sessionId);
  const sitePath = `/api/proxy/site/${id}/`;
  const frontend = env.frontendOrigins[0]?.replace(/\/$/, "");
  if (frontend) {
    return `${frontend}${sitePath}`;
  }
  const base = env.publicApiUrl?.replace(/\/$/, "");
  if (base) {
    return `${base}${sitePath}`;
  }
  return sitePath;
}

function isValidUnblockSuccess(p) {
  if (!p || typeof p !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (p);
  if (o.success !== true) return false;
  const d = o.data;
  if (!d || typeof d !== "object") return false;
  const data = /** @type {Record<string, unknown>} */ (d);
  return (
    typeof data.targetUrl === "string" &&
    typeof data.viewerUrl === "string" &&
    typeof data.sessionId === "string" &&
    data.sessionId.length > 0
  );
}

function parseTargetUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "A target URL is required in the request body." };
  }

  const trimmed = raw.trim();

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProtocol);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: "Only http and https URLs are supported." };
    }

    if (!parsed.hostname.includes(".")) {
      return { ok: false, error: "URL hostname appears invalid." };
    }

    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, error: "Invalid URL format." };
  }
}

/**
 * POST /api/unblock
 * Body (JSON): { "url": "https://example.com" }
 */
router.post("/", async (req, res, next) => {
  let sessionId = null;

  try {
    if (req.body === undefined || req.body === null || typeof req.body !== "object") {
      return sendJson(res, 400, {
        success: false,
        error:
          'Expected a JSON body. Send Content-Type: application/json with { "url": "https://..." }.',
      });
    }

    const parsed = parseTargetUrl(req.body.url);

    if (!parsed.ok) {
      return sendJson(res, 400, {
        success: false,
        error: parsed.error,
      });
    }

    console.log("[/api/unblock] Incoming:", parsed.url, "| mode: auto (Thailand rotating)");

    const configCheck = proxySeller.validateConfig();
    if (!configCheck.ok) {
      console.error("[/api/unblock] ProxySeller config invalid:", configCheck.details);
      return sendJson(res, 503, {
        success: false,
        error: configCheck.error,
        details: configCheck.details,
      });
    }

    if (!env.publicApiUrl && env.frontendOrigins.length === 0) {
      return sendJson(res, 503, {
        success: false,
        error: "API_PUBLIC_URL or FRONTEND_URL must be set on the server.",
      });
    }

    console.log("[/api/unblock] Proxy:", proxySeller.buildProxyUriForLog());

    sessionId = sessions.createSession({ targetUrl: parsed.url });

    const probeHeaders = buildUpstreamRequestHeaders(undefined, {
      targetUrl: parsed.url,
      pageUrl: parsed.url,
      assetRequest: false,
      streamRequest: false,
      cookieHeader: sessions.getUpstreamCookieHeader(sessionId, parsed.url),
    });

    let probe;
    try {
      probe = await proxySeller.probeTarget(parsed.url, {
        headers: probeHeaders,
        onSetCookies: (url, cookies) => {
          sessions.absorbSetCookies(sessionId, url, cookies);
        },
      });
    } catch (probeErr) {
      console.error("[/api/unblock] Probe threw:", probeErr);
      sessions.deleteSession(sessionId);
      sessionId = null;
      const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      return sendJson(res, 502, {
        success: false,
        error: `Proxy probe failed: ${msg}`,
        details:
          process.env.NODE_ENV !== "production" && probeErr instanceof proxySeller.ProxyFetchError
            ? probeErr.diagnostics
            : undefined,
      });
    }

    if (probe.ok && probe.softFail) {
      console.log(
        "[/api/unblock] Probe soft-pass (target HTTP 403) — session kept; viewer may show site block page",
      );
    } else if (!probe.ok) {
      console.error("[/api/unblock] Probe failed:", probe.message, probe.status ?? "");
      if (probe.diagnostics) {
        console.error("[/api/unblock] Probe diagnostics:", JSON.stringify(probe.diagnostics));
      }
      sessions.deleteSession(sessionId);
      sessionId = null;
      const devDetails =
        process.env.NODE_ENV !== "production" && probe.diagnostics
          ? probe.diagnostics
          : probe.status ?? probe.details;
      const status = probe.status === 403 ? 403 : 502;
      return sendJson(res, status, {
        success: false,
        error:
          probe.message ||
          "Could not load the target through ProxySeller. Check credentials, host/port, and network.",
        details: devDetails,
      });
    }

    if (!sessions.hasSession(sessionId)) {
      console.error("[/api/unblock] Session missing after successful probe — storeSize=", sessions.getStoreSize());
      return sendJson(res, 500, {
        success: false,
        error: "Session was not persisted. Restart may have cleared memory; try unblock again.",
      });
    }

    const viewerUrl = buildViewerUrl(sessionId);

    const payload = {
      success: true,
      data: {
        targetUrl: String(parsed.url),
        viewerUrl: String(viewerUrl),
        mode: "auto",
        proxyLabel: "All Regions (Thailand auto-rotate)",
        proxyConfigured: true,
        sessionId,
      },
    };

    if (!isValidUnblockSuccess(payload)) {
      console.error("[/api/unblock] Invalid success payload shape:", payload);
      sessions.deleteSession(sessionId);
      return sendJson(res, 500, {
        success: false,
        error: "Internal error: invalid response shape.",
      });
    }

    console.log(
      "[/api/unblock] Success — sessionId=",
      sessionId.slice(0, 12) + "…",
      "viewerUrl:",
      viewerUrl,
      "storeSize=",
      sessions.getStoreSize(),
    );
    return sendJson(res, 200, payload);
  } catch (error) {
    if (sessionId) {
      sessions.deleteSession(sessionId);
    }

    if (error instanceof proxySeller.ProxyConfigError) {
      console.error("[/api/unblock] ProxyConfigError:", error.message, error.details);
      return sendJson(res, 503, {
        success: false,
        error: error.message,
        details: error.details,
      });
    }

    const msg = error instanceof Error ? error.message : String(error);
    console.error("[/api/unblock] Unhandled error:", msg);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    if (!res.headersSent) {
      return sendJson(res, 500, {
        success: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Unexpected server error."
            : msg || "Unexpected server error.",
        details:
          process.env.NODE_ENV !== "production" && error instanceof Error
            ? { name: error.name, message: error.message }
            : undefined,
      });
    }
    next(error);
  }
});

module.exports = router;
