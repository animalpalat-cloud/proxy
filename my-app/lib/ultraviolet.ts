"use client";

/**
 * Ultraviolet + bare-mux → same-origin /bare/ (Nginx → Rust TompHTTP Bare).
 * MessagePort is transferred at most once per page load (getPort from the SW).
 */

import {
  getBareClientModuleUrl,
  getBareMuxWorkerUrl,
  getBareServerUrl,
} from "./bareEndpoint";

type BareMuxConnectionInstance = {
  setTransport(path: string, args: unknown[]): Promise<void>;
  getInnerPort(): Promise<MessagePort> | MessagePort;
};

type BareMuxConnectionCtor = new (workerPath: string) => BareMuxConnectionInstance;

type BareMuxModule = {
  BareMuxConnection?: BareMuxConnectionCtor;
  default?: { BareMuxConnection?: BareMuxConnectionCtor };
};

/** Browser-global singleton — survives React Strict Mode remounts. */
type BareUvGlobal = {
  initPromise?: Promise<void>;
  initDone?: boolean;
  bridgeInstalled?: boolean;
  muxPortDelivered?: boolean;
  getPortReplyPromise?: Promise<void>;
  connection?: BareMuxConnectionInstance;
};

function bareUvGlobal(): BareUvGlobal {
  const g = globalThis as typeof globalThis & { __openrelayBareUv?: BareUvGlobal };
  if (!g.__openrelayBareUv) {
    g.__openrelayBareUv = {};
  }
  return g.__openrelayBareUv;
}

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

async function unregisterUvServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((reg) => reg.scope.includes("/uv/service"))
      .map((reg) => reg.unregister()),
  );
}

async function preloadBareMuxAssets(): Promise<void> {
  const urls = [
    getBareMuxWorkerUrl(),
    getBareClientModuleUrl(),
    new URL("/baremux/index.mjs", window.location.origin).href,
  ];
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

async function verifyBareServerReachable(): Promise<void> {
  const bareUrl = getBareServerUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(bareUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `Bare server at ${bareUrl} returned redirect ${res.status} — use /bare (no trailing slash) or fix Nginx /bare proxy`,
      );
    }
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

/**
 * SW bare-mux asks clients for the SharedWorker port once via getPort.
 * Do NOT also postMessage(baremuxinit) with the same port — that neuters it.
 */
function installBareMuxServiceWorkerBridge(
  connection: BareMuxConnectionInstance,
): void {
  const state = bareUvGlobal();
  if (state.bridgeInstalled) return;
  state.bridgeInstalled = true;

  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "getPort" || !(data.port instanceof MessagePort)) return;

    void replyGetPortOnce(connection, data.port as MessagePort);
  });
}

async function replyGetPortOnce(
  connection: BareMuxConnectionInstance,
  replyPort: MessagePort,
): Promise<void> {
  const state = bareUvGlobal();

  const ackAlreadyDelivered = () => {
    try {
      replyPort.postMessage({ type: "muxPortAlreadyDelivered" });
    } catch {
      /* reply channel may be closed */
    }
  };

  if (state.muxPortDelivered) {
    ackAlreadyDelivered();
    return;
  }

  if (state.getPortReplyPromise) {
    try {
      await state.getPortReplyPromise;
    } catch (err) {
      console.error("bare-mux: getPort reply failed", err);
      throw err;
    }
    ackAlreadyDelivered();
    return;
  }

  state.getPortReplyPromise = (async () => {
    const muxPort = await connection.getInnerPort();
    replyPort.postMessage(muxPort, [muxPort]);
    state.muxPortDelivered = true;
  })();

  try {
    await state.getPortReplyPromise;
  } catch (err) {
    state.getPortReplyPromise = undefined;
    console.error("bare-mux: getPort reply failed", err);
    throw err;
  }
}

async function configureBareMuxTransport(
  connection: BareMuxConnectionInstance,
): Promise<void> {
  const bareUrl = getBareServerUrl();
  const clientModule = getBareClientModuleUrl();

  await Promise.race([
    connection.setTransport(clientModule, [bareUrl]),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `bare-mux setTransport timed out (bare=${bareUrl}). Check /baremux-worker.js and GET /bare (no 308) in Network.`,
            ),
          ),
        20_000,
      );
    }),
  ]);
}

async function runBareUvInit(): Promise<void> {
  const state = bareUvGlobal();
  if (state.initDone) return;

  await unregisterUvServiceWorkers();
  await verifyBareServerReachable();
  await preloadBareMuxAssets();

  const { BareMuxConnection } = await loadBareMuxModule();
  const connection = new BareMuxConnection(getBareMuxWorkerUrl());
  state.connection = connection;

  installBareMuxServiceWorkerBridge(connection);
  await configureBareMuxTransport(connection);

  await navigator.serviceWorker.register(
    new URL("/uv/sw.js", window.location.origin).href,
    { scope: "/uv/service/", type: "classic" },
  );
  await navigator.serviceWorker.ready;

  // Port is delivered when the SW sends getPort (see bridge). No baremuxinit transfer here.

  state.initDone = true;
}

export async function ensureUltravioletReady(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }

  const state = bareUvGlobal();

  if (state.initDone) return;
  if (state.initPromise) return state.initPromise;

  state.initPromise = runBareUvInit().catch((err) => {
    state.initPromise = undefined;
    throw err;
  });

  return state.initPromise;
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
