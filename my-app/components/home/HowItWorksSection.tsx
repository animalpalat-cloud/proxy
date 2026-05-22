const steps = [
  {
    step: "1",
    title: "Paste your link",
    description: "Drop in any HTTPS URL you want to open through the relay.",
  },
  {
    step: "2",
    title: "Select server location",
    description:
      "Pick a region closest to you—or the one your policy recommends.",
  },
  {
    step: "3",
    title: "Browse freely",
    description:
      "Launch the session; your backend can stream or frame the destination.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-y border-white/10 bg-gradient-to-b from-slate-900/40 to-transparent px-4 py-16 sm:px-6 lg:px-8 lg:py-20"
      aria-labelledby="how-heading"
    >
      <div className="mx-auto max-w-6xl">
        <h2
          id="how-heading"
          className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl"
        >
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-slate-400">
          Three deliberate steps—from paste to pathway—matching what you will
          implement server-side later.
        </p>

        <div className="mt-14 md:hidden">
          <ol className="relative space-y-10 border-l-2 border-cyan-500/25 pl-8">
            {steps.map(({ step, title, description }) => (
              <li key={step} className="relative">
                <span className="absolute -left-[2.125rem] top-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-cyan-400/80 bg-slate-950 text-xs font-bold text-cyan-300 shadow-[0_0_20px_-4px_rgba(34,211,238,0.5)]">
                  {step}
                </span>
                <h3 className="text-lg font-semibold text-slate-100">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <ol className="mt-14 hidden gap-8 md:grid md:grid-cols-3">
          {steps.map(({ step, title, description }, i) => (
            <li
              key={step}
              className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md"
            >
              {i < steps.length - 1 && (
                <div
                  className="pointer-events-none absolute left-full top-1/2 z-10 hidden h-px w-8 -translate-y-1/2 bg-gradient-to-r from-cyan-500/50 to-transparent md:block lg:w-12"
                  aria-hidden
                />
              )}
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/50 bg-slate-950 text-sm font-bold text-cyan-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                {step}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-100">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
