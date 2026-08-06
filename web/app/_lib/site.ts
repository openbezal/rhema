export const SITE = {
  name: "Rhema",
  legalName: "openbezal",
  tagline: "Your Pastor speaks. Rhema finds the verse.",
  shortDescription:
    "Real-time AI Bible verse detection for live sermons. Free, open-source, broadcast-ready via NDI.",
  description:
    "Rhema listens to a live sermon audio feed, transcribes speech in real time, detects Bible verse references (both explicit citations and quoted passages), and renders them as broadcast-ready overlays via NDI for live production.",
  url: "https://openrhema.com",
  locale: "en_US",
  twitterHandle: "@openbezal",
  founded: "2025",
  category: "ChurchSoftware",
  operatingSystems: ["Windows", "macOS"],
  repo: {
    owner: "openbezal",
    name: "rhema",
    url: "https://github.com/openbezal/rhema",
    releases: "https://github.com/openbezal/rhema/releases",
    // Rolling prerelease published by .github/workflows/release-windows.yml on
    // every merge to main. The tag and filename are set by RELEASE_TAG and
    // ASSET_NAME in that workflow — change them together or this link breaks.
    // `/releases/latest` cannot be used here: GitHub excludes prereleases from it.
    downloadWindows:
      "https://github.com/openbezal/rhema/releases/download/nightly/Rhema-windows-x64-setup.exe",
    discussions: "https://github.com/openbezal/rhema/discussions",
    stars: { fallback: 221 },
  },
  socials: {
    github: "https://github.com/openbezal/rhema",
    twitter: "https://x.com/openbezal",
    linkedin: "https://www.linkedin.com/company/openbezal",
    email: "mailto:hello@openbezal.com",
  },
  stats: {
    languages: "2+",
    translations: "6+",
  },
} as const;

/**
 * Where a "Download" CTA should point. Windows is the only platform with a
 * prebuilt installer, so it gets the file directly; everyone else lands on the
 * releases page instead of being handed a .exe they can't run.
 */
export function downloadHref(platform: string | null | undefined): string {
  return platform === "windows"
    ? SITE.repo.downloadWindows
    : SITE.repo.releases;
}

export async function getGitHubStars(): Promise<number> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${SITE.repo.owner}/${SITE.repo.name}`,
      { headers }
    );
    if (!res.ok) return SITE.repo.stars.fallback;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : SITE.repo.stars.fallback;
  } catch {
    return SITE.repo.stars.fallback;
  }
}
