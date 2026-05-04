# Rhema marketing site

Next.js 16 marketing site for [Rhema](https://openrhema.com). Static-only — no API routes, no server actions. Deployed to GitHub Pages on push to `main`.

## Develop

```bash
cd web
bun install
bun run dev
```

Opens [http://localhost:3029](http://localhost:3029).

## Build

```bash
bun run build
```

Outputs a static site to `web/out/`.

## Deploy

Pushes to `main` that touch `web/**` trigger `.github/workflows/deploy-web.yml`, which builds the static export and publishes it to GitHub Pages at [https://openrhema.com](https://openrhema.com).

To trigger a deploy without code changes (e.g., to refresh the GitHub stars count baked into the page), use the **Run workflow** button on the *Deploy web to GitHub Pages* action in the GitHub UI.

PRs touching `web/**` run the build job only (no deploy) as a smoke test.

## Notes

- `output: "export"` in `next.config.ts` — static export is required for GitHub Pages. Anything that needs a Node server (route handlers, server actions, ISR, `next/image` optimization) will fail the build.
- Self-hosted fonts under `public/fonts/`. Referenced from `app/globals.css` via absolute paths — do not introduce a `basePath`, it does not rewrite CSS `url()` values.
- `getGitHubStars()` runs at build time. Authenticated via `GITHUB_TOKEN` in CI to avoid the 60/hr unauthenticated rate limit; falls back to a hardcoded count if the API call fails.
