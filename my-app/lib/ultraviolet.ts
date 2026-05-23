"use client";

/**
 * Ultraviolet + bare-mux → same-origin /bare/ (Nginx → Rust TompHTTP Bare).
 * Static assets load from /baremux/* and /uv/* (never bundled by Next).
 */

import {
  getBareClientModuleUrl,
  getBareMuxWorkerUrl,
  getBareServerUrl,
} from "./bareEndpoint";

let initPromise: Promise<void> | null = null;
let bareMuxBridgeInstalled = false;
let bareMuxConnection: BareMuxConnectionInstance | null = null;

type BareMuxConnectionInstance = {
  setTransport(path: string, args: unknown[]): Promise<void>;
  getInnerPort(): Promise<MessagePort> | MessagePort;
};

type BareMuxConnectionCtor = new (workerPath: string) => BareMuxConnectionInstance;

type BareMuxModule = {
  BareMuxConnection?: BareMuxConnectionCtor;
  default?: { BareMuxConnection?: BareMuxConnectionCtor };
};

async function loadBareMuxModule(): Promise<{ BareMuxConnection: BareMuxConnectionCtor }> {
  const moduleUrl = new URL("/baremux/index.mjs", window.location.origin).href;
  const mod = (await import(
    /* webpackIgnore: true */
    moduleUrl
  )) as BareMuxModule;

  const BareMuxConnection =
    mod.BareMuxConnection ?? mod.default?.BareMuxConnection;

  if (typeof BareMuxConnection !== "function") {
    throw new Error(
      "bare-mux BareMuxConnection missing — run npm run copy-static and redeploy public/baremux/",
    );
  }

  return { BareMuxConnection };
}

/** Drop UV service workers so they cannot race bare-mux SharedWorker setup. */
async function unregisterUvServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((reg) => reg.scope.includes("/uv/service"))
      .map((reg) => reg.unregister()),
  );
}

/** Warm-cache worker scripts so SharedWorker load is not blocked behind a hung SW fetch. */
async function preloadBareMuxAssets(): Promise<void> {
  const urls = [getBareMuxWorkerUrl(), getBareClientModuleUrl()];
  await Promise.all(
    urls.map((url) =>
      fetch(url, { cache: "no-store", credentials: "same-origin" }).then((res) => {
        if (!res.ok) {
          throw new Error(`failed to load ${url}: ${res.status}`);
        }
      }),
    ),
  );
}

/** Confirm /bare/ reaches the Rust server (Next rewrite in dev, Nginx in production). */
async function verifyBareServerReachable(): Promise<void> {
  const bareUrl = getBareServerUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(bareUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `Bare server at ${bareUrl} returned ${res.status} — is openrelay-bare running on port 8000?`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Bare server at ${bareUrl} timed out — check Rust backend and Nginx /bare/ proxy`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function installBareMuxServiceWorkerBridge(
  connection: BareMuxConnectionInstance,
): void {
  if (bareMuxBridgeInstalled) return;
  bareMuxBridgeInstalled = true;

  const onSwMessage = async (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "getPort" && data.port instanceof MessagePort) {
      try {
        const muxPort = await connection.getInnerPort();
        data.port.postMessage(muxPort, [muxPort]);
      } catch (err) {
        console.error("bare-mux: getPort reply failed", err);
      }
    }
  };

  navigator.serviceWorker.addEventListener("message", onSwMessage);
}

async function configureBareMuxTransport(
  connection: BareMuxConnectionInstance,
): Promise<void> {
  const bareUrl = getBareServerUrl();
  const clientModule = getBareClientModuleUrl();

  const setTransport = connection.setTransport(clientModule, [bareUrl]);

  await Promise.race([
    setTransport,
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `bare-mux setTransport timed out (bare=${bareUrl}). Check /baremux/worker.js and /bare/ in Network.`,
            ),
          ),
        20_000,
      );
    }),
  ]);
}

async function notifyUltravioletServiceWorker(
  registration: ServiceWorkerRegistration,
  connection: BareMuxConnectionInstance,
): Promise<void> {
  const sw =
    registration.active ?? registration.waiting ?? registration.installing;
  if (!sw) return;

  const muxPort = await connection.getInnerPort();
  sw.postMessage({ __uv$type: "baremuxinit", port: muxPort }, [muxPort]);
}

export async function ensureUltravioletReady(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await unregisterUvServiceWorkers();

    await verifyBareServerReachable();
    await preloadBareMuxAssets();

    const { BareMuxConnection } = await loadBareMuxModule();
    const workerUrl = getBareMuxWorkerUrl();
    const connection = new BareMuxConnection(workerUrl);
    bareMuxConnection = connection;

    installBareMuxServiceWorkerBridge(connection);
    await configureBareMuxTransport(connection);

    const registration = await navigator.serviceWorker.register(
      new URL("/uv/sw.js", window.location.origin).href,
      { scope: "/uv/service/", type: "classic" },
    );
    await navigator.serviceWorker.ready;

    await notifyUltravioletServiceWorker(registration, connection);

    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", () => {
        if (registration.active) {
          void notifyUltravioletServiceWorker(registration, connection);
        }
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
