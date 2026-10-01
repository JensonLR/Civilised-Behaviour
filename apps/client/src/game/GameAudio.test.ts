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
