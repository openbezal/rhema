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
    latestRelease: "https://github.com/openbezal/rhema/releases/latest",
    // `/releases/latest` resolves to the newest published, non-prerelease
    // release, so these track each tagged release with no hand re-upload. The
    // release workflow ships a copy of each installer under these exact stable
    // filenames (Tauri's own bundle names carry the version); keep them in sync
    // with the `aliases` list in .github/workflows/build-release.yml or these
    // links 404.
    downloadWindows:
      "https://github.com/openbezal/rhema/releases/latest/download/Rhema-windows-x64-setup.exe",
    // Apple Silicon only — the build matrix has no x86_64-apple-darwin target.
    downloadMac:
      "https://github.com/openbezal/rhema/releases/latest/download/Rhema-macos-arm64.dmg",
    // AppImage runs on any distro without a package manager step, so it is the
    // one-click choice; .deb and .rpm stay on the release page.
    downloadLinux:
      "https://github.com/openbezal/rhema/releases/latest/download/Rhema-linux-x86_64.AppImage",
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
 * Where a "Download" CTA should point: straight at the installer for the
 * visitor's platform. Church volunteers should not have to pick a file out of a
 * GitHub release page. Unrecognised platforms still land on the release list,
 * where every bundle (.msi, .deb, .rpm) is available.
 */
export function downloadHref(platform: string | null | undefined): string {
  switch (platform) {
    case "windows":
      return SITE.repo.downloadWindows;
    case "mac":
      return SITE.repo.downloadMac;
    case "linux":
      return SITE.repo.downloadLinux;
    default:
      return SITE.repo.latestRelease;
  }
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
