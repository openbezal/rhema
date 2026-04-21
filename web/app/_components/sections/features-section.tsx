import {
  IconAdjustmentsHorizontal,
  IconLayoutBoard,
  IconMicrophone,
  IconPlug,
  IconScreenShare,
  IconSearch,
} from "@tabler/icons-react";
import { Container } from "../ui/container";
import { FeatureCard } from "../ui/feature-card";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";

import type { Icon as TablerIcon } from "@tabler/icons-react";

type Feature = {
  icon: TablerIcon;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: IconMicrophone,
    title: "Listens to Your Sermon Live",
    body: "Rhema listens as the pastor speaks and turns the message into text instantly. No setup or typing needed. Just press start and let it run.",
  },
  {
    icon: IconSearch,
    title: "Finds Bible Verses Automatically",
    body: "Detects Bible verses from both direct references and spoken quotes. It understands imperfect speech and partial phrasing.",
  },
  {
    icon: IconScreenShare,
    title: "Shows Verses On Screen Instantly",
    body: "As soon as a verse is detected, it appears on screen right away. No delays. Your audience sees the scripture at the right moment.",
  },
  {
    icon: IconPlug,
    title: "Works With Your Live Setup",
    body: "Rhema connects easily to tools like OBS Studio and vMix. You don’t need to change how you already run your service. Just add it to your setup.",
  },
  {
    icon: IconLayoutBoard,
    title: "Ready-to-Use Verse Designs",
    body: "Choose from clean, pre-made styles for your verse overlays. Everything is already designed for you. Pick one and go live.",
  },
  {
    icon: IconAdjustmentsHorizontal,
    title: "Simple Control During Service",
    body: "See all detected verses in one place. Reorder, skip, or show any verse with a click. Stay in control without stress or switching between apps.",
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="py-20 lg:py-[120px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14">
        <Reveal>
          <SectionHeading id="features-heading">
            Everything your media team needs
          </SectionHeading>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 md:overflow-hidden md:[&>*]:-ml-px md:[&>*]:-mt-px lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80} className="flex">
              <FeatureCard
                icon={f.icon}
                title={f.title}
                body={f.body}
                iconTone="accent"
              />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
