const faqs = [
  {
    q: "Is this a real proxy?",
    a: "This page is a front-end shell. You will connect it to your own proxy or relay API to fetch and render remote pages safely and lawfully.",
  },
  {
    q: "Which regions are supported?",
    a: "The location dropdown is a UI placeholder. Map each option to your edge nodes or upstream providers when you implement the backend.",
  },
  {
    q: "Do you store my URLs?",
    a: "In this demo, nothing is persisted. Your production policy should state what you log, for how long, and why.",
  },
  {
    q: "Can I use this on mobile?",
    a: "Yes. The layout is mobile-first: the proxy bar stacks on small screens and the navigation becomes a slide-in drawer.",
  },
  {
    q: "What about HTTPS sites?",
    a: "The input accepts HTTPS URLs. Your backend must handle TLS to origins and certificate validation according to your security model.",
  },
] as const;

export function FaqSection() {
  return (
    <section
      id="faq"
      className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8 lg:py-20"
      aria-labelledby="faq-heading"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="faq-heading"
          className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl"
        >
          Frequently asked questions
        </h2>
        <p className="mt-3 text-slate-400">
          Straight answers for stakeholders reviewing the experience before
          integration.
        </p>

        <div className="mt-10 space-y-3">
          {faqs.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md transition-colors open:border-cyan-500/25 open:bg-white/[0.05] md:backdrop-blur-xl"
            >
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-slate-100 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/50 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-4">
                  {q}
                  <svg
                    className="h-5 w-5 shrink-0 text-slate-500 transition group-open:rotate-180 group-open:text-cyan-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </span>
              </summary>
              <div className="border-t border-white/10 px-5 pb-4 pt-0 text-sm leading-relaxed text-slate-400">
                <p className="pt-3">{a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
