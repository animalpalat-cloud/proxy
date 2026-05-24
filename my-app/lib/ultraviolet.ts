"use client";

/**
 * Ultraviolet + bare-mux → same-origin /bare (Nginx → Rust TompHTTP Bare).
 *
 * Hard rules:
 *   - bare URL is /bare (NEVER /bare/) — Next.js otherwise 308-redirects and breaks setTransport.
 *   - SharedWorker URL has ?v=<buildId> so each deploy gets a fresh worker (no stale reuse).
 *   - Init runs ONCE via globalThis.__openrelayBareUv (survives React Strict Mode).
 *   - MessagePort is transferred at most once per page load (getPort from the SW).
 */

import {
  getBareClientModuleUrl,
  getBareMuxWorkerFallbackUrl,
  getBareMuxWorkerUrl,
  getBareServerUrl,
} from "./bareEndpoint";
import { stripTrailingSlash } from "./stripTrailingSlash";

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
  workerUrl?: string;
};

function bareUvGlobal(): BareUvGlobal {
  const g = globalThis as typeof globalThis & { __openrelayBareUv?: BareUvGlobal };
  if (!g.__openrelayBareUv) {
    g.__openrelayBareUv = {};
  }
  return g.__openrelayBareUv;
}

async function loadBareMuxModule(): Promise<{ BareMuxConnection: BareMuxConnectionCtor }> {
  const moduleUrl = stripTrailingSlash(
    new URL("/baremux/index.mjs", window.location.origin).href,
  );
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

/**
 * Force-update existing UV registrations (without unregister, which would kill
 * the SW controlling other tabs). `update()` fetches the SW script and, if
 * changed, installs the new one. Combined with skipWaiting + clients.claim
 * in the SW, this gives seamless cross-tab upgrades.
 */
async function refreshExistingUvRegistrations(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((reg) => reg.scope.includes("/uv/service"))
        .map((reg) => reg.update().catch(() => undefined)),
    );
  } catch {
    /* ignore — update is best-effort */
  }
}

/**
 * Fetch a worker URL and validate the response is a real bare-mux SharedWorker script.
 * Returns the URL on success, or throws with a diagnostic message.
 */
async function validateBareMuxWorker(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`bare-mux worker URL ${url} returned redirect ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`bare-mux worker URL ${url} returned HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  const body = await res.text();

  if (contentType.includes("text/html") || body.trimStart().startsWith("<")) {
    throw new Error(
      `bare-mux worker URL ${url} returned HTML (likely Next 404 page) — run \`npm run copy-static\` on the server and redeploy`,
    );
  }

  if (!body.includes("bare-mux") && !body.includes("onconnect")) {
    throw new Error(
      `bare-mux worker URL ${url} does not look like a SharedWorker script (length=${body.length})`,
    );
  }

  return url;
}

async function resolveWorkerUrl(): Promise<string> {
  const primary = getBareMuxWorkerUrl();
  try {
    return await validateBareMuxWorker(primary);
  } catch (primaryErr) {
    const fallback = getBareMuxWorkerFallbackUrl();
    try {
      const url = await validateBareMuxWorker(fallback);
      console.warn(
        `[bare-mux] primary worker ${primary} failed, falling back to ${url}:`,
        primaryErr,
      );
      return url;
    } catch (fallbackErr) {
      throw new Error(
        `bare-mux worker unavailable. Primary=${primary} (${(primaryErr as Error).message}). Fallback=${fallback} (${(fallbackErr as Error).message}).`,
      );
    }
  }
}

async function preloadBareMuxAssets(workerUrl: string): Promise<void> {
  const urls = [
    workerUrl,
    getBareClientModuleUrl(),
    stripTrailingSlash(new URL("/baremux/index.mjs", window.location.origin).href),
  ];
  await Promise.all(
    urls.map((url) =>
      fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "manual" }).then(
        (res) => {
          if (res.status >= 300 && res.status < 400) {
            throw new Error(`redirect ${res.status} for ${url}`);
          }
          if (!res.ok) {
            throw new Error(`failed to load ${url}: ${res.status}`);
          }
        },
      ),
    ),
  );
}

async function verifyBareServerReachable(): Promise<void> {
  const bareUrl = stripTrailingSlash(getBareServerUrl());
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
        `Bare server at ${bareUrl} returned redirect ${res.status} — URL must be /bare without trailing slash`,
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
        `Bare server at ${bareUrl} timed out — check Rust backend and Nginx /bare proxy`,
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
  workerUrl: string,
): Promise<void> {
  const bareUrl = stripTrailingSlash(getBareServerUrl());
  const clientModule = stripTrailingSlash(getBareClientModuleUrl());

  await Promise.race([
    connection.setTransport(clientModule, [bareUrl]),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `bare-mux setTransport timed out. ` +
                `bare=${bareUrl}, worker=${workerUrl}, client=${clientModule}. ` +
                `Check SharedWorker errors in DevTools (chrome://inspect/#shared-workers) ` +
                `and confirm GET ${bareUrl} returns 200 (no 308).`,
            ),
          ),
        20_000,
      );
    }),
  ]);
}

/**
 * Wait for the specific registration to be active.
 *
 * IMPORTANT: do NOT use `navigator.serviceWorker.ready` — that waits for an
 * SW that controls the *current page*. We register with scope `/uv/service/`,
 * but bootstrap usually runs on `/` (the homepage), so `.ready` would hang
 * forever waiting for a controller that will never exist.
 */
async function waitForRegistrationActive(
  registration: ServiceWorkerRegistration,
  timeoutMs = 15_000,
): Promise<void> {
  if (registration.active) return;

  const sw = registration.installing ?? registration.waiting ?? registration.active;
  if (!sw) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Ultraviolet SW (${registration.scope}) did not activate within ${timeoutMs}ms (state=${sw.state})`,
        ),
      );
    }, timeoutMs);

    const onState = () => {
      if (sw.state === "activated" || sw.state === "redundant") {
        clearTimeout(timer);
        sw.removeEventListener("statechange", onState);
        if (sw.state === "redundant") {
          reject(new Error("Ultraviolet SW became redundant before activation"));
        } else {
          resolve();
        }
      }
    };

    sw.addEventListener("statechange", onState);
    onState();
  });
}

async function runBareUvInit(): Promise<void> {
  const state = bareUvGlobal();
  if (state.initDone) return;

  if (typeof SharedWorker === "undefined") {
    throw new Error(
      "SharedWorker is not available in this browser/context (requires secure origin).",
    );
  }

  await refreshExistingUvRegistrations();
  await verifyBareServerReachable();

  const workerUrl = await resolveWorkerUrl();
  state.workerUrl = workerUrl;

  await preloadBareMuxAssets(workerUrl);

  const { BareMuxConnection } = await loadBareMuxModule();
  const connection = new BareMuxConnection(workerUrl);
  state.connection = connection;

  installBareMuxServiceWorkerBridge(connection);
  await configureBareMuxTransport(connection, workerUrl);

  const swScriptUrl = stripTrailingSlash(
    new URL("/uv/sw.js", window.location.origin).href,
  );

  const registration = await navigator.serviceWorker.register(swScriptUrl, {
    scope: "/uv/service/",
    type: "classic",
    updateViaCache: "none",
  });

  await waitForRegistrationActive(registration);

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
