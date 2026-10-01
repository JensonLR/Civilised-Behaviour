import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Shared sim code is deterministic: it never reads a clock or Math.random (use the host's `now`, `Rng`, `hash3`). */
const root = new URL(".", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
/** Code only: block comments, line comments and string/template literals blanked out (crudely, which is enough for a grep guard). */
const code = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');

describe("shared sim code reads no clock and no Math.random", () => {
  const all = files(root);
  it("scans the whole shared source tree", () => {
    expect(all.length).toBeGreaterThan(40);
  });
  for (const pattern of [/\bperformance\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/]) {
    it(`no ${pattern.source} outside tests`, () => {
      const bad = all.filter((f) => pattern.test(code(readFileSync(f, "utf8")))).map((f) => f.slice(root.length));
      expect(bad).toEqual([]);
    });
  }
});
