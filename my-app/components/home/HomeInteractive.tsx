"use client";

import { useState } from "react";

import { ProxyInputBar } from "@/components/home/ProxyInputBar";
import { QuickLaunchShortcuts } from "@/components/home/QuickLaunchShortcuts";

export function HomeInteractive() {
  const [url, setUrl] = useState("");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <ProxyInputBar url={url} onUrlChange={setUrl} />
      <QuickLaunchShortcuts onShortcut={setUrl} />
    </div>
  );
}
