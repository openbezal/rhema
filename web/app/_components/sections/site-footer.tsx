import Link from "next/link";
import {
  IconBrandApple,
  IconBrandGithub,
  IconBrandLinkedin,
  IconBrandWindows,
  IconBrandX,
  IconMail,
} from "@tabler/icons-react";
import { Container } from "../ui/container";
import { RhemaLogo } from "../ui/rhema-logo";
import { SITE } from "../../_lib/site";

const GROUPS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Pricing", href: "#pricing" },
      { label: "Testimonials", href: "#testimonials" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Getting started", href: "/docs/getting-started/installation" },
      { label: "Help center", href: SITE.repo.discussions, external: true },
    ],
  },
  {
    heading: "Socials",
    links: [
      { label: "GitHub", href: SITE.socials.github, external: true },
      { label: "Email", href: SITE.socials.email },
      { label: "X (Twitter)", href: SITE.socials.twitter, external: true },
      { label: "LinkedIn", href: SITE.socials.linkedin, external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
      { label: "Cookie Policy", href: "#" },
      { label: "Testimonials", href: "#testimonials" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-20 lg:py-[100px]">
      <Container>
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] md:gap-8">
          <div className="flex flex-col gap-3">
            <RhemaLogo />
            <p className="max-w-[280px] text-lg leading-6 tracking-[-0.01em] text-muted-foreground">
              AI-powered real-time Bible verse detection for churches. Scripture
              on screen, the instant it&apos;s spoken.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-border-strong px-[14px] py-[6px] text-[15px] text-foreground">
                <IconBrandWindows size={16} aria-hidden stroke={2} />
                Windows
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border-strong px-[14px] py-[6px] text-[15px] text-foreground">
                <IconBrandApple size={16} aria-hidden stroke={2} />
                macOS
              </span>
            </div>
          </div>
          {GROUPS.map((g) => (
            <nav
              key={g.heading}
              aria-label={g.heading}
              className="flex flex-col gap-[10px]"
            >
              <h4 className="text-[15px] leading-6 text-foreground">
                {g.heading}
              </h4>
              <ul className="flex flex-col gap-[10px]">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <FooterLink
                      href={l.href}
                      external={"external" in l ? l.external : false}
                    >
                      {l.label}
                    </FooterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 text-[13px] leading-5 text-subtle-foreground md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} Rhema. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a
              href={SITE.socials.github}
              aria-label="GitHub"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconBrandGithub size={18} stroke={2} />
            </a>
            <a
              href={SITE.socials.twitter}
              aria-label="X (Twitter)"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconBrandX size={18} stroke={2} />
            </a>
            <a
              href={SITE.socials.linkedin}
              aria-label="LinkedIn"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconBrandLinkedin size={18} stroke={2} />
            </a>
            <a
              href={SITE.socials.email}
              aria-label="Email"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconMail size={18} stroke={2} />
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
}

function FooterLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const className =
    "text-[15px] leading-6 text-muted-foreground transition-colors hover:text-foreground";
  if (external || /^https?:|^mailto:/.test(href)) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
