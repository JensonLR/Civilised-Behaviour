// Headless client performance capture. Usage: node scripts/perf-capture.mjs [WxH] [low|medium|high] [seconds]
// Requires `pnpm dev` (server + client) to be running. Software GL numbers are a floor, not a target:
// real-GPU numbers go in docs/PERFORMANCE.md separately.
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const [w, h] = (process.argv[2] ?? "1280x720").split("x").map(Number);
const gfx = process.argv[3] ?? "medium";
const seconds = Number(process.argv[4] ?? 4);
const candidates = [process.env.CB_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
await page.goto(`http://127.0.0.1:5173/?gfx=${gfx}`);
await page.fill("#name", "Perf");
await page.click("#create");
await page.waitForFunction(() => window.__cb?.session.predicted);
await page.keyboard.press("F3");
await page.waitForTimeout(seconds * 1000);
console.log(`${w}x${h} ${gfx}\n${await page.evaluate(() => window.__cb.game.overlay.snapshot())}\n`);
await browser.close();
