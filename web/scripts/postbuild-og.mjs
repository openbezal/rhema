// @ts-check
// Post-build fixup for GitHub Pages.
//
// next/og generates image routes as files without an extension:
//   out/opengraph-image     (PNG bytes, no extension)
//   out/twitter-image       (PNG bytes, no extension)
//   out/apple-icon          (PNG bytes, no extension)
//
// GitHub Pages serves files based on extension, so these end up as
// application/octet-stream and social/AI crawlers reject them. Rename
// them to .png and patch the URLs Next.js wrote into the HTML.

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = new URL("../out/", import.meta.url).pathname;

const TARGETS = [
  { route: "opengraph-image" },
  { route: "twitter-image" },
  { route: "apple-icon" },
];

async function renameTargets() {
  for (const t of TARGETS) {
    const src = join(OUT_DIR, t.route);
    const dest = `${src}.png`;
    if (!existsSync(src)) continue;
    const s = await stat(src);
    if (!s.isFile()) continue;
    await rename(src, dest);
    console.log(`renamed: ${t.route} -> ${t.route}.png`);
  }
}

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(full);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield full;
  }
}

async function patchHtml() {
  // Matches /opengraph-image, /twitter-image, or /apple-icon followed by an
  // optional ?<hex hash> query string. Strips the query, appends .png.
  const re = /\/(opengraph-image|twitter-image|apple-icon)(\?[A-Fa-f0-9]+)?(?=["'\s>])/g;
  let touched = 0;
  for await (const file of walkHtml(OUT_DIR)) {
    const original = await readFile(file, "utf8");
    const next = original.replace(re, "/$1.png");
    if (next !== original) {
      await writeFile(file, next);
      touched++;
    }
  }
  console.log(`patched ${touched} html file(s)`);
}

await renameTargets();
await patchHtml();
