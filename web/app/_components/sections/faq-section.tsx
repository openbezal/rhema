import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "./section-heading";
import { cn } from "../../_lib/utils";

const FAQS = [
  {
    question: "What is Rhema",
    answer:
      "Real-time AI-powered Bible verse detection for live sermons and broadcasts. A Tauri v2 desktop app with a React frontend and Rust backend. Rhema listens to a live sermon audio feed, transcribes speech in real time, detects Bible verse references (both explicit citations and quoted passages), and renders them as broadcast-ready overlays via NDI for live production.",
  },
  {
    question: "Does Rhema work during live sermons?",
    answer:
      "Yes. Rhema is built specifically for live services and processes spoken words in real time, typically displaying referenced scriptures within seconds without interrupting the flow of the service.",
  },
  {
    question: "What equipment do I need?",
    answer:
      "You just need a computer with internet connection, an audio feed from your sound system, and a projector or display screen. Rhema works with your existing audio setup — no specialized hardware required.",
  },
  {
    question: "What Bible translations are supported?",
    answer:
      "Rhema supports KJV, ESV, NIV, NKJV, NLT, and more. You can switch between translations on-the-fly from the operator panel, and each translation is stored locally in your app database.",
  },
  {
    question: "How do I get started?",
    answer:
      "Download the free desktop app for Windows or macOS, connect your audio feed, and you're ready to go. Full setup instructions and documentation are available in-app and on our docs page.",
  },
  {
    question: "What happens if the pastor paraphrases a verse?",
    answer:
      "Rhema is trained to recognize paraphrased scripture references, not just exact quotations, allowing it to surface the intended Bible passage even when the wording differs.",
  },
  {
    question: "Do we still need a projection or media operator?",
    answer:
      "Yes, but their role becomes simpler. Instead of manually searching and switching verses, media operators can focus on visuals, livestreams, and overall service quality while Rhema handles scripture projection.",
  },
  {
    question: "Is Rhema difficult to set up or use?",
    answer:
      "No. Rhema is designed for church teams of all technical skill levels. Setup is straightforward, and once running, it operates automatically with minimal interaction during services.",
  },
];

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
          <dl className="flex flex-col">
            {FAQS.map((faq, i) => (
              <div
                key={faq.question}
                className={cn(
                  "flex flex-col gap-3 py-8",
                  i > 0 && "border-t border-border-strong"
                )}
              >
                <dt className="text-xl font-medium leading-8 tracking-[-0.02em] text-foreground md:text-2xl md:tracking-[-0.04em]">
                  {faq.question}
                </dt>
                <dd className="text-[17px] leading-6 tracking-[-0.01em] text-muted-foreground">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </section>
  );
}
