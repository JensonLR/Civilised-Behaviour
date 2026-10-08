import { describe, expect, it } from "vitest";
import { BABBLE_KEYS, BARK_KINDS, BARK_LINES, babbleKeyFor, barkLine, isBarkKind } from "./barks.ts";
import { REAL_WORLD_RE } from "./realWorld.ts";

describe("D-087: what the party says", () => {
  it("every occasion has lines (short enough for a slip over a head) and a babble shape", () => {
    for (const k of BARK_KINDS) {
      const b = BARK_LINES[k];
      expect(b.lines.length, k).toBeGreaterThanOrEqual(3);
      expect(BABBLE_KEYS, k).toContain(b.key);
      for (const l of b.lines) {
        expect(l.length, `${k}: ${l}`).toBeLessThanOrEqual(48);
        expect(REAL_WORLD_RE.test(l), `${k}: ${l}`).toBe(false);
      }
    }
  });

  it("the line is the same on every client for the same moment, and the lines get used", () => {
    expect(barkLine("triumph", 1234)).toEqual(barkLine("triumph", 1234));
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) seen.add(barkLine("triumph", s).text);
    expect(seen.size).toBe(BARK_LINES.triumph.lines.length);
    expect(isBarkKind("headshot")).toBe(true);
    expect(isBarkKind("toString")).toBe(false);
    expect(isBarkKind(3)).toBe(false);
  });

  it("a parley line's punctuation shapes the babble: a question rises, an exclamation is short and high", () => {
    expect(babbleKeyFor("Who sent you?")).toBe("question");
    expect(babbleKeyFor("Pay up!")).toBe("exclaim");
    expect(babbleKeyFor("Hmph.")).toBe("harrumph");
    expect(babbleKeyFor("The toll is forty pounds, and it is not negotiable, whatever the Society thinks.")).toBe("boast");
  });
});
