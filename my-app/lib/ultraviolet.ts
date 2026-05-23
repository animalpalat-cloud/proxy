"use client";

/**
 * Register Ultraviolet service worker and configure bare-mux → same-origin /bare/ (Rust).
 *
 * bare-mux is loaded from /baremux/index.mjs (static ESM), not from npm, so production
 * minification does not break `BareMuxConnection` ("a is not a constructor").
 */

let initPromise: Promise<void> | null = null;
let bareMuxBridgeInstalled = false;

type BareMuxConnectionInstance = {
  setTransport(path: string, args: unknown[]): Promise<void>;
  getInnerPort(): Promise<MessagePort> | MessagePort;
};

type BareMuxConnectionCtor = new (workerPath: string) => BareMuxConnectionInstance;

type BareMuxModule = {
  BareMuxConnection?: BareMuxConnectionCtor;
  default?: { BareMuxConnection?: BareMuxConnectionCtor };
};

const BARE_MUX_WORKER = "/baremux/worker.js";
const BARE_CLIENT_MODULE = "/baremux/bare-client.mjs";

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

/** UV SW + bare-mux SharedWorker ask the page for the mux port via `{ type: "getPort" }`. */
function installBareMuxServiceWorkerBridge(
  connection: BareMuxConnectionInstance,
): void {
  if (bareMuxBridgeInstalled || typeof navigator === "undefined") return;
  bareMuxBridgeInstalled = true;

  navigator.serviceWorker.addEventListener("message", async (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "getPort" && data.port instanceof MessagePort) {
      try {
        const muxPort = await connection.getInnerPort();
        data.port.postMessage(muxPort, [muxPort]);
      } catch (err) {
        console.error("bare-mux: failed to answer getPort", err);
      }
    }
  });
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
    const { BareMuxConnection } = await loadBareMuxModule();
    const connection = new BareMuxConnection(BARE_MUX_WORKER);

    installBareMuxServiceWorkerBridge(connection);

    await connection.setTransport(BARE_CLIENT_MODULE, [bareServerUrl()]);

    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      if (!reg.scope.includes("/uv/service")) continue;
      const script =
        reg.active?.scriptURL ??
        reg.waiting?.scriptURL ??
        reg.installing?.scriptURL ??
        "";
      if (script.includes("/uv/uv.sw.js") && !script.endsWith("/uv/sw.js")) {
        await reg.unregister();
      }
    }

    const registration = await navigator.serviceWorker.register("/uv/sw.js", {
      scope: "/uv/service/",
    });
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
