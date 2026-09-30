// Contact sheet: node scripts/_scratch/sheet.mjs out.png cols WxH waitMs "query1" "query2" ...
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [out, cols, size, wait, ...urls] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => existsSync(p));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: w, height: h } });
const dir = out.replace(/\.png$/, "_tiles");
mkdirSync(dir, { recursive: true });
const files = [];
const errors = [];
let i = 0;
for (const u of urls) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/404|favicon/.test(m.text()) && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:5173/${u}`);
  await page.waitForTimeout(Number(wait));
  const f = `${dir}/t${String(i++).padStart(2, "0")}.png`;
  await page.screenshot({ path: f });
  files.push(f);
  await page.close();
}
await browser.close();
execFileSync("python3", ["-c", `
import sys
from PIL import Image
cols=int(sys.argv[2]); files=sys.argv[3:]
ims=[Image.open(f) for f in files]
w,h=ims[0].size
rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(w*cols,h*rows))
for i,im in enumerate(ims): S.paste(im,((i%cols)*w,(i//cols)*h))
S.save(sys.argv[1])`, out, cols, ...files]);
console.log(JSON.stringify({ out, errors }));
