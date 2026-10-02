// Screenshot a client URL headlessly. Usage: node scripts/shot.mjs "<path?query>" out.png [WxH] [waitMs]
// Requires the client dev server (pnpm dev:client; or `pnpm --filter @cb/client exec vite --port N --strictPort` with CB_PORT=N). Software GL: stills only, never a perf number.
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const [path, out, size = "1280x720", wait = "2500"] = process.argv.slice(2);
if (!path || !out) throw new Error('usage: shot.mjs "<path?query>" out.png [WxH] [waitMs]');
const [w, h] = size.split("x").map(Number);
const exe = [process.env.CB_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => console.log("PAGE:", m.text()));
// (CB_PORT: each parallel package runs its own Vite, D-037; default is the usual dev client)
await page.goto(`http://127.0.0.1:${process.env.CB_PORT ?? 5173}/${path}`);
await page.waitForTimeout(Number(wait));
const stats = await page.evaluate(() => window.__showcase?.stats?.());
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, stats, errors: errors.filter((e) => !/404|favicon/.test(e)) }));
await browser.close();
