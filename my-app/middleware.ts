import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy /bare/* to Rust before Next's trailing-slash redirect (308 /bare/ → /bare).
 * Nginx should still route /bare/ → :8000 in production; this covers misconfig / dev.
 */
const BARE_BACKEND = (
  process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000"
).replace(/\/$/, "");

function bareBackendUrl(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  const path = pathname === "/bare" ? "/bare/" : pathname;
  return `${BARE_BACKEND}${path}${search}`;
}

export async function middleware(request: NextRequest) {
  const upgrade = request.headers.get("upgrade")?.toLowerCase();
  if (upgrade === "websocket") {
    // Let Next rewrites/nginx pass WebSocket through to Rust.
    return NextResponse.next();
  }

  const backendUrl = bareBackendUrl(request);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(backendUrl, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const config = {
  matcher: ["/bare", "/bare/", "/bare/:path*"],
};
