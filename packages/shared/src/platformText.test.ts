import { describe, expect, it } from "vitest";
import { DEMO } from "./demo.ts";
import { ACHIEVEMENTS, DESKTOP_CHANNELS, connectString, parseConnect, createNoopPlatform, isAchievementId } from "./platform.ts";
import { ACHIEVEMENT_TEXT, DEMO_OVER_TEXT, DEMO_REFUSED_TEXT, demoWarnText, parseDemoWarn, presenceText } from "./platformText.ts";
import { REGION_IDS } from "./campaignTypes.ts";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "./protocol.ts";
import type { PresenceState } from "./platform.ts";

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);

describe("presenceText", () => {
  const states: PresenceState[] = [];
  for (const where of ["menu", "hq", "sailing", "region"] as const) for (const region of [undefined, ...REGION_IDS]) for (let party = 1; party <= 4; party++) for (const day of [0, 1, 7, 99]) states.push({ where, region, party, day });

  it("is deterministic, short, plain text and never carries the join code", () => {
    for (const st of states) {
      const t = presenceText({ ...st, joinCode: CODE });
      expect(t).toBe(presenceText({ ...st, joinCode: CODE }));
      expect(t).toBe(presenceText(st));
      expect(t.length).toBeGreaterThan(8);
      expect(t.length).toBeLessThanOrEqual(120);
      expect(t).not.toContain(CODE);
      expect(t).not.toMatch(/[<>{}]/);
    }
  });
  it("changes with where, region and party (the storefront shows something different)", () => {
    const set = new Set(states.map((s) => presenceText(s)));
    expect(set.size).toBeGreaterThan(40);
    expect(presenceText({ where: "region", region: "highmark", party: 2, day: 3 })).toMatch(/Highmark/);
    expect(presenceText({ where: "region", region: "kessar", party: 2, day: 3 })).toMatch(/Kessar/);
  });
  it("survives garbage numbers", () => {
    for (const bad of [NaN, Infinity, -5, 99, 2.5]) expect(presenceText({ where: "hq", party: bad, day: bad }).length).toBeGreaterThan(0);
  });
});

describe("platform seam", () => {
  it("the no-op adapter does nothing, safely", async () => {
    const p = createNoopPlatform();
    expect(p.available).toBe(false);
    expect(await p.init()).toBe(false);
    p.unlock("first_crossing");
    p.setPresence({ where: "menu", party: 1, day: 0 });
    p.onInvite(() => { throw new Error("never"); })();
    p.shutdown();
  });
  it("achievement ids and text tables agree; unknown ids are not ids", () => {
    expect(Object.keys(ACHIEVEMENT_TEXT).sort()).toEqual([...ACHIEVEMENTS].sort());
    for (const bad of ["", "x", "__proto__", 3, null, undefined, {}, ["first_crossing"]]) expect(isAchievementId(bad)).toBe(false);
  });
  it("connect strings carry a join code and nothing else", () => {
    expect(connectString(CODE)).toBe(`+join ${CODE}`);
    expect(connectString("nope")).toBeUndefined();
    expect(parseConnect(`+join ${CODE}`)).toBe(CODE);
    expect(parseConnect(CODE)).toBe(CODE);
    expect(parseConnect(["game.exe", "--x", "+join", CODE])).toBe(CODE);
    for (const bad of ["", "+join", "+join nope", `+join ${CODE}x`, "../..", 5, null, undefined, {}, [1, 2], `${CODE}${CODE}`]) expect(parseConnect(bad), String(bad)).toBeUndefined();
  });
  it("the channel list is closed and unique", () => {
    expect(new Set(DESKTOP_CHANNELS).size).toBe(DESKTOP_CHANNELS.length);
  });
});

describe("demo notices", () => {
  it("the warning round-trips through its parser and nothing else parses", () => {
    for (const m of DEMO.warnAtMinutes) expect(parseDemoWarn(demoWarnText(m))).toBe(m);
    expect(parseDemoWarn(demoWarnText(1))).toBe(1);
    for (const bad of [DEMO_OVER_TEXT, DEMO_REFUSED_TEXT, "", "The Society's demonstration licence expires in x minutes", 5, null, "x".repeat(500)]) expect(parseDemoWarn(bad)).toBeUndefined();
  });
});
