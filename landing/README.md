# Rhema landing site

Public-facing landing page for Rhema, served at <https://openbezal.github.io/rhema/>.

This workspace is fully isolated from the Tauri desktop app at the repo root — its
own `package.json`, lockfile, and build output. The two never share code.

## Stack

- Vite 7 + React 19 + TypeScript (strict)
- Tailwind CSS v4
- [`motion`](https://motion.dev) for hero animations
- Fonts: Fraunces Variable (display), Geist Variable (sans), Geist Mono (captions)

## Develop

```sh
cd landing
bun install
bun run dev       # http://localhost:3001
```

The dev server runs on port 3001 so it does not collide with the desktop app
(which uses port 3000).

## Quality gates

```sh
bun run typecheck
bun run lint
bun run build
```

All three must pass before the deploy workflow publishes a change.

## Deploy

Pushes to `main` that touch `landing/**` run `.github/workflows/landing-deploy.yml`,
which builds the site and publishes `landing/dist/` to the `gh-pages` branch. The
workflow can also be triggered manually via the Actions tab (`workflow_dispatch`).

### One-time setup

In the repo, open **Settings → Pages**, then:

1. Under **Source**, select **Deploy from a branch**.
2. Pick the `gh-pages` branch and the `/ (root)` folder.
3. Save. The first successful workflow run will populate the branch.

Subsequent pushes to `main` that touch `landing/**` redeploy automatically.

## Screenshot capture (US-008)

The hero screenshot is captured manually from the running desktop app. To update it:

1. Run the desktop app in dark mode at a window size of **1280 × 800**
2. Trigger a live transcription session with a realistic verse-detection moment
3. Ensure no real API keys are visible on screen
4. Capture at 2× DPR, export as `hero.webp` (< 300 KB) and `hero.png` fallback
5. Drop the files into `landing/public/screenshots/`

## Why the `/rhema/` base path?

GitHub Pages serves project sites at `<owner>.github.io/<repo>/`, so Vite's
`base` option in `vite.config.ts` is set to `/rhema/`. If a custom domain is ever
pointed at the site, change `base` back to `/`.
