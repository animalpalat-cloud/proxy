import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxyBackend";

/**
 * YouTube and other SPAs request /sw.js at the site root. Forward to Express proxy SW.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const session = url.searchParams.get("session");
  const origin = url.searchParams.get("origin");
  const qs = new URLSearchParams();
  if (session) qs.set("session", session);
  if (origin) qs.set("origin", origin);
  const q = qs.toString();
  return proxyToBackend(req, `/api/proxy/sw.js${q ? `?${q}` : ""}`);
}
