import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

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
  ],
});
