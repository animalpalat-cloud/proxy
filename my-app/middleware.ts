import { NextRequest, NextResponse } from "next/server";
import {
  isBarePublicPath,
  stripTrailingSlashPath,
  toRustBareUpstreamPath,
} from "./lib/stripTrailingSlash";

/**
 * Proxy /bare* to Rust. Does not add trailing slashes to browser URLs.
 */
const BARE_BACKEND = (
  process.env.RUST_BARE_URL?.trim() || "http://127.0.0.1:8000"
).replace(/\/$/, "");

function bareBackendUrl(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  const rustPath = toRustBareUpstreamPath(stripTrailingSlashPath(pathname));
  return `${BARE_BACKEND}${rustPath}${search}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isBarePublicPath(pathname)) {
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

  let upstream: Response;
  try {
    upstream = await fetch(backendUrl, init);
  } catch (err) {
    // Connection failures (ECONNREFUSED, ECONNRESET, DNS) used to throw out of
    // the middleware and surface as a generic Next 500 HTML page, hiding the
    // real reason. Return a structured bare-compatible 502 instead so the
    // frontend banner and DevTools both show "BARE_UPSTREAM_UNREACHABLE".
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bare middleware] fetch to ${backendUrl} failed:`, err);
    return new NextResponse(
      JSON.stringify({
        code: "BARE_UPSTREAM_UNREACHABLE",
        message,
        backendUrl,
        hint: "Check that openrelay-bare is running on port 8000 (pm2 status, pm2 logs openrelay-bare).",
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          "x-bare-status": "502",
          "x-bare-status-text": "Upstream Unreachable",
          "x-bare-headers": "{}",
        },
      },
    );
  }

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
