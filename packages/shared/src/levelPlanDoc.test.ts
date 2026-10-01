import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { highmarkLevel } from "./highmark.ts";
import { kessarLevel } from "./kessar.ts";
import { saltmarketLevel } from "./saltmarket.ts";
import { vesperLevel } from "./vesper.ts";
import { villageLevel } from "./village.ts";

/** D-038: the plan of record (docs/LEVEL_PLAN.md) and the five regions' `LevelBuilding`s must not drift: every declared building has a row in the as-built table. */
const doc = readFileSync(new URL("../../../docs/LEVEL_PLAN.md", import.meta.url), "utf8");
const asBuilt = doc.slice(doc.indexOf("### As built"), doc.indexOf("### Routes, spawns"));

describe("LEVEL_PLAN.md as-built table", () => {
  const regions = { Hollowmere: villageLevel(), Kessar: kessarLevel(), Highmark: highmarkLevel(), Vesper: vesperLevel(), Saltmarket: saltmarketLevel() };
  for (const [name, level] of Object.entries(regions)) {
    it(`${name}: every building id has a row with its kind`, () => {
      expect(asBuilt.length).toBeGreaterThan(100);
      for (const b of level.buildings) {
        const row = asBuilt.split("\n").find((l) => l.startsWith(`| ${name} | ${b.id} |`));
        expect(row, `${name} ${b.id} has no row in LEVEL_PLAN.md "As built"`).toBeDefined();
        expect(row!.includes(`| ${b.kind} |`), `${name} ${b.id}: the row's kind differs from "${b.kind}"`).toBe(true);
      }
    });
  }
});
