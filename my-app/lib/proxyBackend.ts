export function getBackendOrigin(): string {
  const fromEnv = process.env.BACKEND_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8000";
  return "";
}

export const PROXY_TIMEOUT_MS =
  Number(process.env.API_PROXY_TIMEOUT_MS) || 300_000;

export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

export async function proxyToBackend(
  req: Request,
  backendPath: string,
): Promise<Response> {
  const backend = getBackendOrigin();
  if (!backend) {
    return new Response("BACKEND_URL is not configured.", { status: 503 });
  }

  const incoming = new URL(req.url);
  const target = `${backend}${backendPath}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection") return;
    headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    init.body = req.body;
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(target, init);
    const outHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return;
      outHeaders.set(key, value);
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Proxy upstream failed";
    return new Response(msg, { status: 502 });
  }
}
