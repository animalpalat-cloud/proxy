const features = [
  {
    title: "Ultra-Fast Speed",
    description:
      "Optimized path selection and lightweight UI keep interactions snappy.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden>
        <path
          d="M13 3L4 14h7v7l9-11h-7V3z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Complete Anonymity",
    description:
      "Shield routine metadata in transit with a workflow built for discretion.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden>
        <path
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Bypass Censorship",
    description:
      "Reach the content you need when networks or regions add friction.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
          d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Secure Encryption",
    description:
      "Modern transport assumptions with room to plug in your TLS stack.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden>
        <rect
          x="5"
          y="11"
          width="14"
          height="10"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M7 11V8a5 5 0 0110 0v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="16" r="1" fill="currentColor" />
      </svg>
    ),
  },
] as const;

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8 lg:py-20"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2
            id="features-heading"
            className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl"
          >
            Built for clarity and confidence
          </h2>
          <p className="mt-3 text-slate-400">
            Premium proxy UX patterns—articulated as modular cards you can
            extend or localize.
          </p>
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ title, description, icon }) => (
            <li
              key={title}
              className="group rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-cyan-500/35 hover:bg-white/[0.07] hover:shadow-cyan-500/10 lg:backdrop-blur-xl"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25 transition group-hover:text-cyan-300">
                {icon}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-100">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
