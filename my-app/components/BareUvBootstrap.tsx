"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ensureUltravioletReady } from "@/lib/ultraviolet";

/**
 * Warm up bare-mux on the homepage once (Strict Mode safe via global singleton in ensureUltravioletReady).
 */
export function BareUvBootstrap() {
  const pathname = usePathname();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (pathname?.startsWith("/uv/service")) return;

    startedRef.current = true;
    void ensureUltravioletReady().catch((err) => {
      console.warn("bare/uv bootstrap:", err);
      startedRef.current = false;
    });
  }, [pathname]);

  return null;
}
