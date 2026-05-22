import type { ReactNode } from "react";

type Shortcut = {
  id: string;
  label: string;
  url: string;
  icon: ReactNode;
};

const shortcuts: Shortcut[] = [
  {
    id: "google",
    label: "Google",
    url: "https://www.google.com",
    icon: <span className="text-lg font-bold text-slate-200">G</span>,
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    url: "https://www.wikipedia.org",
    icon: <span className="text-lg font-bold text-slate-200">W</span>,
  },
  {
    id: "twitter",
    label: "X",
    url: "https://twitter.com",
    icon: (
      <span className="text-lg font-bold text-slate-200" aria-label="X">
        𝕏
      </span>
    ),
  },
  {
    id: "reddit",
    label: "Reddit",
    url: "https://www.reddit.com",
    icon: <span className="text-lg font-bold text-orange-300/90">r</span>,
  },
];

type QuickLaunchShortcutsProps = {
  onShortcut: (url: string) => void;
};

export function QuickLaunchShortcuts({ onShortcut }: QuickLaunchShortcutsProps) {
  return (
    <div className="mx-auto mt-8 w-full max-w-3xl md:max-w-4xl">
      <p className="mb-4 text-center text-xs font-medium uppercase tracking-wider text-slate-500">
        Quick launch
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shortcuts.map(({ id, label, url, icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onShortcut(url)}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 text-center shadow-md shadow-black/20 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-cyan-500/35 hover:bg-white/[0.08] hover:shadow-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:translate-y-0 md:backdrop-blur-xl"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950/80 ring-1 ring-white/10">
                {icon}
              </span>
              <span className="text-xs font-medium text-slate-300">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
