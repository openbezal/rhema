import { SITE } from "../../_lib/site";
import { FAQS } from "../sections/faq-section.data";

const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;
const APP_ID = `${SITE.url}/#software`;
const FAQ_ID = `${SITE.url}/#faq`;

export function StructuredData() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: SITE.legalName,
        alternateName: SITE.name,
        url: SITE.url,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/icon.svg`,
          width: 1024,
          height: 1024,
        },
        sameAs: [
          SITE.socials.github,
          SITE.socials.twitter,
          SITE.socials.linkedin,
        ],
        foundingDate: SITE.founded,
      },
      {
        "@type": "WebSite",
        "@id": SITE_ID,
        url: SITE.url,
        name: SITE.name,
        description: SITE.description,
        inLanguage: "en",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "SoftwareApplication",
        "@id": APP_ID,
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        applicationCategory: "MultimediaApplication",
        operatingSystem: SITE.operatingSystems.join(", "),
        downloadUrl: SITE.repo.releasesLatest,
        installUrl: SITE.repo.releasesLatest,
        softwareVersion: "latest",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
        publisher: { "@id": ORG_ID },
        featureList: [
          "Real-time speech transcription from live sermon audio",
          "Automatic Bible verse detection from explicit citations and quoted passages",
          "Broadcast-ready scripture overlays via NDI",
          "Multi-translation support: KJV, ESV, NIV, NKJV, NLT",
          "Direct integration with OBS Studio and vMix",
          "Free and open source",
        ],
        keywords:
          "Bible verse detection, sermon transcription, NDI overlay, church broadcast, live scripture",
      },
      {
        "@type": "FAQPage",
        "@id": FAQ_ID,
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.answer,
          },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
