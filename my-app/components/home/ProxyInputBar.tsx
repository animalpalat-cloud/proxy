"use client";

/**
 * Posts to Express `POST /api/unblock`.
 * API base: NEXT_PUBLIC_API_URL or same-origin /api (see lib/api.ts).
 */
import { type FormEvent, useCallback, useState } from "react";
import {
  deriveViewerUrlFromSession,
  getUnblockPostUrl,
  normalizeViewerUrlForNewTab,
} from "@/lib/api";

export type ProxyRegion = "us" | "uk" | "de";

export type ProxyNavigatePayload = {
  url: string;
  region: ProxyRegion;
};

/** Successful JSON shape from the Express server (required fields) */
export type UnblockSuccessData = {
  targetUrl: string;
  viewerUrl: string;
  /** Present when API returns extended data; omitted with strict 2-field payload */
  region?: string;
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
  if (status >= 500) {
    return "The server had a problem. Please try again in a moment.";
  }
  return `Something went wrong (HTTP ${status}).`;
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

/**
 * Normalize backend JSON (handles minor key/shape drift).
 */
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

  const targetUrl =
    d.targetUrl ?? d.target_url ?? d.url;
  let viewerUrl =
    d.viewerUrl ?? d.viewer_url ?? d.gatewayUrl ?? d.proxyUrl;

  const sessionIdRaw =
    typeof d.sessionId === "string"
      ? d.sessionId
      : typeof d.session_id === "string"
        ? d.session_id
        : undefined;

  if (
    targetUrl === undefined ||
    targetUrl === null
  ) {
    return null;
  }

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
    region:
      typeof d.region === "string"
        ? d.region
        : undefined,
    sessionId: sessionIdRaw,
    proxyConfigured:
      typeof d.proxyConfigured === "boolean"
        ? d.proxyConfigured
        : undefined,
  };
}

export function ProxyInputBar({
  url,
  onUrlChange,
  onNavigate,
}: ProxyInputBarProps) {
  const [region, setRegion] = useState<ProxyRegion>("us");
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

      const payload: ProxyNavigatePayload = { url: trimmed, region };

      try {
        const res = await fetch(getUnblockPostUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: payload.url, region: payload.region }),
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
              `Ensure the Express API is running and BACKEND_URL / NEXT_PUBLIC_API_URL are set (see DEPLOYMENT.md).`,
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

        const raw = parsedSuccess;
        const data: UnblockSuccessData = {
          targetUrl: raw.targetUrl,
          viewerUrl: normalizeViewerUrlForNewTab(raw.viewerUrl),
          region: raw.region ?? region,
          proxyConfigured: raw.proxyConfigured ?? true,
          sessionId:
            raw.sessionId ??
            (() => {
              try {
                const u = new URL(raw.viewerUrl);
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
    [url, region, onNavigate],
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
            placeholder="https://example.com"
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="region" className="sr-only">
              Server location
            </label>
            <select
              id="region"
              name="region"
              value={region}
              onChange={(e) => {
                setRegion(e.target.value as ProxyRegion);
                if (session) clearAlerts();
                if (error) setError(null);
              }}
              disabled={isSubmitting}
              className="w-full appearance-none rounded-xl border border-white/10 bg-slate-950/60 py-3.5 pl-4 pr-11 text-sm text-slate-100 outline-none ring-cyan-400/40 transition focus:border-cyan-500/50 focus:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <option value="us">🇺🇸 United States</option>
              <option value="uk">🇬🇧 United Kingdom</option>
              <option value="de">🇩🇪 Germany</option>
            </select>
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Spinner />
                <span className="flex flex-col items-start text-left leading-tight">
                  <span>Contacting server…</span>
                  <span className="text-[0.65rem] font-normal opacity-90">
                    Waiting for relay
                  </span>
                </span>
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
          className="mt-4 space-y-3 rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-emerald-500/5 px-4 py-4 text-sm shadow-inner shadow-cyan-500/10"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-cyan-100">Session active</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                session.proxyConfigured !== false
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                  : "border border-amber-500/35 bg-amber-500/10 text-amber-100"
              }`}
            >
              Proxy: {session.proxyConfigured !== false ? "configured" : "not connected"}
            </span>
          </div>
          {popupBlocked ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            >
              <p className="font-medium text-amber-50">Pop-up blocked</p>
              <p className="mt-1 text-amber-200/95">
                Open the proxied page using the link below.
              </p>
            </div>
          ) : null}
          {serverMessage ? (
            <p className="text-xs leading-relaxed text-slate-400">{serverMessage}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a
              href={session.viewerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-500/40 transition hover:bg-cyan-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              Open proxied page
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
          <dl className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10 sm:col-span-2">
              <dt className="font-medium uppercase tracking-wide text-slate-500">
                Proxied viewer (IPRoyal)
              </dt>
              <dd className="mt-0.5 break-all font-mono text-[0.8rem] text-emerald-200/95">
                {session.viewerUrl}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10">
              <dt className="font-medium uppercase tracking-wide text-slate-500">Target</dt>
              <dd className="mt-0.5 break-all font-mono text-[0.8rem] text-cyan-200/95">
                {session.targetUrl}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10">
              <dt className="font-medium uppercase tracking-wide text-slate-500">Region</dt>
              <dd className="mt-0.5 font-medium uppercase text-slate-100">
                {session.region ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2 rounded-lg bg-slate-950/40 px-3 py-2 ring-1 ring-white/10">
              <dt className="font-medium uppercase tracking-wide text-slate-500">Session ID</dt>
              <dd className="mt-0.5 break-all font-mono text-[0.8rem] text-slate-200">
                {session.sessionId && session.sessionId.length > 0 ? session.sessionId : "—"}
              </dd>
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
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
