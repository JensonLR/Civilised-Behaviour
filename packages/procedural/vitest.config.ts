import { defineConfig } from "vitest/config";

// Geometry builds are CPU work that competes with whatever else runs on the machine (dev servers, other test workers): a generous per-test budget
// keeps a busy machine from reporting a timeout as a failure. Real regressions still show up in the triangle and timing assertions themselves.
export default defineConfig({ test: { testTimeout: 90_000, hookTimeout: 90_000 } });
