import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxyBackend";

type RouteCtx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  const sub = (path ?? []).join("/");
  return proxyToBackend(req, `/api/proxy/${sub}`);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
