// Smoke test against a deployed build. Usage: node scripts/deploy-smoke.mjs <clientUrl>  (behind a proxy that refuses browser WebSockets: NODE_USE_ENV_PROXY=1 CB_WS_RELAY=1)
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
// CB_WS_RELAY=1 (run with NODE_USE_ENV_PROXY=1): some sandboxes' intercepting proxies answer a BROWSER's WebSocket upgrade with 404 while a CONNECT tunnel works (the
// Claude Code cloud sandbox does: /root/.ccr/README.md lists WebSocket upgrades as unsupported). The relay hands the page's game socket to Node's own WebSocket, which tunnels
// through HTTPS_PROXY. Bytes pass through unchanged; without it a live join here fails with "Unexpected response code: 404" and says nothing about the deployment.
const relay = async (page) => {
  if (!process.env.CB_WS_RELAY) return;
  await page.routeWebSocket(/^wss?:/, (route) => {
    const up = new WebSocket(route.url());
    up.binaryType = "arraybuffer";
    const queue = [];
    up.onopen = () => { for (const m of queue.splice(0)) up.send(m); };
    up.onmessage = (e) => route.send(typeof e.data === "string" ? e.data : Buffer.from(e.data));
    up.onclose = (e) => route.close({ code: e.code === 1005 ? 1000 : e.code, reason: e.reason });
    route.onMessage((m) => (up.readyState === 1 ? up.send(m) : queue.push(m)));
    route.onClose(() => up.close());
  });
  // installed after the route (whose mock replaces window.WebSocket): Playwright's mock rejects the SDK's non-string `protocols` argument; drop it (the game never asks for a subprotocol)
  await page.addInitScript(() => queueMicrotask(() => {
    const W = window.WebSocket;
    const F = function (u, p) { return typeof p === "string" || (Array.isArray(p) && p.every((x) => typeof x === "string")) ? new W(u, p) : new W(u); };
    F.prototype = W.prototype;
    Object.assign(F, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = F;
  }));
};
const open = async (name, code) => {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  await relay(page);
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(url + (code ? `?join=${code}` : ""));
  await page.fill("#name", name);
  await page.click(code ? "#join" : "#create");
  await page.waitForFunction(() => window.__cb?.session?.predicted || document.querySelector(".codebar b"), null, { timeout: 90000 }).catch((e) => {
    console.log(`${name} never reached the game. Console errors so far:\n${errors.join("\n") || "(none)"}`);
    throw e;
  });
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
