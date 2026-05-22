const express = require("express");
const env = require("../config/env");
const { createSession } = require("../lib/sessions");
const ipRoyal = require("../lib/ipRoyal");

const router = express.Router();

const ALLOWED_REGIONS = new Set(["us", "uk", "gb", "de", "fr", "ca", "es"]);

/**
 * Single exit point for JSON — avoids double-send & guarantees Content-Type.
 * @param {import("express").Response} res
 * @param {number} status
 * @param {Record<string, unknown>} payload
 */
function sendJson(res, status, payload) {
  if (res.headersSent) {
    console.warn("[/api/unblock] Attempted to send after headers were already sent — skipping.");
    return;
  }
  res.status(status).type("application/json").json(payload);
}

/**
 * Public gateway URL where IPRoyal-backed content is streamed (new tab).
 * @param {string} sessionId
 * @returns {string}
 */
function buildViewerUrl(sessionId) {
  const base = env.publicApiUrl?.replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "API_PUBLIC_URL is not set. Set it in server/.env to the public URL of this API (see DEPLOYMENT.md).",
    );
  }
  return `${base}/api/proxy/stream-or-view?session=${encodeURIComponent(sessionId)}`;
}

/**
 * @param {unknown} p
 * @returns {p is { success: true; data: { targetUrl: string; viewerUrl: string } }}
 */
function isValidUnblockSuccess(p) {
  if (!p || typeof p !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (p);
  if (o.success !== true) return false;
  const d = o.data;
  if (!d || typeof d !== "object") return false;
  const data = /** @type {Record<string, unknown>} */ (d);
  return typeof data.targetUrl === "string" && typeof data.viewerUrl === "string";
}

/**
 * Normalize and validate a target URL from the client.
 * @param {unknown} raw
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
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
 *
 * Body (JSON): { "url": "https://example.com", "region": "us" }
 */
router.post("/", async (req, res, next) => {
  try {
    if (req.body === undefined || req.body === null || typeof req.body !== "object") {
      console.log("[/api/unblock] Invalid or missing JSON body. Content-Type:", req.headers["content-type"]);
      return sendJson(res, 400, {
        success: false,
        error:
          'Expected a JSON body. Send Content-Type: application/json with { "url": "...", "region": "us" }.',
      });
    }

    const parsed = parseTargetUrl(req.body.url);

    if (!parsed.ok) {
      return sendJson(res, 400, {
        success: false,
        error: parsed.error,
      });
    }

    const regionRaw = req.body.region;
    const region =
      typeof regionRaw === "string" && ALLOWED_REGIONS.has(regionRaw.toLowerCase())
        ? regionRaw.toLowerCase()
        : "us";

    console.log("[/api/unblock] Incoming:", parsed.url, "region:", region);

    const configCheck = ipRoyal.validateConfig();
    if (!configCheck.ok) {
      console.log("[/api/unblock] IPRoyal config invalid:", configCheck.details);
      return sendJson(res, 503, {
        success: false,
        error: configCheck.error,
        details: configCheck.details,
      });
    }

    if (!env.publicApiUrl) {
      return sendJson(res, 503, {
        success: false,
        error: "API_PUBLIC_URL is not configured on the server.",
        details: ["Set API_PUBLIC_URL in server/.env to your public API base URL."],
      });
    }

    console.log(
      "[/api/unblock] Proxy:",
      ipRoyal.buildProxyUriForLog(region),
      "| transport: tunnel+axios | TLS MITM:",
      env.iproyal.tlsInsecure,
    );
    console.log("[/api/unblock] Probing target through IPRoyal…");

    const probe = await ipRoyal.probeTarget(parsed.url, region);

    if (!probe.ok) {
      console.log("[/api/unblock] Probe failed:", probe.message, probe.status ?? "");
      return sendJson(res, 502, {
        success: false,
        error:
          probe.message ||
          "Could not load the target through IPRoyal. Check credentials, host/port, and network.",
        details: probe.status ?? probe.details,
      });
    }

    let sessionId;
    try {
      const stickyRegion = ipRoyal.normalizeRegionKey(probe.regionUsed || region);
      sessionId = createSession({
        targetUrl: parsed.url,
        region: stickyRegion,
      });
    } catch (e) {
      console.error("[/api/unblock] Session create failed:", e);
      return sendJson(res, 500, {
        success: false,
        error: "Could not create a proxy session.",
      });
    }

    const viewerUrl = buildViewerUrl(sessionId);

    /** @type {{ success: true; data: { targetUrl: string; viewerUrl: string } }} */
    const payload = {
      success: true,
      data: {
        targetUrl: String(parsed.url),
        viewerUrl: String(viewerUrl),
      },
    };

    if (!isValidUnblockSuccess(payload)) {
      console.error("[/api/unblock] Built payload failed validation:", payload);
      return sendJson(res, 500, {
        success: false,
        error: "Internal error: invalid response shape.",
      });
    }

    console.log("[/api/unblock] Success — viewerUrl:", viewerUrl);
    return sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof ipRoyal.ProxyConfigError) {
      return sendJson(res, 503, {
        success: false,
        error: error.message,
        details: error.details,
      });
    }

    const msg = error instanceof Error ? error.message : String(error);
    console.error("[/api/unblock] IPRoyal error:", msg, error);
    if (!res.headersSent) {
      return sendJson(res, 500, {
        success: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Unexpected server error."
            : msg || "Unexpected server error.",
      });
    }
    next(error);
  }
});

module.exports = router;
