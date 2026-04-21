import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    no: "1",
    title: "Download the app",
    body: "Free for Windows and macOS",
  },
  {
    no: "2",
    title: "Connect your audio input",
    body: "Works with any audio setup",
  },
  {
    no: "3",
    title: "Start your service",
    body: "Verses appear automatically",
  },
] as const;

export function QuickStartSection() {
  return (
    <section
      id="download"
      aria-labelledby="quick-start-heading"
      className="py-20 lg:py-[128px]"
    >
      <Container className="flex flex-col gap-10 md:gap-14 lg:gap-[52px]">
        <Reveal>
          <SectionHeading
            id="quick-start-heading"
            subtitle="No account. No subscription to start. Just download, connect your audio feed, and Rhema handles everything else from the moment your service begins."
          >
            Ready in under five minutes.
          </SectionHeading>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3 md:overflow-hidden md:[&>*]:-ml-px md:[&>*]:-mt-px">
          {STEPS.map((s, i) => (
            <Reveal key={s.no} delay={i * 80} className="flex">
              <div className="flex h-full w-full min-h-[320px] flex-col justify-between gap-8 border border-border-strong p-8 md:min-h-[400px]">
                <p className="text-2xl font-medium leading-8 tracking-[-0.04em] text-foreground">
                  {s.no}
                </p>
                <div className="flex flex-col gap-2">
                  <p className="text-2xl font-medium leading-8 tracking-[-0.04em] text-foreground">
                    {s.title}
                  </p>
                  <p className="text-lg leading-6 tracking-[-0.01em] text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
