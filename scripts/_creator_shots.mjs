import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
const out = process.argv[2];
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => existsSync(p));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://127.0.0.1:5173/?x=1");
await page.waitForTimeout(3000);
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); };
for (const tab of ["body", "face", "clothes", "colour"]) {
  await page.click(`.creator [data-tab="${tab}"]`);
  await shot(`cr_${tab}`);
}
// interactions on the face page: shuffle a section, undo, then a bad paste and a good one
await page.click('.creator [data-tab="face"]');
await page.click('.creator button.shuffle >> nth=1');
await shot("cr_shuffled");
console.log("undo disabled after shuffle:", await page.$eval('.creator [data-act="undo"]', (b) => b.disabled));
await page.click('.creator [data-act="undo"]');
console.log("undo disabled after undo:", await page.$eval('.creator [data-act="undo"]', (b) => b.disabled), "redo disabled:", await page.$eval('.creator [data-act="redo"]', (b) => b.disabled));
await page.fill(".creator .codefield", "not a code at all!");
await page.press(".creator .codefield", "Enter");
console.log("status:", await page.$eval(".creator .status", (e) => e.textContent));
await shot("cr_badpaste");
await page.click('.creator .posebar button:has-text("Triumph")');
await page.click('.creator [data-tab="types"]');
await page.click('.creator .preset >> nth=3');
console.log("status:", await page.$eval(".creator .status", (e) => e.textContent));
await page.waitForTimeout(1500);
await shot("cr_preset_triumph");
console.log(JSON.stringify({ errors: errors.filter((e) => !/404|favicon/.test(e)) }));
await browser.close();
