import { IconMicrophone, IconSearch, IconScreenShare } from "@tabler/icons-react";
import { Container } from "../ui/container";
import { FeatureCard } from "../ui/feature-card";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    icon: IconMicrophone,
    title: "Listen",
    body: "Rhema connects to your sermon audio and transcribes it in real time.",
  },
  {
    icon: IconSearch,
    title: "Detect",
    body: "It identifies Bible verses — whether quoted or referenced.",
  },
  {
    icon: IconScreenShare,
    title: "Display",
    body: "Verses appear instantly as broadcast-ready overlays via NDI.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14 lg:gap-16">
        <Reveal>
          <SectionHeading id="how-it-works-heading">How it works</SectionHeading>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 80}>
              <FeatureCard icon={s.icon} title={s.title} body={s.body} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
