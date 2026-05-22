export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden px-4 pt-14 pb-10 sm:px-6 sm:pt-16 lg:px-8 lg:pt-20"
      aria-labelledby="hero-heading"
    >
      <div
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-gradient-to-b from-cyan-950/40 via-slate-950/0 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-20 h-64 w-[min(100%,42rem)] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto max-w-4xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/90">
          Trusted access layer
        </p>
        <h1
          id="hero-heading"
          className="mt-4 text-balance text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl lg:text-5xl"
        >
          Access the Web Safely{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
            &amp; Unrestricted
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">
          Paste any URL, choose a server region, and go. A clean, tech-forward
          interface designed for speed and clarity—ready to wire up to your
          proxy backend when you are.
        </p>
      </div>
    </section>
  );
}
