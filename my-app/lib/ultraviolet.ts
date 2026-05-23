"use client";

/**
 * Register Ultraviolet service worker and configure bare-mux → same-origin /bare/ (Rust).
 *
 * bare-mux is loaded from /baremux/index.mjs (static ESM), not from npm, so production
 * minification does not break `BareMuxConnection` ("a is not a constructor").
 */

let initPromise: Promise<void> | null = null;

type BareMuxConnectionCtor = new (workerPath: string) => {
  setTransport(path: string, args: unknown[]): Promise<void>;
};

type BareMuxModule = {
  BareMuxConnection?: BareMuxConnectionCtor;
  default?: { BareMuxConnection?: BareMuxConnectionCtor };
};

async function loadBareMuxModule(): Promise<{ BareMuxConnection: BareMuxConnectionCtor }> {
  if (typeof window === "undefined") {
    throw new Error("bare-mux can only be loaded in the browser");
  }

  const moduleUrl = new URL("/baremux/index.mjs", window.location.origin).href;
  const mod = (await import(
    /* webpackIgnore: true */
    moduleUrl
  )) as BareMuxModule;

  const BareMuxConnection =
    mod.BareMuxConnection ?? mod.default?.BareMuxConnection;

  if (typeof BareMuxConnection !== "function") {
    throw new Error(
      "bare-mux BareMuxConnection export missing — run npm run copy-static and redeploy public/baremux/",
    );
  }

  return { BareMuxConnection };
}

function bareServerUrl(): string {
  return new URL("/bare/", window.location.origin).href;
}

export async function ensureUltravioletReady(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { BareMuxConnection } = await loadBareMuxModule();
    const connection = new BareMuxConnection("/baremux/worker.js");
    await connection.setTransport("/baremux/bare-client.mjs", [bareServerUrl()]);

    const registration = await navigator.serviceWorker.register("/uv/uv.sw.js", {
      scope: "/uv/service/",
    });
    await navigator.serviceWorker.ready;

    const notifyBareMux = () => {
      if (registration.active) {
        registration.active.postMessage({ type: "baremuxinit" });
      }
    };
    notifyBareMux();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", () => {
        if (registration.active) notifyBareMux();
      });
    });
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
