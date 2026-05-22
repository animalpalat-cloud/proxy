import Link from "next/link";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-white/10 bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-16">
          <div className="max-w-md">
            <p className="text-sm font-semibold tracking-tight text-slate-100">
              OpenRelay
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Frontend-only demo interface. Connectivity, proxying, and
              compliance remain your responsibility when you integrate a
              backend.
            </p>
          </div>
          <nav
            className="flex flex-wrap gap-x-8 gap-y-3 text-sm"
            aria-label="Footer"
          >
            <Link
              href="#"
              className="text-slate-400 transition-colors hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 rounded"
            >
              Privacy Policy
            </Link>
            <Link
              href="#"
              className="text-slate-400 transition-colors hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 rounded"
            >
              Terms of Service
            </Link>
          </nav>
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <p className="text-xs leading-relaxed text-slate-500">
            <strong className="font-medium text-slate-400">Disclaimer:</strong>{" "}
            This application is provided for lawful, educational, and
            accessibility purposes only. You are solely responsible for your use
            of any proxy or unblocker technology and for complying with
            applicable laws and network policies. No warranty is made
            regarding availability, security, or fitness for a particular
            purpose.
          </p>
          <p className="mt-4 text-xs text-slate-600">
            © {year} OpenRelay. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
