// Headless boot and frame-time capture on the SOFTWARE rasteriser. Usage: node scripts/boot-capture.mjs [low|medium|high|test] [extra query, e.g. "&shaderchecks=0"] [WxH]
// Needs `pnpm dev` running (env PORT overrides the client port). Prints one JSON line:
//   nameS     seconds from navigation until Playwright sees #name (the front door is usable; it is starved by long tasks, so a slow run reads high)
//   playableS seconds from navigation until a created session has a predicted position (door -> server -> world built -> shaders linked -> first frame)
//   fps       rAF callbacks per second in game, 5 s
//   ms        one full frame rendered and SYNCED (readPixels), averaged over 6: the GPU-process time, which is what the frame rate is made of
//   calls/tris/progs  renderer.info of one frame (shadow pass included) and the number of linked programs
// Software-GL numbers are a floor, never a performance claim; compare builds with each other, on the same machine, back to back.
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const gfx = process.argv[2] ?? "low";
const extra = process.argv[3] ?? "";
const [w, h] = (process.argv[4] ?? "800x450").split("x").map(Number);
const port = process.env.PORT ?? 5173;
const exe = [process.env.CB_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 200)));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?gfx=${gfx}${extra}`);
await page.waitForSelector("#name", { timeout: 170_000 });
const nameS = (Date.now() - t0) / 1000;
await page.fill("#name", "Boot");
await page.click("#create");
await page.waitForFunction(() => window.__cb?.session?.predicted, null, { timeout: 170_000 });
const playableS = (Date.now() - t0) / 1000;
await page.waitForTimeout(2500);
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const start = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - start < 5000) requestAnimationFrame(tick);
        else resolve(+(n / 5).toFixed(2));
      };
      requestAnimationFrame(tick);
    }),
);
const frame = await page.evaluate(() => {
  const s = window.__cb.stage;
  const gl = s.renderer.getContext();
  const info = s.renderer.info;
  window.requestAnimationFrame = () => 0; // the game's own loop stops: this frame is measured alone
  const px = new Uint8Array(4);
  const one = () => {
    s.renderer.render(s.scene, s.camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // a sync point: without it the GPU process's work is not in the time
  };
  one();
  one();
  const t = performance.now();
  for (let i = 0; i < 6; i++) one();
  const ms = Math.round((performance.now() - t) / 6);
  info.reset();
  one();
  return { ms, calls: info.render.calls, tris: info.render.triangles, progs: info.programs.length };
});
console.log(JSON.stringify({ gfx, extra, size: `${w}x${h}`, nameS: +nameS.toFixed(1), playableS: +playableS.toFixed(1), fps, ...frame }));
await browser.close();
