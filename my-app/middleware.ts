import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy all /bare* to Rust before Next's trailing-slash redirect (308 /bare/ → /bare).
 */
const BARE_BACKEND = (
  process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000"
).replace(/\/$/, "");

function isBarePath(pathname: string): boolean {
  return pathname === "/bare" || pathname === "/bare/" || pathname.startsWith("/bare/");
}

function bareBackendUrl(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  const rustPath = pathname === "/bare" ? "/bare/" : pathname;
  return `${BARE_BACKEND}${rustPath}${search}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isBarePath(pathname)) {
    return NextResponse.next();
  }

  const upgrade = request.headers.get("upgrade")?.toLowerCase();
  if (upgrade === "websocket") {
    return NextResponse.rewrite(new URL(bareBackendUrl(request)));
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
