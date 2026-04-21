import { IconBrandGithub } from "@tabler/icons-react";
import { Button } from "../ui/button";
import { Container } from "../ui/container";
import { DownloadButton } from "../ui/download-button";
import { Reveal } from "../ui/reveal";
import { SITE } from "../../_lib/site";

export function FinalCtaSection({ stars }: { stars: number }) {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col items-center gap-12 text-center">
        <Reveal>
          <h2
            id="final-cta-heading"
            className="text-balance font-medium text-foreground text-[40px] leading-[1.05] tracking-[-0.035em] sm:text-[56px] md:text-[72px] lg:text-[84px] lg:tracking-[-0.05em]"
          >
            Innovating church{" "}
            <span className="text-accent">presentations with AI</span>
          </h2>
        </Reveal>
        <Reveal className="flex flex-col items-center gap-4">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <DownloadButton />
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
            Available for Windows and macOS
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
