import { IconBrandGithub, IconBrandWindows } from "@tabler/icons-react";
import { Button } from "../ui/button";
import { Container } from "../ui/container";
import { SITE } from "../../_lib/site";

export function HeroSection({ stars }: { stars: number }) {
  return (
    <section
      id="top"
      className="relative overflow-hidden"
      aria-label="Rhema introduction"
    >
      <HeroGlow />
      <Container
        as="div"
        className="relative flex flex-col items-center gap-12 py-20 text-center md:py-24 lg:py-28"
      >
        <div className="flex max-w-[830px] flex-col items-center gap-6">
          <h1 className="text-balance font-medium tracking-[-0.035em] text-foreground text-[44px] leading-[1.05] sm:text-[56px] md:text-[72px] lg:text-[84px] lg:tracking-[-0.05em]">
            <span>Your Pastor speaks. </span>
            <span className="text-accent">Rhema finds the verse.</span>
          </h1>
          <p className="text-pretty text-base leading-[1.5] text-muted-foreground sm:text-lg md:text-xl lg:text-2xl lg:leading-8">
            Rhema listens to a live sermon audio feed, transcribes speech in
            real time, detects Bible verse references (both explicit citations
            and quoted passages), and renders them as broadcast-ready overlays
            via NDI for live production.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button href={SITE.repo.releasesLatest} variant="primary" size="md">
              <IconBrandWindows size={16} aria-hidden stroke={2} />
              Download for windows
            </Button>
            <Button
              href={SITE.repo.url}
              variant="secondary"
              size="md"
              aria-label={`Star Rhema on GitHub, ${stars} stars`}
            >
              <IconBrandGithub size={16} aria-hidden stroke={2} />
              <span>
                Star on GitHub{" "}
                <span className="text-muted-foreground">• {stars}</span>
              </span>
            </Button>
          </div>
          <p className="text-[15px] leading-6 text-muted-foreground">
            Windows support only • MacOs coming soon
          </p>
        </div>
      </Container>
    </section>
  );
}

function HeroGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-[520px] w-full max-w-[1440px] opacity-60"
      style={{
        background:
          "radial-gradient(60% 50% at 50% 0%, rgba(0,153,255,0.18) 0%, rgba(0,153,255,0.05) 40%, transparent 70%)",
      }}
    />
  );
}
