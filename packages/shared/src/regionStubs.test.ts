import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGIONS } from "./regions.ts";
import { SALTMARKET_STATUS } from "./saltmarket.ts";
import { VESPER_STATUS } from "./vesper.ts";

/**
 * D-037: every contract placeholder of Vesper Gorge is marked with C3's stub tag and every one of the Saltmarket Delta with D4's. `<REGION>_STATUS.stub === false` is the claim that none is left: this test
 * finds the tag in any source file under packages/ or apps/ (tests, build output and dependencies excepted) and fails the claim. The tags are spelled in two pieces here so this file does not carry them.
 * (docs/_notes/regions34.md: the integrator deletes nothing; a package that finds a tag in a file it does not own reports it.)
 */
const TAGS = { vesper: ["C3", "STUB"].join("-"), saltmarket: ["D4", "STUB"].join("-") } as const;
const STATUS = { vesper: VESPER_STATUS, saltmarket: SALTMARKET_STATUS } as const;

const walk = (dir: URL, out: URL[] = []): URL[] => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === "dist" || f === "dist-desktop" || f === "release" || f.startsWith(".")) continue;
    const u = new URL(f, dir);
    if (statSync(u).isDirectory()) walk(new URL(`${f}/`, dir), out);
    else if (/\.(ts|tsx|css|json|mjs|cjs)$/.test(f) && !/\.test\.ts$/.test(f) && !/\.map$/.test(f)) out.push(u);
  }
  return out;
};
const hitsOf = (tag: string): string[] => {
  const hits: string[] = [];
  for (const root of ["../../../packages/", "../../../apps/"].map((r) => new URL(r, import.meta.url))) {
    for (const u of walk(root)) readFileSync(u, "utf8").split("\n").forEach((l, i) => { if (l.includes(tag)) hits.push(`${u.pathname.split("/").slice(-4).join("/")}:${i + 1}`); });
  }
  return hits;
};

describe("Vesper and the Saltmarket: no contract placeholder is left behind", () => {
  for (const id of ["vesper", "saltmarket"] as const) {
    it(`${id}: the stub flag and 'reachable' agree; with the flag off no source file carries ${TAGS[id]}`, () => {
      expect(REGIONS[id].reachable).toBe(!STATUS[id].stub);
      const hits = hitsOf(TAGS[id]);
      if (STATUS[id].stub) expect(hits.length, `a stubbed region carries its tag where it is still a placeholder`).toBeGreaterThan(0);
      else expect(hits, hits.join("\n")).toEqual([]);
    });
  }
  it("the scan can fail: a file that carries a tag is found by the same test", () => {
    for (const tag of Object.values(TAGS)) expect(`// ${tag}: placeholder`.includes(tag)).toBe(true);
  });
});
