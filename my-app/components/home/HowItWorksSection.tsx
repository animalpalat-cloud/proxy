const STEPS = [
  {
    title: "Paste a URL",
    body: "Enter any http or https site you want to browse through the relay.",
  },
  {
    title: "Auto-rotating proxy",
    body: "All traffic uses our Thailand ProxySeller endpoint—no region picker required.",
  },
  {
    title: "Open the viewer",
    body: "We rewrite pages and assets so they load through your gateway with cookies and streaming intact.",
  },
];

export function HowItWorksSection() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <h2 className="text-center text-2xl font-semibold text-slate-100">How it works</h2>
      <ol className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="rounded-xl border border-white/10 bg-slate-900/40 p-6 text-center"
          >
            <span className="text-sm font-semibold text-cyan-400">Step {i + 1}</span>
            <h3 className="mt-2 font-medium text-slate-100">{step.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
