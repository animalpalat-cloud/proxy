"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ensureUltravioletReady } from "@/lib/ultraviolet";

/**
 * Initialize bare-mux + transport on the main site (outside /uv/service/)
 * so SharedWorker is ready before the UV-scoped page opens.
 */
export function BareUvBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname?.startsWith("/uv/service")) {
      void ensureUltravioletReady().catch((err) => {
        console.warn("bare/uv bootstrap:", err);
      });
    }
  }, [pathname]);

  return null;
}
