import { describe, expect, it } from "vitest";
import { PEOPLE_IDS, resolvePeople } from "@cb/shared";
import { applyPeople } from "../peoples.ts";
import { generateCharacter, societyDress } from "../spec.ts";
import { BEARINGS, bearingOf } from "./bearing.ts";

describe("bearing (D-066): how a body stands about, read from its dress", () => {
  it("every native carries its own people's bearing; an explorer always the Society's", () => {
    for (const p of PEOPLE_IDS) {
      for (let s = 1; s <= 80; s++) {
        const native = applyPeople(generateCharacter(s * 131), p, s);
        const want = resolvePeople(p, s);
        const got = bearingOf(native);
        // (a grand Court Cloak under a crown shared by two peoples may read as the other: never as the Society)
        expect(got, `${p} seed ${s}`).not.toBe("society");
        if (native.jacket !== 16) expect(got, `${p} seed ${s}`).toBe(want);
        expect(bearingOf(societyDress(native)), `${p} seed ${s} as a player`).toBe("society");
      }
    }
    for (let s = 1; s <= 300; s++) expect(bearingOf(generateCharacter(s))).toBe("society");
  });

  it("the Society's habits (the pocket watch, the hat brim) are its own; each people stands its own way", () => {
    for (const [id, b] of Object.entries(BEARINGS)) {
      if (id === "society") continue;
      expect(b.acts, id).not.toContain("watch");
      expect(b.acts, id).not.toContain("hat");
      expect(b.stance, id).not.toBe("hang");
    }
    expect(BEARINGS.society.stance).toBe("hang");
  });
});
