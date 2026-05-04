export const SITE = {
  name: "Rhema",
  tagline: "Your Pastor speaks. Rhema finds the verse.",
  description:
    "Rhema listens to a live sermon audio feed, transcribes speech in real time, detects Bible verse references (both explicit citations and quoted passages), and renders them as broadcast-ready overlays via NDI for live production.",
  url: "https://openrhema.com",
  repo: {
    owner: "openbezal",
    name: "rhema",
    url: "https://github.com/openbezal/rhema",
    releasesLatest: "https://github.com/openbezal/rhema/releases/latest",
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
