import { FEATURES, type Feature } from "@/content/features"

export function Features() {
  return (
    <section id="features" className="relative">
      <div className="mx-auto w-full max-w-(--shell-max) px-5 py-24 sm:px-8 sm:py-32">
        <div className="mb-16 flex flex-col gap-5 sm:mb-20 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow mb-5">
              <span className="mr-2 inline-block h-px w-6 translate-y-[-3px] bg-paper-3 align-middle" />
              Features
            </p>
            <h2
              className="font-display text-balance text-4xl leading-[1.02] tracking-[-0.02em] text-paper-0 sm:text-5xl"
              style={{ fontVariationSettings: '"SOFT" 50, "WONK" 0, "opsz" 96' }}
            >
              Built for the moment
              <br />
              <span
                className="italic text-paper-2"
                style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 96' }}
              >
                between sentences.
              </span>
            </h2>
          </div>

          <p className="max-w-sm font-sans text-sm leading-relaxed text-paper-2 sm:text-right">
            Six systems working together so a reference lands on screen while
            the speaker is still mid-sentence.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, idx) => (
            <FeatureCard key={feature.id} feature={feature} index={idx} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const { Icon, title, body } = feature
  const marker = String(index + 1).padStart(2, "0")

  return (
    <article
      className="
        group relative flex flex-col gap-8
        bg-ink-0 p-6 sm:p-8
        transition-colors duration-300
        hover:bg-ink-1
      "
    >
      <div className="flex items-start justify-between">
        <div
          className="
            inline-flex size-10 items-center justify-center
            rounded-lg border border-rule bg-ink-1/60 text-paper-1
            transition-colors duration-300
            group-hover:border-live/30 group-hover:text-live
          "
        >
          <Icon className="size-5" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-3">
          {marker}
        </span>
      </div>

      <div>
        <h3
          className="font-display text-2xl leading-tight tracking-[-0.01em] text-paper-0"
          style={{ fontVariationSettings: '"SOFT" 40, "WONK" 0, "opsz" 48' }}
        >
          {title}
        </h3>
        <p className="mt-3 font-sans text-sm leading-relaxed text-paper-2">
          {body}
        </p>
      </div>
    </article>
  )
}
