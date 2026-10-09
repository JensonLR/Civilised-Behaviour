import { describe, expect, it } from "vitest";
import { FIGURE_DEFAULT, figureFocus } from "./doorFrame.ts";

describe("the figure behind the door stands where no panel covers it (D-098)", () => {
  it("a PC: between the charter on the left and the creator on the right, as large as ever", () => {
    const f = figureFocus(1920, 1080, [
      { left: 58, top: 136, right: 518, bottom: 956 },
      { left: 1350, top: 186, right: 1812, bottom: 906 },
    ]);
    expect(f.cx).toBeCloseTo((518 + 1350) / 2 / 1920, 5);
    expect(f.cy).toBe(0.5);
    expect(f.size).toBe(FIGURE_DEFAULT.size);
  });

  it("a phone held upright: above the charter at the foot of the screen, smaller to fit the band", () => {
    const f = figureFocus(390, 844, [{ left: 12, top: 330, right: 378, bottom: 790 }]);
    expect(f.cx).toBe(0.5);
    expect(f.cy).toBeCloseTo(165 / 844, 5);
    expect(f.size).toBeCloseTo((330 * 0.78) / 844, 5);
    expect(f.size).toBeLessThan(FIGURE_DEFAULT.size);
  });

  it("a phone held sideways: to the right of the charter, full size", () => {
    const f = figureFocus(844, 390, [{ left: 12, top: 10, right: 444, bottom: 380 }]);
    expect(f.cx).toBeCloseTo((444 + 844) / 2 / 844, 5);
    expect(f.size).toBe(FIGURE_DEFAULT.size);
  });

  it("nowhere to stand (the screen covered, or a sliver left): the old framing, unmoved", () => {
    expect(figureFocus(390, 844, [{ left: 0, top: 40, right: 390, bottom: 844 }])).toEqual(FIGURE_DEFAULT);
    expect(figureFocus(390, 844, [{ left: 0, top: 0, right: 390, bottom: 844 }])).toEqual(FIGURE_DEFAULT);
    expect(figureFocus(0, 0, [])).toEqual(FIGURE_DEFAULT);
  });

  it("no panels: the middle of the screen", () => {
    expect(figureFocus(1280, 720, [])).toEqual({ cx: 0.5, cy: 0.5, size: 0.4 });
  });
});
