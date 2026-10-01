import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (n: string): string => readFileSync(new URL(`../../../docs/${n}`, import.meta.url), "utf8");

describe("D-036 docs say what the code does", () => {
  it("DEPLOYMENT: desktop build, demo env, website hosting options NOT built, and the persistence-default finding", () => {
    const d = doc("DEPLOYMENT.md");
    for (const t of ["dist:dir", "CB_SERVER_URL", "CB_WISHLIST_URL", "CB_STEAM", "CB_UPDATES", "app://game", "ALLOWED_ORIGINS", "DEMO_MODE", "DEMO_SESSION_SECONDS", "VITE_DEMO", "VITE_WISHLIST_URL", "4420", "Hosting options (NOT built", "CAMPAIGN_STORE", "IDENTITY_PEPPER", "render.yaml"]) expect(d, t).toContain(t);
  });
  it("STEAM_RELEASE: the adapter, the flags, real is unimplemented, and the human-only list", () => {
    const d = doc("STEAM_RELEASE.md");
    for (const t of ["PlatformAdapter", "CB_STEAM=stub", "CB_STEAM=real", "not implemented", "Human-only list", "App ID", "notarisation", "evaluateAchievements"]) expect(d, t).toContain(t);
  });
  it("PRIVACY_DATA_MAP: no telemetry, update checks off, no analytics on the site, demo saves nothing, the device id is the credential", () => {
    const d = doc("PRIVACY_DATA_MAP.md");
    for (const t of ["No telemetry", "Update checks are OFF", "No analytics", "Nothing is saved", "device id is still the credential"]) expect(d, t).toContain(t);
  });
});
