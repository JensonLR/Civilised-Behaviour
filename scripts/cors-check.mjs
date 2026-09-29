// Real-browser CORS check against a deployment: loads the client origin in Chromium and makes the same
// credentialed matchmaking request the SDK makes. curl cannot catch CORS bugs; this can.
// Usage: CB_CA_SPKI=<base64 sha256 of proxy CA key, sandbox only> node scripts/cors-check.mjs <clientUrl> <serverUrl>
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const [clientUrl, serverUrl] = process.argv.slice(2);
if (!clientUrl || !serverUrl) throw new Error("usage: cors-check.mjs <clientUrl> <serverUrl>");
const exe = [process.env.CB_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter(Boolean).find((p) => existsSync(p));
const spki = process.env.CB_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.CB_CA_SPKI}`] : [];
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: [...spki, "--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
await page.goto(clientUrl);
const result = await page.evaluate(async (url) => {
  try {
    const r = await fetch(`${url}/matchmake/create/world`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "cors" }) });
    return `ok ${r.status}`;
  } catch (e) {
    return `blocked: ${e.message}`;
  }
}, serverUrl);
console.log(result);
await browser.close();
process.exit(result.startsWith("ok 200") ? 0 : 1);
