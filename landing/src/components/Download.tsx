import { GitHubIcon, ArrowIcon } from "./icons"
import { PLATFORMS, RELEASE_STATE, type Platform } from "@/content/platforms"
import { META } from "@/content/meta"

export function Download() {
  return (
    <section id="download" className="relative border-t border-rule">
      <div className="mx-auto w-full max-w-(--shell-max) px-5 py-24 sm:px-8 sm:py-32">
        <div className="mb-16 flex flex-col gap-5 sm:mb-20 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow mb-5">
              <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-paper-3 align-middle" />
              Download
            </p>
            <h2
              className="font-display text-balance text-4xl leading-[1.02] tracking-[-0.02em] text-paper-0 sm:text-5xl"
              style={{ fontVariationSettings: '"SOFT" 50, "WONK" 0, "opsz" 96' }}
            >
              Three platforms,
              <br />
              <span
                className="italic text-paper-2"
                style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 96' }}
              >
                one install.
              </span>
            </h2>
          </div>

          <p className="max-w-sm font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em] text-paper-3 sm:text-right">
            <span className="tally mr-2 inline-block size-1.5 -translate-y-px rounded-full bg-live align-middle" />
            {RELEASE_STATE.currentPhase}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {PLATFORMS.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start gap-5 rounded-2xl border border-rule bg-ink-1/60 p-6 sm:mt-16 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="max-w-lg">
            <p className="font-display text-xl leading-snug text-paper-0 sm:text-2xl">
              Releases aren&apos;t public yet.
            </p>
            <p className="mt-2 font-sans text-sm leading-relaxed text-paper-2">
              Star the repository to be notified the moment the first signed
              build ships, or follow along with the development openly.
            </p>
          </div>

          <a
            href={META.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="
              group inline-flex shrink-0 items-center gap-3 rounded-full
              bg-paper-0 px-5 py-3 font-sans text-sm font-medium text-ink-0
              transition-all duration-200
              hover:bg-live
              focus-visible:outline-offset-4
            "
          >
            <GitHubIcon className="size-4" />
            <span>Star on GitHub</span>
            <ArrowIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  )
}

function PlatformCard({ platform }: { platform: Platform }) {
  const { Icon, name, format, available, downloadUrl } = platform

  const baseClasses = `
    relative flex flex-col gap-6 rounded-2xl border border-rule bg-ink-1/40
    p-6 sm:p-7
    transition-all duration-300
  `

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div
          className="
            inline-flex size-10 items-center justify-center rounded-lg
            border border-rule bg-ink-0 text-paper-1
          "
        >
          <Icon className="size-5" />
        </div>
        {!available && (
          <span
            className="
              rounded-full border border-rule bg-ink-0/60 px-2.5 py-1
              font-mono text-[9px] uppercase tracking-[0.22em] text-paper-3
            "
          >
            Coming soon
          </span>
        )}
      </div>

      <div>
        <h3
          className="font-display text-2xl tracking-[-0.01em] text-paper-0"
          style={{ fontVariationSettings: '"SOFT" 40, "WONK" 0, "opsz" 48' }}
        >
          {name}
        </h3>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-3">
          {format}
        </p>
      </div>

      {available && (
        <span className="inline-flex items-center gap-2 font-sans text-sm text-live">
          Download
          <ArrowIcon className="size-3.5" />
        </span>
      )}
    </>
  )

  if (available && downloadUrl) {
    return (
      <a
        href={downloadUrl}
        className={`${baseClasses} hover:-translate-y-0.5 hover:border-live/40 hover:bg-ink-1`}
      >
        {inner}
      </a>
    )
  }

  return (
    <div
      aria-disabled="true"
      className={`${baseClasses} opacity-85`}
    >
      {inner}
    </div>
  )
}
