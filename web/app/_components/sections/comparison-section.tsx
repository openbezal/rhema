import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";

const WITHOUT = ["Manual verse typing", "Delays", "Missed references"];
const WITH = ["Automatic detection", "Instant display", "Smooth live flow"];

export function ComparisonSection() {
  return (
    <section
      aria-labelledby="comparison-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14 lg:gap-16">
        <Reveal>
          <SectionHeading id="comparison-heading">Why Rhema</SectionHeading>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <Reveal>
            <ComparisonCard
              title="Without Rhema"
              items={WITHOUT}
              tone="negative"
            />
          </Reveal>
          <Reveal delay={80}>
            <ComparisonCard title="With Rhema" items={WITH} tone="positive" />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function ComparisonCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "positive" | "negative";
}) {
  const Icon = tone === "positive" ? IconCircleCheck : IconCircleX;
  const iconColor = tone === "positive" ? "text-accent" : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-2 border border-border-strong p-8 opacity-90">
      <h3 className="text-lg font-medium leading-6 tracking-[-0.01em] text-foreground">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-center gap-1.5 text-[15px] leading-6 text-muted-foreground"
          >
            <Icon size={16} aria-hidden className={iconColor} stroke={2} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
