import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SITE } from "../../_lib/site";

export function StatsSection({ stars }: { stars: number }) {
  const items = [
    { value: `${stars}+`, label: "Stars on GitHub" },
    { value: SITE.stats.languages, label: "Languages" },
    { value: SITE.stats.translations, label: "Bible Translations" },
  ];

  return (
    <section aria-label="Project stats" className="py-16 md:py-24 lg:py-[120px]">
      <Container>
        <div className="grid grid-cols-1 divide-border-strong sm:grid-cols-3 sm:divide-x">
          {items.map((item, i) => (
            <Reveal
              key={item.label}
              delay={i * 80}
              className="flex flex-col items-center justify-center gap-0.5 px-6 py-8 text-center"
            >
              <p className="font-medium text-foreground text-5xl leading-none tracking-[-0.02em] sm:text-6xl lg:text-[62px]">
                {item.value}
              </p>
              <p className="text-lg text-muted-foreground lg:text-2xl lg:leading-8">
                {item.label}
              </p>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
