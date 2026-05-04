import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";
import { cn } from "../../_lib/utils";
import { FAQS } from "./faq-section.data";

export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="py-20 lg:py-[128px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14 lg:gap-[52px]">
        <Reveal>
          <SectionHeading id="faq-heading">Common questions</SectionHeading>
        </Reveal>
        <Reveal>
          <dl className="flex flex-col" itemScope itemType="https://schema.org/FAQPage">
            {FAQS.map((faq, i) => (
              <div
                key={faq.question}
                className={cn(
                  "flex flex-col gap-3 py-8",
                  i > 0 && "border-t border-border-strong"
                )}
                itemScope
                itemProp="mainEntity"
                itemType="https://schema.org/Question"
              >
                <dt
                  itemProp="name"
                  className="text-xl font-medium leading-8 tracking-[-0.02em] text-foreground md:text-2xl md:tracking-[-0.04em]"
                >
                  {faq.question}
                </dt>
                <dd
                  itemScope
                  itemProp="acceptedAnswer"
                  itemType="https://schema.org/Answer"
                  className="text-[17px] leading-6 tracking-[-0.01em] text-muted-foreground"
                >
                  <span itemProp="text">{faq.answer}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </section>
  );
}
