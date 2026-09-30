import { defineConfig } from "vitest/config";

export default defineConfig({
  // Integration tests run a real room with real timers (netcode, lag compensation, prediction drift). Running files side by side
  // loads the machine and delays server ticks, which fails timing-sensitive tests that pass alone, so files run one at a time.
  test: { environment: "node", testTimeout: 20000, hookTimeout: 20000, include: ["src/**/*.test.ts"], fileParallelism: false },
});
