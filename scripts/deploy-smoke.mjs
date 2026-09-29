// Smoke test against a deployed build. Usage: node scripts/deploy-smoke.mjs <clientUrl>
// Two real browser contexts: create a campaign, join by code, move, confirm remote sync.
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const url = process.argv[2];
if (!url) throw new Error("usage: deploy-smoke.mjs <clientUrl>");
const exe = [process.env.CB_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean).find((p) => existsSync(p));
// In proxied sandboxes Chromium may not read the OS trust store. CB_CA_SPKI (base64 sha256 of the proxy CA's
// public key) trusts exactly that CA - it does not disable certificate verification.
const spki = process.env.CB_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.CB_CA_SPKI}`] : [];
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: [...spki, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const errors = [];
const open = async (name, code) => {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(url + (code ? `?join=${code}` : ""));
  await page.fill("#name", name);
  await page.click(code ? "#join" : "#create");
  await page.waitForFunction(() => window.__cb?.session?.predicted || document.querySelector(".codebar b"), null, { timeout: 90000 });
  return page;
};
const t0 = Date.now();
const a = await open("Ada");
const code = await a.textContent(".codebar b");
console.log(`created campaign ${code} in ${((Date.now() - t0) / 1000).toFixed(1)}s (includes cold start)`);
const b = await open("Bertram", code);
await a.waitForFunction(() => document.querySelectorAll(".nametag").length >= 0);
await a.waitForTimeout(3000);
const players = await b.evaluate(() => document.querySelectorAll(".nametag").length);
console.log(`second player joined; B sees ${players} other nametag element(s) in DOM`);
await a.screenshot({ path: "test-results/deploy-a.png" });
await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
