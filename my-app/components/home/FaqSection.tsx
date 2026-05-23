const FAQ = [
  {
    q: "Is this a real proxy?",
    a: "Yes. Traffic is routed through ProxySeller’s auto-rotating Thailand residential proxy. There is no manual region picker—the upstream IP rotates automatically.",
  },
  {
    q: "Which regions are supported?",
    a: "All traffic uses a single auto-rotating Thailand endpoint (All Regions). You do not choose US, UK, or Germany—the provider rotates IPs for you.",
  },
  {
    q: "Why does YouTube use a separate viewer tab?",
    a: "Video and script assets load through our gateway with rewritten URLs and streaming support for googlevideo.com, so the experience works best in a dedicated proxied tab.",
  },
  {
    q: "The site failed with ECONNRESET — what now?",
    a: "Retry unblock, confirm ProxySeller credentials and that your public IP (PROXYSELLER_AUTH_IP) is whitelisted in the ProxySeller dashboard.",
  },
];

export function FaqSection() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <h2 className="text-center text-2xl font-semibold text-slate-100">FAQ</h2>
      <dl className="mx-auto mt-8 max-w-2xl space-y-6">
        {FAQ.map((item) => (
          <div key={item.q} className="rounded-xl border border-white/10 bg-slate-900/40 p-5">
            <dt className="font-medium text-cyan-100">{item.q}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-400">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
