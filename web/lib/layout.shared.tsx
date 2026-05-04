import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { SITE } from "@/app/_lib/site";
import { RhemaLogo } from "@/app/_components/ui/rhema-logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <RhemaLogo size="sm" />,
      url: "/",
    },
    githubUrl: SITE.repo.url,
    links: [
      {
        text: "Home",
        url: "/",
        active: "url",
      },
      {
        text: "Documentation",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "Releases",
        url: SITE.repo.releasesLatest,
        external: true,
      },
    ],
  };
}
