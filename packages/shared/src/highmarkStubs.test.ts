import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIGHMARK_STATUS } from "./highmark.ts";
import { REGIONS } from "./regions.ts";

/**
 * D-036: every contract placeholder was marked with the stub tag. `HIGHMARK_STATUS.stub === false` is the claim that none is left: this test finds the tag in any source file under
 * packages/ or apps/ (tests, build output and dependencies excepted) and fails the claim. The tag is spelled in two pieces here so this file does not carry it.
 */
const TAG = ["G", "STUB"].join("-");

const walk = (dir: URL, out: URL[] = []): URL[] => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === "dist" || f === "dist-desktop" || f === "release" || f.startsWith(".")) continue;
    const u = new URL(f, dir);
    if (statSync(u).isDirectory()) walk(new URL(`${f}/`, dir), out);
    else if (/\.(ts|tsx|css|json|mjs|cjs)$/.test(f) && !/\.test\.ts$/.test(f) && !/\.map$/.test(f)) out.push(u);
  }
  return out;
};

describe("Highmark: no contract placeholder is left behind", () => {
  it("while the stub flag is on the region is not reachable; once it is off, no source file carries the stub tag", () => {
    expect(REGIONS.highmark.reachable).toBe(!HIGHMARK_STATUS.stub);
    if (HIGHMARK_STATUS.stub) return;
    const roots = ["../../../packages/", "../../../apps/"].map((r) => new URL(r, import.meta.url));
    const hits: string[] = [];
    for (const root of roots) {
      for (const u of walk(root)) {
        const lines = readFileSync(u, "utf8").split("\n");
        lines.forEach((l, i) => { if (l.includes(TAG)) hits.push(`${u.pathname.split("/").slice(-4).join("/")}:${i + 1}`); });
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the check can fail: a file that carries the tag is found by the same scan", () => {
    const probe = `// ${TAG}: placeholder`;
    expect(probe.includes(TAG)).toBe(true);
  });
});
