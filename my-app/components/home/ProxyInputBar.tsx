"use client";

import { type FormEvent, useCallback, useState } from "react";
import { buildProxiedPath, normalizeTargetUrl } from "@/lib/uvCodec";
import { ensureUltravioletReady } from "@/lib/ultraviolet";

export type ProxyNavigatePayload = {
  url: string;
};

type ProxyInputBarProps = {
  url: string;
  onUrlChange: (value: string) => void;
  onNavigate?: (payload: ProxyNavigatePayload) => void;
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

export function ProxyInputBar({ url, onUrlChange, onNavigate }: ProxyInputBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
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

      try {
        const targetUrl = normalizeTargetUrl(trimmed);
        await ensureUltravioletReady();
        onNavigate?.({ url: targetUrl });

        const path = buildProxiedPath(targetUrl);
        const opened = window.open(path, "_blank", "noopener,noreferrer");
        setPopupBlocked(!opened);
        if (!opened) {
          window.location.assign(path);
        }
      } catch (cause) {
        const msg =
          cause instanceof Error ? cause.message : "Something went wrong while starting the proxy.";
        setError(
          msg.includes("Service workers")
            ? `${msg} Use HTTPS in production or Chromium for local testing.`
            : msg,
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [url, onNavigate],
  );

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
            <span>Ultraviolet + ProxySeller SOCKS5</span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Spinner />
                <span>Starting proxy…</span>
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                Open in proxy
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
          <p className="font-medium text-red-50">Unable to start proxy</p>
          <p className="mt-1 text-red-200/95">{error}</p>
        </div>
      )}

      {popupBlocked && !error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          Pop-up blocked — allow pop-ups for this site or use the address bar after submitting.
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
