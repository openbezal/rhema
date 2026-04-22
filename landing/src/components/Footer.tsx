import { GitHubIcon } from "./icons"
import { Wordmark } from "./Wordmark"
import { META } from "@/content/meta"

type Link = { label: string; href: string; external?: boolean }

const LINK_GROUPS: { title: string; links: Link[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: META.repoUrl, external: true },
      { label: "Issues", href: META.repoIssuesUrl, external: true },
      { label: "Releases", href: META.repoReleasesUrl, external: true },
    ],
  },
  {
    title: "Colophon",
    links: [
      {
        label: "Fraunces",
        href: "https://fonts.google.com/specimen/Fraunces",
        external: true,
      },
      {
        label: "Geist",
        href: "https://vercel.com/font",
        external: true,
      },
    ],
  },
]

export function Footer() {
  return (
    <footer className="relative mt-24 border-t border-rule">
      <div className="mx-auto w-full max-w-(--shell-max) px-5 pb-12 pt-16 sm:px-8 sm:pb-14 sm:pt-20">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <Wordmark />
            <p className="mt-5 max-w-sm font-sans text-sm leading-relaxed text-paper-2">
              Rhema is an open-source application that listens to live speech,
              detects the scripture being referenced, and pushes it to your
              broadcast stack — no cloud dependency required.
            </p>
            <a
              href={META.repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="
                mt-6 inline-flex items-center gap-2 rounded-full border border-rule
                bg-ink-1/60 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-1
                transition-colors hover:border-live/50 hover:text-paper-0
              "
            >
              <GitHubIcon className="size-3.5" />
              Star on GitHub
            </a>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:col-span-7">
            {LINK_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="eyebrow mb-5">{group.title}</h4>
                <ul className="flex flex-col gap-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        {...(link.external
                          ? { target: "_blank", rel: "noreferrer noopener" }
                          : {})}
                        className="font-sans text-sm text-paper-1 transition-colors hover:text-paper-0"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-16 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-3">
            {META.license} · © {META.year} {META.licenseHolder}
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-3">
            Made with <span className="text-live">♥</span> — open source
          </p>
        </div>
      </div>
    </footer>
  )
}
