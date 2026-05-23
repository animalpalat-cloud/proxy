"use client";

import { type FormEvent, useCallback, useState } from "react";
import {
  deriveViewerUrlFromSession,
  getUnblockPostUrl,
  normalizeViewerUrlForNewTab,
} from "@/lib/api";

export type ProxyNavigatePayload = {
  url: string;
};

export type UnblockSuccessData = {
  targetUrl: string;
  viewerUrl: string;
  mode?: string;
  proxyLabel?: string;
  sessionId?: string;
  proxyConfigured?: boolean;
};

type ProxyInputBarProps = {
  url: string;
  onUrlChange: (value: string) => void;
  onNavigate?: (payload: ProxyNavigatePayload & { response: UnblockSuccessData }) => void;
};

function looksLikeUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    return Boolean(u.hostname.includes("."));
  } catch {
    return false;
  }
}

function errorMessageFallback(status: number): string {
  if (status === 400) {
    return "The server could not accept this request. Check the URL and try again.";
  }
  if (status === 404) {
    return "The unblock API was not found. Check that the API is running and NEXT_PUBLIC_API_URL / Nginx /api routing is correct.";
  }
  if (status === 502) {
    return "Could not reach the target through the proxy. Check ProxySeller credentials and IP whitelist.";
  }
  if (status >= 500) {
    return "The server had a problem. Please try again in a moment.";
  }
  return `Something went wrong (HTTP ${status}).`;
}

/** Extract session id from /api/proxy/site/:id/ viewer URLs. */
function sessionIdFromViewerUrl(href: string): string {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.origin : undefined);
    const m = u.pathname.match(/\/api\/proxy\/site\/([^/]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : "";
  } catch {
    return "";
  }
}

function extractApiError(body: unknown, status: number): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    const msg = (body as { error: string }).error.trim();
    if (msg) return msg;
  }
  return errorMessageFallback(status);
}

function parseUnblockSuccess(body: unknown): UnblockSuccessData | null {
  if (body === null || body === undefined) return null;

  let root: Record<string, unknown>;
  if (typeof body === "string") {
    try {
      root = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof body === "object") {
    root = body as Record<string, unknown>;
  } else {
    return null;
  }

  const ok =
    root.success === true ||
    root.success === "true" ||
    root.ok === true;
  if (!ok) return null;

  const rawData = root.data;
  if (!rawData || typeof rawData !== "object") return null;
  const d = rawData as Record<string, unknown>;

  const targetUrl = d.targetUrl ?? d.target_url ?? d.url;
  let viewerUrl = d.viewerUrl ?? d.viewer_url ?? d.gatewayUrl ?? d.proxyUrl;

  const sessionIdRaw =
    typeof d.sessionId === "string"
      ? d.sessionId
      : typeof d.session_id === "string"
        ? d.session_id
        : undefined;

  if (targetUrl === undefined || targetUrl === null) return null;

  const ts = String(targetUrl).trim();
  if (!ts) return null;

  let vu =
    viewerUrl !== undefined && viewerUrl !== null
      ? String(viewerUrl).trim()
      : "";

  if (!vu && sessionIdRaw) {
    vu = deriveViewerUrlFromSession(sessionIdRaw);
  }

  if (!vu) return null;

  return {
    targetUrl: ts,
    viewerUrl: vu,
    mode: typeof d.mode === "string" ? d.mode : "auto",
    proxyLabel:
      typeof d.proxyLabel === "string"
        ? d.proxyLabel
        : "All Regions (auto)",
    sessionId: sessionIdRaw,
    proxyConfigured:
      typeof d.proxyConfigured === "boolean"
        ? d.proxyConfigured
        : true,
  };
}

export function ProxyInputBar({
  url,
  onUrlChange,
  onNavigate,
}: ProxyInputBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<UnblockSuccessData | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSession(null);
      setServerMessage(null);
      setPopupBlocked(false);

      const trimmed = url.trim();
      if (!trimmed) {
        setError("Enter a website URL to continue.");
        return;
      }
      if (!looksLikeUrl(trimmed)) {
        setError("That does not look like a valid URL.");
        return;
      }

      setError(null);
      setIsSubmitting(true);

      const payload: ProxyNavigatePayload = { url: trimmed };

      try {
        const res = await fetch(getUnblockPostUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: payload.url }),
        });

        const contentType = res.headers.get("content-type") || "";
        let body: unknown;
        if (contentType.includes("application/json")) {
          try {
            body = await res.json();
          } catch {
            body = null;
          }
        } else {
          try {
            const text = await res.text();
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
        }

        if (!res.ok) {
          setError(extractApiError(body, res.status));
          return;
        }

        if (body === null || body === undefined) {
          setError(
            `Received an empty response (Content-Type: ${contentType || "unknown"}). ` +
              `Ensure the Express API is running and BACKEND_URL is set (see DEPLOYMENT.md).`,
          );
          return;
        }

        const parsedSuccess = parseUnblockSuccess(body);
        if (!parsedSuccess) {
          const preview =
            typeof body === "object"
              ? JSON.stringify(body).slice(0, 280)
              : String(body).slice(0, 280);
          setError(
            "Received an unexpected response from the server. Expected JSON: " +
              `{ "success": true, "data": { "targetUrl": "...", "viewerUrl": "..." } }. ` +
              (preview ? `Got: ${preview}` : ""),
          );
          return;
        }

        const data: UnblockSuccessData = {
          targetUrl: parsedSuccess.targetUrl,
          viewerUrl: normalizeViewerUrlForNewTab(parsedSuccess.viewerUrl),
          mode: parsedSuccess.mode ?? "auto",
          proxyLabel: parsedSuccess.proxyLabel ?? "All Regions (auto)",
          proxyConfigured: parsedSuccess.proxyConfigured ?? true,
          sessionId:
            parsedSuccess.sessionId ??
            sessionIdFromViewerUrl(parsedSuccess.viewerUrl) ??
            (() => {
              try {
                const u = new URL(parsedSuccess.viewerUrl);
                return u.searchParams.get("session") ?? "";
              } catch {
                return "";
              }
            })(),
        };
        setSession(data);
        const topMessage =
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof (body as { message: unknown }).message === "string"
            ? (body as { message: string }).message
            : null;
        setServerMessage(topMessage);
        onNavigate?.({ ...payload, response: data });

        try {
          const opened = window.open(
            normalizeViewerUrlForNewTab(data.viewerUrl),
            "_blank",
            "noopener,noreferrer",
          );
          setPopupBlocked(!opened);
        } catch {
          setPopupBlocked(true);
        }
      } catch (cause) {
        const isOffline =
          cause instanceof TypeError &&
          /fetch|failed|network/i.test(String(cause.message));

        setError(
          isOffline
            ? "Unable to reach the API. Verify the backend is running, BACKEND_URL (Next rewrite), and NEXT_PUBLIC_API_URL if using a separate API host."
            : "Something went wrong while contacting the server. Please try again.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [url, onNavigate],
  );

  const clearAlerts = () => {
    setError(null);
    setSession(null);
    setServerMessage(null);
    setPopupBlocked(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900/50 p-4 shadow-xl shadow-black/30 backdrop-blur-md sm:p-5 md:max-w-4xl lg:backdrop-blur-xl">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="proxy-url" className="sr-only">
            Website URL
          </label>
          <input
            id="proxy-url"
            type="text"
            name="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://tiktok.com or https://youtube.com"
            value={url}
            onChange={(e) => {
              onUrlChange(e.target.value);
              if (error) setError(null);
              if (session) clearAlerts();
            }}
            disabled={isSubmitting}
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-500 shadow-inner outline-none ring-cyan-400/40 transition focus:border-cyan-500/50 focus:ring-2 disabled:pointer-events-none disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100"
            role="status"
          >
            <span className="text-base" aria-hidden>
              🌐
            </span>
            <span>Thailand auto-rotating proxy (ProxySeller)</span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Spinner />
                <span>Contacting server…</span>
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                Unblock Website
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100"
        >
          <p className="font-medium text-red-50">Unable to unblock</p>
          <p className="mt-1 text-red-200/95">{error}</p>
        </div>
      )}

      {session && !error && (
        <div
          role="status"
          className="mt-4 space-y-3 rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-emerald-500/5 px-4 py-4 text-sm"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-cyan-100">Session active</p>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
              Proxy: {session.proxyConfigured !== false ? "configured" : "not connected"}
            </span>
          </div>
          {popupBlocked ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            >
              Pop-up blocked — use the link below to open the proxied page.
            </div>
          ) : null}
          <a
            href={session.viewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-500/40"
          >
            Open proxied page
          </a>
          <dl className="grid gap-2 text-xs text-slate-300">
            <div className="rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10">
              <dt className="font-medium uppercase tracking-wide text-slate-500">Target</dt>
              <dd className="mt-0.5 break-all font-mono text-cyan-200/95">{session.targetUrl}</dd>
            </div>
            <div className="rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10">
              <dt className="font-medium uppercase tracking-wide text-slate-500">Proxy</dt>
              <dd className="mt-0.5 text-slate-100">{session.proxyLabel ?? "All Regions (auto)"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 shrink-0 animate-spin text-slate-950"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
