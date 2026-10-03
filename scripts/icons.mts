// The game's icon set (D-053), every file drawn from the Society's seal (packages/shared/src/emblem.ts) and the palette, so a colour change is one regeneration away.
// Usage: npx tsx scripts/icons.mts   (needs the pre-installed Chromium: the PNGs are rasterised by a real browser, the SVGs written as they are)
// Writes, and the files are committed (the hosts' static builds have no browser to rasterise with; `emblem.test.ts` fails when a committed SVG drifts from the generator):
//   apps/client/public/   favicon.svg  favicon-32.png  apple-touch-icon.png (180)  icon-192.png  icon-512.png  icon-maskable-512.png  manifest.webmanifest
//   apps/website/brand/   the same icons + seal.svg (the transparent seal for the masthead)
//   apps/desktop/resources/ icon.png (1024: electron-builder takes `<buildResources>/icon.png`; `build/` is git-ignored, so the folder is `resources`)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emblemColours, emblemSvg } from "../packages/shared/src/emblem.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(repo, "apps/client/public");
const SITE = join(repo, "apps/website/brand");
const DESKTOP = join(repo, "apps/desktop/resources");
for (const d of [CLIENT, SITE, DESKTOP]) mkdirSync(d, { recursive: true });

const FILES = {
  favicon: emblemSvg({ detail: "small" }),
  seal: emblemSvg({}),
  tile: emblemSvg({ tile: true }),
  maskable: emblemSvg({ tile: true, scale: 0.74 }),
};
const colours = emblemColours();
const manifest = {
  name: "Civilised Behaviour",
  short_name: "Civilised",
  description: "A satirical co-operative expedition game for one to four.",
  start_url: "/",
  display: "fullscreen",
  orientation: "landscape",
  background_color: colours.background,
  theme_color: colours.theme,
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ deviceScaleFactor: 1 });
/** Rasterises `svg` at `px` square; `transparent` keeps the alpha (a favicon), else the tile is opaque. */
async function png(svg: string, px: number, transparent: boolean): Promise<Buffer> {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" width="${px}" height="${px}" style="display:block" src="data:image/svg+xml,${encodeURIComponent(svg)}"></body></html>`);
  await page.waitForFunction(() => (document.getElementById("i") as HTMLImageElement).complete);
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: px, height: px } });
}

const write = (dir: string, name: string, data: string | Buffer): void => writeFileSync(join(dir, name), data);
const rasters: [string, Buffer][] = [
  ["favicon-32.png", await png(FILES.favicon, 32, true)],
  ["apple-touch-icon.png", await png(FILES.tile, 180, false)],
  ["icon-192.png", await png(FILES.tile, 192, false)],
  ["icon-512.png", await png(FILES.tile, 512, false)],
  ["icon-maskable-512.png", await png(FILES.maskable, 512, false)],
];
// the game is played full screen and sideways; the landing page is a page
const siteManifest = { ...manifest, description: "The Society's dispatch: what Civilised Behaviour is, and the press facts.", display: "standalone", orientation: undefined };
for (const [dir, m] of [[CLIENT, manifest], [SITE, siteManifest]] as const) {
  write(dir, "favicon.svg", FILES.favicon);
  for (const [n, d] of rasters) write(dir, n, d);
  write(dir, "manifest.webmanifest", `${JSON.stringify(m, null, 2)}\n`);
}
write(SITE, "seal.svg", FILES.seal);
write(DESKTOP, "icon.png", await png(FILES.tile, 1024, false));
await b.close();
console.log("icons written:", [CLIENT, SITE, DESKTOP].map((d) => d.slice(repo.length + 1)).join(", "));
