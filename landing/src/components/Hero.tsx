import { ArrowIcon, GitHubIcon } from "./icons"
import { LiveTranscriptDemo } from "./hero/LiveTranscriptDemo"
import { META } from "@/content/meta"

export function Hero() {
  return (
    <section className="atmosphere grain relative isolate overflow-hidden">
      <div className="mx-auto grid w-full max-w-(--shell-max) grid-cols-1 items-center gap-12 px-5 pb-24 pt-16 sm:gap-16 sm:px-8 sm:pb-32 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-20 lg:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow reveal reveal-delay-1 mb-6 sm:mb-8">
            <span className="mr-2 inline-block size-1 -translate-y-px rounded-full bg-live align-middle tally" />
            Open source · Multi Platform 
          </p>

          <h1
            className="reveal reveal-delay-2 font-display text-balance text-5xl leading-[0.98] tracking-[-0.025em] text-paper-0 sm:text-6xl lg:text-[4.5rem]"
            style={{ fontVariationSettings: '"SOFT" 55, "WONK" 0, "opsz" 144' }}
          >
            Catch the verse{" "}
            <span
              className="italic text-live"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 144' }}
            >
              before
            </span>{" "}
            it finishes.
          </h1>

          <p className="reveal reveal-delay-3 mt-6 max-w-xl font-sans text-base leading-relaxed text-paper-2 sm:mt-8 sm:text-lg">
            Rhema listens to live speech, detects the scripture being
            referenced, and pushes a verse overlay to your production
            stack — local, open source, no cloud required.
          </p>

          <div className="reveal reveal-delay-4 mt-9 flex flex-col items-start gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <PrimaryCta />
              <a
                href={META.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="
                  group inline-flex items-center gap-2 font-sans text-sm text-paper-1
                  transition-colors hover:text-paper-0
                "
              >
                <GitHubIcon className="size-4" />
                <span>View on GitHub</span>
                <ArrowIcon className="size-3.5 opacity-50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
              </a>
            </div>
          </div>

          <div className="reveal reveal-delay-5 mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-3">
            <span className="inline-flex items-center gap-2">
              <Tick /> Local transcription
            </span>
            <span className="inline-flex items-center gap-2">
              <Tick /> Offline Bible
            </span>
            <span className="inline-flex items-center gap-2">
              <Tick /> NDI-ready
            </span>
          </div>
        </div>

        <div className="reveal reveal-delay-hero-panel relative w-full">
          <LiveTranscriptDemo />

          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-paper-3">
            ↑ This transcript is live — it's Rhema demonstrating itself.
          </p>
        </div>
      </div>

      <div className="h-px w-full bg-rule" />
    </section>
  )
}

function PrimaryCta() {
  return (
    <a
      href="#download"
      className="
        group relative inline-flex items-center gap-3 whitespace-nowrap rounded-full
        bg-live px-5 py-3 font-sans text-sm font-medium text-ink-0
        transition-all duration-200
        hover:bg-live-soft
        focus-visible:outline-offset-4
      "
    >
      <span className="sm:hidden">Download Rhema</span>
      <span className="hidden sm:inline">
        Download for macOS / Windows / Linux
      </span>
      <ArrowIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </a>
  )
}

function Tick() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6l2.5 2.5L10 3" className="text-live" />
    </svg>
  )
}
