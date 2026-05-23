"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { decodeUvUrl } from "@/lib/uvCodec";
import { ensureUltravioletReady } from "@/lib/ultraviolet";

export default function UvServicePage() {
  const params = useParams();
  const encoded =
    typeof params.encoded === "string"
      ? params.encoded
      : Array.isArray(params.encoded)
        ? params.encoded.join("/")
        : "";

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Starting Ultraviolet…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const target = decodeUvUrl(encoded);
        setStatus(`Loading ${target} through proxy…`);
        await ensureUltravioletReady();
        if (cancelled) return;
        // First navigation may occur before the SW controls this scope — one reload fixes it.
        if (!navigator.serviceWorker.controller) {
          window.location.reload();
          return;
        }
        setStatus(`Proxy active for ${target}`);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start proxy session.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [encoded]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <p className="max-w-lg text-center text-red-300">{error}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-200">
      <p className="text-sm">{status}</p>
    </main>
  );
}
