import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wf = (n: string): string => readFileSync(new URL(`../../../.github/workflows/${n}`, import.meta.url), "utf8");
const code = (s: string): string => s.replace(/^\s*#.*$/gm, "");

describe("CI workflows (D-036)", () => {
  it("desktop.yml: dispatch or a desktop tag only, three OSes, unsigned, no secret referenced, artifacts uploaded", () => {
    const y = code(wf("desktop.yml"));
    expect(y).toMatch(/workflow_dispatch:/);
    expect(y).toMatch(/tags: \["desktop-v\*"\]/);
    expect(y).not.toMatch(/\bpull_request\b|branches:|schedule:|cron:/);
    expect(y).toMatch(/os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    expect(y).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
    expect(y).toMatch(/electron-builder|dist:dir/);
    expect(y).not.toMatch(/--publish|\bpublish\b(?!:)/);
    expect(y).not.toMatch(/secrets\.|\$\{\{\s*secrets|GH_TOKEN|GITHUB_TOKEN|CSC_LINK|CSC_KEY_PASSWORD|APPLE_|WIN_CSC|notariz/i);
    expect(y).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(y).toMatch(/upload-artifact@v4/);
    expect(y).toMatch(/pnpm install --frozen-lockfile/);
  });
  it("website.yml: builds and tests, uploads, never deploys, no secret", () => {
    const y = code(wf("website.yml"));
    expect(y).toMatch(/pnpm --filter @cb\/website test/);
    expect(y).toMatch(/pnpm --filter @cb\/website run site/);
    expect(y).not.toMatch(/deploy|secrets\.|pages:|wrangler|rsync|scp |s3 /i);
  });
  it("ci.yml runs the website test and the desktop typecheck", () => {
    const y = wf("ci.yml");
    expect(y).toMatch(/pnpm --filter @cb\/website test/);
    expect(y).toMatch(/pnpm --filter @cb\/desktop typecheck/);
  });
});
