import { FLAG } from "@cb/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

/** GameAudio's new surface: the adaptive score's per-frame update (and Adaptive music off), the impact map, the wet sever, the fall that follows a downing. The audio module is replaced by a recorder. */

const calls: { fn: string; args: unknown[] }[] = [];
vi.mock("../audio/index.ts", () => {
  const rec = (fn: string) => (...args: unknown[]): void => {
    calls.push({ fn, args });
  };
  return { footstep: rec("footstep"), playBlast: rec("playBlast"), playSfx: rec("playSfx"), setAmbienceMood: rec("setAmbienceMood"), setAudioRegion: rec("setAudioRegion"), setMusicMix: rec("setMusicMix"), stopSfx: rec("stopSfx") };
});
let adaptive = true;
vi.mock("../settings.ts", () => ({ getAdaptiveMusic: () => adaptive }));

const { GameAudio } = await import("./GameAudio.ts");
const { newSignals } = await import("../audio/musicLayers.ts");

const g = (): InstanceType<typeof GameAudio> => new GameAudio(() => 0);
const sfx = (): string[] => calls.filter((c) => c.fn === "playSfx").map((c) => c.args[0] as string);
afterEach(() => {
  calls.length = 0;
  adaptive = true;
  vi.useRealTimers();
});

describe("the adaptive score", () => {
  it("each frame sets the region, steps the driver and pushes the stem mix and the ambience mood", () => {
    const a = g();
    a.update(1 / 30, { ...newSignals("vesper"), shotsHeard: 2 });
    expect(a.musicMood).toBe("combat");
    expect(calls.find((c) => c.fn === "setAudioRegion")!.args[0]).toBe("vesper");
    const mix = calls.find((c) => c.fn === "setMusicMix")!.args as [Record<string, number>, number];
    expect(Object.keys(mix[0]).sort()).toEqual(["bed", "colour", "dirge", "dread", "drive", "pulse", "stabs"]);
    expect(calls.some((c) => c.fn === "setAmbienceMood")).toBe(true);
    for (let i = 0; i < 90; i++) a.update(1 / 30, { ...newSignals(), shotsHeard: 2 });
    const last = calls.filter((c) => c.fn === "setAmbienceMood").at(-1)!.args[0] as number;
    expect(last).toBeLessThan(0.55); // -6 dB once the drums are fully in
  });

  it("with Adaptive music off only the plain bed plays and the ambience is left alone, however loud the fight (a parley still halves it)", () => {
    adaptive = false;
    const a = g();
    for (let i = 0; i < 60; i++) a.update(1 / 30, { ...newSignals(), shotsHeard: 3, hostilesNear: 3 });
    expect(a.musicMood).toBe("calm");
    const mix = calls.filter((c) => c.fn === "setMusicMix").at(-1)!.args as [Record<string, number>, number];
    expect(mix[0].bed).toBe(1);
    expect(Object.entries(mix[0]).filter(([k]) => k !== "bed").every(([, v]) => v === 0)).toBe(true);
    expect(calls.filter((c) => c.fn === "setAmbienceMood").at(-1)!.args[0]).toBe(1);
    a.update(1 / 30, { ...newSignals(), parley: true });
    expect(calls.filter((c) => c.fn === "setAmbienceMood").at(-1)!.args[0]).toBe(0.5);
  });
});

describe("events", () => {
  it("impacts pick the sound for what was hit: splinters, chips, rings, splashes, earth; flesh is the heavy or the light blow", () => {
    const a = g();
    for (const m of ["wood", "stone", "metal", "water", "earth"] as const) a.impact(m, 1, 1, 1, 0.5);
    a.impact("flesh", 1, 1, 1, 0.9);
    a.impact("flesh", 1, 1, 1, 0.2);
    expect(sfx()).toEqual(["impact_splinter", "impact_chip", "impact_ring", "impact_splash", "impact_earth", "gore_flesh_heavy", "gore_flesh_light"]);
  });

  it("a sever adds the wet sound to the long-standing one; blood, foley and blasts go to their names", () => {
    const a = g();
    a.sever(1, 2, 3);
    a.bloodOnGround(1, 0, 1);
    a.foley("ramrod", 0, 1, 0);
    a.foley("cock", 0, 1, 0);
    a.blast("cannon", 5, 1, 5);
    expect(sfx()).toEqual(["limb_sever", "gore_sever_wet", "gore_blood_ground", "foley_ramrod", "foley_cock"]);
    expect(calls.find((c) => c.fn === "playBlast")!.args.slice(0, 2)).toEqual(["cannon", 5]);
  });

  it("a body going down falls, and a bad breath follows a moment later", () => {
    vi.useFakeTimers();
    const a = g();
    a.actor("p", false, 1 / 60, 0, 0, 0, 0, 0, 0, FLAG.GROUNDED);
    a.actor("p", false, 1 / 60, 0, 0, 0, 0, 0, 0, FLAG.GROUNDED | FLAG.DOWNED);
    expect(sfx()).toEqual(expect.arrayContaining(["down", "gore_body_fall"]));
    expect(sfx()).not.toContain("gore_bad_breath");
    vi.advanceTimersByTime(800);
    expect(sfx()).toContain("gore_bad_breath");
  });
});

describe("footfalls feed the boot prints (D-058)", () => {
  it("each footstep sound is one step on the hook, the feet alternate, the surface is the one the sound used; a downed body leaves none", () => {
    const steps: { foot: number; surface: string }[] = [];
    const a = new GameAudio(() => 0, (_x, _z, _vx, _vz, foot, surface) => steps.push({ foot, surface }));
    for (let i = 0; i < 90; i++) a.actor("p", true, 1 / 30, i * 0.1, 0, 0, 3, 0, 0, FLAG.GROUNDED);
    const sounds = calls.filter((c) => c.fn === "footstep").length;
    expect(sounds).toBeGreaterThan(2);
    expect(steps.length).toBe(sounds);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.foot).toBe(-steps[i - 1]!.foot);
    const heard = calls.filter((c) => c.fn === "footstep").map((c) => c.args[0]);
    expect(steps.map((s) => s.surface)).toEqual(heard);
    const before = steps.length;
    for (let i = 0; i < 60; i++) a.actor("p", true, 1 / 30, 9, 0, 0, 3, 0, 0, FLAG.GROUNDED | FLAG.DOWNED);
    expect(steps.length).toBe(before);
  });
});

describe("D-131: the folk's voices", () => {
  const person = (over: Partial<import("@cb/shared").Villager>): import("@cb/shared").Villager =>
    ({ id: 1, name: "Talveth of the Third Lamp", title: "Water-Carrier", occupation: "laundress", age: "adult", home: "w3", lookSeed: 12345, archetype: 2, scale: 1, walk: 1, lane: 0.5, lines: "kWater", stints: [], people: "kessarine", ...over }) as import("@cb/shared").Villager;
  it("a townsperson speaks in their people's voice (a child in the child's), positional; the Society's own staff in the Society's bluster", async () => {
    const { folkVariant } = await import("../audio/babble.ts");
    const a = g();
    a.folk(person({}), "mutter", 1, 2, 3, false);
    const say = calls.find((c) => c.fn === "playSfx")!.args as [string, { x: number; key: string; seed: number; volume: number }];
    expect(say[0]).toBe("folk_voice");
    expect(say[1].x).toBe(1);
    expect(say[1].key).toBe("mutter");
    expect([folkVariant("kessarine", 0), folkVariant("kessarine", 1)]).toContain(say[1].seed);
    calls.length = 0;
    a.folk(person({ age: "child", scale: 0.7 }), "exclaim", 0, 0, 0, true);
    const cry = calls[0]!.args as [string, { seed: number; volume: number }];
    expect(cry[1].seed).toBe(folkVariant("kessarine", 2));
    expect(cry[1].volume).toBeGreaterThan(say[1].volume);
    calls.length = 0;
    // (a Hollowmere villager has no people of their own: by trade; the Registrar is the Society's)
    a.folk(person({ people: undefined, title: "Registrar of Non-Events" }), "boast", 0, 0, 0, false);
    expect(sfx()).toEqual(["babble"]);
  });
});
