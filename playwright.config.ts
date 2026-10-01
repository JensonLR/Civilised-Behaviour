import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Use the sandbox's pre-installed Chromium when present; CI installs Playwright's own browser.
const candidates = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"];
const executablePath = process.env.CB_CHROMIUM ?? candidates.find((p) => existsSync(p));

export default defineConfig({
  testDir: "tests/e2e",
  // Multi-browser scenarios on a software-rendered (~10 fps) runner are slow by nature; polls inside tests carry their own budgets.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // Two projects (D-036): the full game on :5173/:2567, and the bounded web demo on :5175/:2568 (its own client build switch and server, so the full-game specs never see a demo).
  projects: [
    { name: "game", testIgnore: /demo\.spec\.ts/ },
    { name: "demo", testMatch: /demo\.spec\.ts/, use: { baseURL: "http://127.0.0.1:5175" } },
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    // Small viewport: e2e runs on a software rasteriser, and frame time scales with pixels. Visual QA uses scripts/shot.mjs.
    viewport: { width: 800, height: 450 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
    },
  },
  webServer: [
    {
      command: "pnpm --filter @cb/server dev",
      // The specs found campaigns at a region / contract through the URL; the server honours that only with debug commands on.
      env: { DEBUG_COMMANDS: "1" },
      url: "http://127.0.0.1:2567/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @cb/client dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // the demo's server: DEMO_MODE on, a 20 s session (honoured only outside production), its own port, and a FILE store the demo spec checks stays empty (a demo saves nothing)
      command: "pnpm --filter @cb/server dev",
      env: { DEBUG_COMMANDS: "1", DEMO_MODE: "1", DEMO_SESSION_SECONDS: "20", PORT: "2568", CAMPAIGN_STORE: "file", SAVE_DIR: resolve("test-results/demo-saves") },
      url: "http://127.0.0.1:2568/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // the demo's client: the SAME code with the demo switch compiled on, pointed at the demo server
      command: "pnpm --filter @cb/client exec vite --host 127.0.0.1 --port 5175 --strictPort",
      env: { VITE_DEMO: "1", VITE_SERVER_URL: "ws://127.0.0.1:2568" },
      url: "http://127.0.0.1:5175",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
