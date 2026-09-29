import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Art-direction guard: colours live in packages/shared/src/palette.ts. A six-digit hex literal anywhere else in the rendering
 * code is a colour the palette (and its tests) do not know about, which is how a game ends up with 40 unrelated browns.
 * Black and white are allowed for tints and masks; hash constants have eight digits and are not matched.
 */
const roots = ["../../../packages/procedural/src", "./render", "./game", "./ui", "./showcase"].map((r) => new URL(r, import.meta.url).pathname);
const ALLOWED = new Set(["0x000000", "0xffffff"]);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });

describe("palette guard", () => {
  it("no stray colour literals in rendering code", () => {
    const stray: string[] = [];
    for (const root of roots) {
      for (const f of files(root)) {
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            for (const m of line.matchAll(/\b0x[0-9a-fA-F]{6}\b/g)) if (!ALLOWED.has(m[0].toLowerCase())) stray.push(`${f.slice(Math.max(f.lastIndexOf("/packages/"), f.lastIndexOf("/apps/")) + 1)}:${i + 1} ${m[0]}`);
          });
      }
    }
    expect(stray).toEqual([]);
  });
});
