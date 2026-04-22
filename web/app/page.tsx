import { SiteNav } from "./_components/sections/site-nav";
import { HeroSection } from "./_components/sections/hero-section";
import { StatsSection } from "./_components/sections/stats-section";
import { HowItWorksSection } from "./_components/sections/how-it-works-section";
import { FeaturesSection } from "./_components/sections/features-section";
import { AudienceSection } from "./_components/sections/audience-section";
import { ComparisonSection } from "./_components/sections/comparison-section";
import { PricingSection } from "./_components/sections/pricing-section";
import { TestimonialsSection } from "./_components/sections/testimonials-section";
import { FaqSection } from "./_components/sections/faq-section";
import { QuickStartSection } from "./_components/sections/quick-start-section";
import { FinalCtaSection } from "./_components/sections/final-cta-section";
import { SiteFooter } from "./_components/sections/site-footer";
import { getGitHubStars } from "./_lib/site";

export const revalidate = 3600;

export default async function Home() {
  const stars = await getGitHubStars();

  return (
    <>
      <SiteNav stars={stars} />
      <main>
        <HeroSection stars={stars} />
        <StatsSection stars={stars} />
        <HowItWorksSection />
        <FeaturesSection />
        <AudienceSection />
        <ComparisonSection />
        <PricingSection />
        <TestimonialsSection />
        <FaqSection />
        <QuickStartSection />
        <FinalCtaSection stars={stars} />
      </main>
      <SiteFooter />
    </>
  );
}
