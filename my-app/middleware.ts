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

type FetchCause = {
  name?: string;
  code?: string;
  errno?: number;
  address?: string;
  port?: number;
  message?: string;
};

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
    // Node's undici hides the real reason behind "fetch failed" in err.cause
    // (e.g. ECONNREFUSED address=127.0.0.1 port=8000). Surface it so the
    // 502 body and pm2 logs both name the actual failure.
    const e = err as (Error & { cause?: FetchCause }) | undefined;
    const cause = e?.cause ?? {};
    const message = e?.message ?? String(err);
    console.error(
      `[bare middleware] fetch to ${backendUrl} failed:`,
      message,
      cause,
    );
    return new NextResponse(
      JSON.stringify({
        code: "BARE_UPSTREAM_UNREACHABLE",
        message,
        cause: {
          code: cause.code,
          address: cause.address,
          port: cause.port,
          errno: cause.errno,
        },
        backendUrl,
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
