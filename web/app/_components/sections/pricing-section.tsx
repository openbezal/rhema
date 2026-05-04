import { Button } from "../ui/button";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";
import { SITE } from "../../_lib/site";

export function PricingSection() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col gap-10">
        <Reveal>
          <SectionHeading id="pricing-heading">Pricing</SectionHeading>
        </Reveal>
        <Reveal>
          <div className="flex flex-col gap-6 border border-border-strong p-8 md:p-10">
            <div className="flex flex-col gap-2">
              <p className="text-[34px] font-medium leading-none tracking-[-0.04em] text-foreground">
                Free
              </p>
              <p className="max-w-[1080px] text-lg leading-8 text-muted-foreground lg:text-2xl">
                Rhema is a gift from us to help church display scripture
                effortlessly during every sermon.
              </p>
            </div>
            <div>
              <Button href={SITE.repo.releasesLatest} variant="primary">
                Download
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
