import { describe, expect, it } from "vitest";
import { signLayout } from "./signLettering.ts";

/** A long sign on one line shrank to a third of the board and could not be read; it goes to two lines when that gives bigger letters. */
const measure = (line: string, px: number): number => line.length * px * 0.62;

describe("sign lettering", () => {
  it("a short line is set large on one line", () => {
    const l = signLayout("NO WAKE.", 472, measure);
    expect(l.lines).toEqual(["NO WAKE."]);
    expect(l.px).toBe(48);
  });
  it("a long one is split at the sentence break nearest its middle, larger than it could be on one line", () => {
    const text = "REED LANDING. PLEASE TAKE A NUMBER.";
    const l = signLayout(text, 472, measure);
    expect(l.lines).toEqual(["REED LANDING.", "PLEASE TAKE A NUMBER."]);
    let one = 48;
    while (measure(text, one) > 472) one -= 2;
    expect(l.px).toBeGreaterThan(one);
    for (const line of l.lines) expect(measure(line, l.px)).toBeLessThanOrEqual(472);
  });
  it("without a sentence break it splits at a word", () => {
    const l = signLayout("THE VERY LONG AND UNPUNCTUATED NOTICE OF THE BOARD OF WORKS", 472, measure);
    expect(l.lines).toHaveLength(2);
    expect(l.lines.join(" ")).toBe("THE VERY LONG AND UNPUNCTUATED NOTICE OF THE BOARD OF WORKS");
  });
  it("D-097: a short heading over a long line is set larger than the long line, by no more than a third", () => {
    const l = signLayout("MARKET TERRACE. CHEQUES ACCEPTED AT THE CHEQUE STALL.", 472, measure);
    expect(l.lines).toEqual(["MARKET TERRACE.", "CHEQUES ACCEPTED AT THE CHEQUE STALL."]);
    expect(l.sizes[0]).toBeGreaterThan(l.sizes[1]!);
    expect(l.sizes[0]! / l.sizes[1]!).toBeLessThanOrEqual(1.35);
    l.lines.forEach((line, i) => expect(measure(line, l.sizes[i]!)).toBeLessThanOrEqual(472));
    expect(l.px).toBe(Math.min(...l.sizes));
  });
});
