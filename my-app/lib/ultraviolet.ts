"use client";

/**
 * Register Ultraviolet service worker and configure bare-mux → Rust Bare server (/bare/).
 */

let initPromise: Promise<void> | null = null;

export async function ensureUltravioletReady(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { BareMuxConnection } = await import("@mercuryworkshop/bare-mux");
    const connection = new BareMuxConnection("/baremux/worker.js");
    await connection.setTransport("/baremux/bare-client.mjs", []);

    const registration = await navigator.serviceWorker.register("/uv/uv.sw.js", {
      scope: "/uv/service/",
    });
    await navigator.serviceWorker.ready;
    if (registration.active) {
      registration.active.postMessage({ type: "baremuxinit" });
    }
  })();

  return initPromise;
}

export async function openProxiedUrl(targetUrl: string, newTab = true): Promise<void> {
  const { buildProxiedPath } = await import("./uvCodec");
  await ensureUltravioletReady();
  const path = buildProxiedPath(targetUrl);
  if (newTab) {
    const opened = window.open(path, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.assign(path);
    }
  } else {
    window.location.assign(path);
  }
}
