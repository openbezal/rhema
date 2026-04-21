import { Button } from "../ui/button";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";
import { SITE } from "../../_lib/site";

const TESTIMONIALS = [
  {
    quote:
      "I will definitely contribute to it. My church is dying need of something like this...",
    handle: "@ag_daniel10",
  },
  {
    quote: "This is remarkable. Your reward is in heaven",
    handle: "@esskay4ever",
  },
  {
    quote: "This is something that my church needed. Bless you",
    handle: "@ose_jay1",
  },
  {
    quote:
      "Sweet work. Will give this a try this Sunday and give feedback",
    handle: "@madebydayo",
  },
  {
    quote: "Well done! Can’t wait to try this.",
    handle: "@f_adex_",
  },
  {
    quote: "This is good for real, I’ll set it up for my church",
    handle: "@Sammichike",
  },
] as const;

export function TestimonialsSection() {
  return (
    <section
      aria-labelledby="testimonials-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14 lg:gap-[62px]">
        <Reveal>
          <SectionHeading id="testimonials-heading">
            Hear what people are saying!
          </SectionHeading>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 md:[&>*]:-ml-px md:[&>*]:-mt-px lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.handle} delay={(i % 3) * 80} className="flex">
              <figure className="flex h-full w-full flex-col justify-between gap-8 border border-border-strong p-8">
                <blockquote className="text-xl font-medium leading-8 tracking-[-0.02em] text-foreground md:text-2xl md:tracking-[-0.04em]">
                  {t.quote}
                </blockquote>
                <figcaption className="text-[17px] leading-6 tracking-[-0.01em] text-muted-foreground">
                  {t.handle}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
        <Reveal className="flex justify-center">
          <Button href={SITE.socials.twitter} variant="secondary" size="lg">
            See more reviews
          </Button>
        </Reveal>
      </Container>
    </section>
  );
}
