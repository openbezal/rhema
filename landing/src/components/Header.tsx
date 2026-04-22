import { GitHubIcon } from "./icons"
import { Wordmark } from "./Wordmark"
import { META } from "@/content/meta"

export function Header() {
  return (
    <header className="relative z-20">
      <div
        className="mx-auto flex w-full max-w-(--shell-max) items-center justify-between px-5 py-5 sm:px-8 sm:py-7"
      >
        <a
          href="#top"
          className="focus-visible:rounded-sm"
          aria-label="Rhema — back to top"
        >
          <Wordmark />
        </a>

        <nav className="flex items-center gap-5 sm:gap-7">
          <a
            href="#features"
            className="font-mono eyebrow !text-paper-2 transition-colors hover:!text-paper-0 hidden sm:inline"
          >
            Features
          </a>
          <a
            href="#download"
            className="font-mono eyebrow !text-paper-2 transition-colors hover:!text-paper-0 hidden sm:inline"
          >
            Download
          </a>

          <a
            href={META.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="
              group inline-flex items-center gap-2
              rounded-full border border-rule bg-ink-1/70 px-3.5 py-1.5
              font-mono text-[11px] uppercase tracking-[0.18em] text-paper-1
              transition-all duration-200
              hover:border-live/60 hover:bg-ink-1 hover:text-paper-0
            "
          >
            <GitHubIcon className="size-3.5 opacity-80 transition-opacity group-hover:opacity-100" />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
      <div className="h-px w-full bg-rule" />
    </header>
  )
}
