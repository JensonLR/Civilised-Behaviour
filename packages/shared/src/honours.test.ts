import { describe, expect, it } from "vitest";
import { HONOURS_KEPT, HONOUR_IDS, HONOUR_TITLE, awardHonour, decorate, newDeeds, newHonours, parseHonours, serializeHonours, titleOf, type Deeds } from "./honours.ts";

const D = (o: Partial<Deeds>): Deeds => ({ ...newDeeds(), ...o });
const KEY = "abcdefghijklmnopqrstuvwxyzABCDEF_-0123456789a"; // (an HMAC key's shape: base64url)

describe("honours (D-055)", () => {
  it("a member earns the highest honour their own deeds reach, and nothing when nothing happened", () => {
    const fight = { resolution: "forced" as const };
    expect(awardHonour(D({ foesDowned: 7, helped: 5 }), fight)).toBe("terror");
    expect(awardHonour(D({ foesDowned: 3 }), fight)).toBe("crack_shot");
    expect(awardHonour(D({ foesDowned: 2, helped: 2 }), fight)).toBe("bandager");
    expect(awardHonour(D({ kindness: 1, kegs: 2 }), fight)).toBe("friend_of_the_road");
    expect(awardHonour(D({ kegs: 1 }), fight)).toBe("powder_monkey");
    expect(awardHonour(D({}), { resolution: "paid" })).toBe("peacemaker");
    expect(awardHonour(D({ foesDowned: 1 }), { resolution: "paid" }), "a deal with a man down is not peace").toBeUndefined();
    expect(awardHonour(D({ downed: 2 }), fight)).toBe("twice_mended");
    expect(awardHonour(D({ downed: 1 }), fight)).toBe("sturdy");
    expect(awardHonour(D({}), fight)).toBeUndefined();
  });

  it("the latest honour is worn, the last three are kept, and a bad key decorates nobody", () => {
    let h = newHonours();
    for (const id of ["sturdy", "bandager", "terror", "peacemaker"] as const) h = decorate(h, KEY, id);
    expect(h.by[KEY]).toEqual(["peacemaker", "terror", "bandager"]);
    expect(h.by[KEY]!.length).toBe(HONOURS_KEPT);
    expect(titleOf(h, KEY)).toBe(HONOUR_TITLE.peacemaker);
    expect(titleOf(h, "nobody-at-all-here-0000")).toBe("");
    expect(titleOf(h, undefined)).toBe("");
    expect(decorate(h, "a b c", "terror")).toBe(h);
  });

  it("the saved section reads back as written and survives hostile input", () => {
    const h = decorate(decorate(newHonours(), KEY, "bandager"), `${KEY}x`, "terror");
    expect(parseHonours(serializeHonours(h))).toEqual(h);
    expect(serializeHonours(parseHonours(serializeHonours(h))!)).toBe(serializeHonours(h));
    expect(parseHonours("not json")).toBeUndefined();
    expect(parseHonours(JSON.stringify({ v: 2, by: {} }))).toBeUndefined();
    const hostile = parseHonours(JSON.stringify({ v: 1, by: { [KEY]: ["terror", "knighthood", 7, "sturdy", "bandager", "twice_mended"], "<script>": ["terror"], short: ["terror"] } }))!;
    expect(hostile.by).toEqual({ [KEY]: ["terror", "sturdy", "bandager"] });
    expect(parseHonours("x".repeat(5000))).toBeUndefined();
  });

  it("every honour has a title, and the titles name nobody real and no faith", () => {
    const BANNED = /(?<![a-z])(england|english|britain|british|london|france|french|germany|german|china|india|america|africa|christian|muslim|jewish|church|bible|pope|saint|samaritan|crusader)(?![a-z])/i;
    for (const id of HONOUR_IDS) {
      expect(HONOUR_TITLE[id].length).toBeGreaterThan(3);
      expect(BANNED.test(HONOUR_TITLE[id]), HONOUR_TITLE[id]).toBe(false);
    }
  });
});
