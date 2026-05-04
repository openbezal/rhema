"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconBrandGithub, IconMenu2, IconX } from "@tabler/icons-react";
import { Button } from "../ui/button";
import { RhemaLogo } from "../ui/rhema-logo";
import { SITE } from "../../_lib/site";
import { cn } from "../../_lib/utils";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "#download", label: "Download" },
  { href: "#faq", label: "FAQs" },
];

export function SiteNav({ stars }: { stars: number }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-200",
        scrolled
          ? "bg-background/80 backdrop-blur-md border-b border-border"
          : "bg-background/0"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12 xl:px-[140px]">
        <Link href="/" aria-label="Rhema home" className="shrink-0">
          <RhemaLogo />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-center gap-5 xl:gap-8 lg:flex"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noopener noreferrer" : undefined}
              className="text-[15px] leading-6 text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Button
            href={SITE.repo.url}
            variant="secondary"
            size="md"
            aria-label={`Rhema on GitHub, ${stars} stars`}
          >
            <IconBrandGithub size={16} aria-hidden stroke={2} />
            <span>
              GitHub{" "}
              <span className="text-muted-foreground">
                • {formatStars(stars)}
              </span>
            </span>
          </Button>
          <Button href={SITE.repo.releasesLatest} variant="primary" size="md">
            Download
          </Button>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border-strong text-foreground hover:bg-white/5 lg:hidden"
        >
          {open ? <IconX size={20} /> : <IconMenu2 size={20} />}
        </button>
      </div>

      <div
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className="fixed inset-x-0 top-16 z-40 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto flex max-w-[1440px] flex-col gap-1 px-5 py-6 sm:px-8">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noopener noreferrer" : undefined}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-3 text-lg text-foreground hover:bg-white/5"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-2">
            <Button
              href={SITE.repo.url}
              variant="secondary"
              size="md"
              className="justify-center"
            >
              <IconBrandGithub size={16} aria-hidden stroke={2} />
              GitHub <span className="text-muted-foreground">• {formatStars(stars)}</span>
            </Button>
            <Button
              href={SITE.repo.releasesLatest}
              variant="primary"
              size="md"
              className="justify-center"
            >
              Download
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

function formatStars(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
