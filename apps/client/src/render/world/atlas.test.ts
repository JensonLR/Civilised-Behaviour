import { describe, expect, it } from "vitest";
import { BOARD_TEXT, CLOCK_UV, CREST_UV, FLAG_UV, MAP_UV, NOTICE_UV, boardUv, stencilUv, swatchUv, vsignUv, type Rect } from "./atlas.ts";
import { VILLAGE_SIGNS } from "@cb/shared";

/** The camp atlas's regions never overlap: the bunting swatches (and a stray white patch) were painted on the end of the first signboard, which showed them. */
const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

describe("camp atlas layout", () => {
  it("no swatch sample lies inside a drawn region", () => {
    const regions: Rect[] = [FLAG_UV, MAP_UV, CLOCK_UV, CREST_UV, NOTICE_UV, ...BOARD_TEXT.map((_, i) => boardUv(i)), ...VILLAGE_SIGNS.map((_, i) => vsignUv(i)), ...[0, 1, 2, 3].map(stencilUv)];
    for (let i = 0; i < 4; i++) for (const r of regions) expect(overlaps(swatchUv(i), r), `swatch ${i}`).toBe(false);
  });
});
