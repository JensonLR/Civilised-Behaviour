import { describe, expect, it } from "vitest";
import { GAIT, MOUNT_KIND, MOUNT_PHASE, hqPlan, newCampaign, serializeCampaign } from "@cb/shared";
import type { PlayOpts } from "../audio/engine.ts";
import { GAIT_KEYS, HoofCadence } from "../audio/hooves.ts";
import { SOUNDS } from "../audio/sounds.ts";
import { ContentAudio, gullGap, type CannonRowView, type ContentView, type MountRowView, type Sfx } from "./ContentAudio.ts";

interface Played { name: string; x?: number; y?: number; z?: number; volume?: number; key?: string; seed?: number }
const recorder = (): { sfx: Sfx; plays: Played[]; stops: string[] } => {
  const plays: Played[] = [];
  const stops: string[] = [];
  return { plays, stops, sfx: { play: (name, o?: PlayOpts) => plays.push({ name, x: o?.x, y: o?.y, z: o?.z, volume: o?.volume, key: o?.key, seed: o?.seed }), stop: (n) => stops.push(n) } };
};

const horse = (over: Partial<MountRowView> = {}): MountRowView => ({ kind: MOUNT_KIND.horse, x: 10, y: 1, z: -5, speed: 0, rider: "", hitch: "", phase: MOUNT_PHASE.loose, ...over });
const gun = (phase = 0): CannonRowView => ({ x: 20, y: 0.5, z: 30, phase });
// a Map stands in for the schema's MapSchema (same `forEach(value, key)`); its iteration allocates nothing, so what a test measures is ContentAudio's own
const map = <T>(o: Record<string, T>): Map<string, T> => new Map(Object.entries(o));
const campaignJson = (day: number): string => serializeCampaign({ ...newCampaign(5), day });

interface World { mounts: Record<string, MountRowView>; cannons: Record<string, CannonRowView>; region: string; travelPhase: number; day: number; rev: number; seed: number; sRev?: number }
const world = (o: Partial<World> = {}): World => ({ mounts: {}, cannons: {}, region: "hollowmere", travelPhase: 0, day: 1, rev: 0, seed: 7, ...o });
const view = (w: World): ContentView => ({ mounts: map(w.mounts), cannons: map(w.cannons), region: w.region, travelPhase: w.travelPhase, campaign: campaignJson(w.day), campaignRev: w.rev, seed: w.seed, settlementsRev: w.sRev });
const frames = (c: ContentAudio, w: World, n: number, dt = 1 / 60): void => {
  for (let i = 0; i < n; i++) c.update(dt, view(w));
};
const named = (p: Played[], n: string): Played[] => p.filter((x) => x.name === n);

describe("ContentAudio: hooves and tack from the mount rows", () => {
  it("a trotting horse beats out the trot's cadence at its own position with the trot's key; a standing one is silent; a wagon makes no hoofbeat", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ mounts: { h1: horse({ speed: 6.4, rider: "p1" }), h2: horse({ x: 50, speed: 0 }), w1: { ...horse({ x: 0 }), kind: MOUNT_KIND.wagon, speed: 6.4 } } });
    c.update(1 / 60, view(w)); // the first frame only learns what is there
    expect(r.plays).toEqual([]);
    const seconds = 10;
    frames(c, w, seconds * 60);
    const hooves = named(r.plays, "hoof");
    // the same cadence the pure module gives for 10 s at the same speed (the first frame primed the track, so one frame's worth fewer or more)
    const ref = new HoofCadence();
    let expected = 0;
    for (let i = 0; i < 601; i++) expected += ref.step(1 / 60, 6.4, true);
    expect(Math.abs(hooves.length - expected)).toBeLessThanOrEqual(2);
    for (const h of hooves) {
      expect(h).toMatchObject({ x: 10, y: 1, z: -5, key: GAIT_KEYS[GAIT.trot] });
      expect(h.volume!).toBeGreaterThan(0.5);
      expect(h.volume!).toBeLessThanOrEqual(1);
    }
    expect(r.plays.filter((p) => p.x === 50)).toEqual([]); // the standing horse
    expect(named(r.plays, "hoof").filter((p) => p.x === 0)).toEqual([]); // the wagon: its wheels rattle (below), but it has no hooves
  });

  it("a rolling wagon rattles about once a metre at its bed, keyed `rattle`, and creaks every few metres; standing or wrecked it is silent; the first sight is silent", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const wagon = (over: Partial<MountRowView>): MountRowView => ({ ...horse({ x: 0, y: 2 }), kind: MOUNT_KIND.wagon, ...over });
    const w = world({ mounts: { w1: wagon({ speed: 4 }), w2: wagon({ x: 40, speed: 0 }), w3: wagon({ x: 80, speed: 4, phase: MOUNT_PHASE.wrecked }) } });
    c.update(1 / 60, view(w));
    expect(r.plays).toEqual([]);
    frames(c, w, 600); // 10 s at 4 m/s: 40 m
    const rolls = named(r.plays, "wagon_roll");
    const rattles = rolls.filter((p) => p.key === "rattle");
    const creaks = rolls.filter((p) => p.key === "creak");
    expect(rattles.length).toBeGreaterThan(36);
    expect(rattles.length).toBeLessThan(48);
    expect(creaks.length).toBeGreaterThanOrEqual(5);
    expect(creaks.length).toBeLessThanOrEqual(12);
    for (const p of rolls) {
      expect(p.x).toBe(0);
      expect(p.y!).toBeGreaterThan(2);
      expect(p.volume!).toBeGreaterThan(0.3);
      expect(p.volume!).toBeLessThanOrEqual(1);
    }
    expect(r.plays.filter((p) => p.x === 40 || p.x === 80)).toEqual([]);
    expect(SOUNDS.wagon_roll!.keys).toEqual(["rattle", "creak"]);
  });

  it("D-058: every hoofbeat lays a hoof print along the horse's heading, the sides alternating; a standing horse and a wagon lay none", () => {
    const r = recorder();
    const prints: { x: number; dx: number; dz: number; side: number }[] = [];
    const c = new ContentAudio({ sfx: r.sfx, onHoof: (x, _z, dx, dz, side) => prints.push({ x, dx, dz, side }) });
    const w = world({ mounts: { h1: horse({ speed: 6.4, rider: "p1", facing: Math.PI / 2 }), h2: horse({ x: 50, speed: 0 }), w1: { ...horse({ x: 0 }), kind: MOUNT_KIND.wagon, speed: 6.4 } } });
    frames(c, w, 300);
    const beats = named(r.plays, "hoof").length;
    expect(beats).toBeGreaterThan(4);
    expect(prints.length).toBe(beats);
    expect(prints.every((p) => p.x === 10)).toBe(true);
    for (const p of prints) expect(p.dx).toBeCloseTo(-1, 5); // facing PI/2 heads -x
    for (let i = 1; i < prints.length; i++) expect(prints[i]!.side).toBe(-prints[i - 1]!.side);
  });

  it("the gait names the key: a horse that speeds up goes walk -> trot -> canter -> gallop, one tack jingle per step up from the trot", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ mounts: { h1: horse({ speed: 2.5 }) } });
    c.update(1 / 60, view(w));
    for (const speed of [2.5, 6.4, 8.9, 10.5]) {
      w.mounts.h1!.speed = speed;
      frames(c, w, 120);
    }
    const keys = named(r.plays, "hoof").map((p) => p.key);
    const order = keys.filter((k, i) => k !== keys[i - 1]);
    expect(order).toEqual(["walk", "trot", "canter", "gallop"]);
    expect(named(r.plays, "tack_jingle")).toHaveLength(3); // trot, canter, gallop (the walk is no occasion)
    // slowing again does not jingle
    w.mounts.h1!.speed = 2.5;
    frames(c, w, 60);
    expect(named(r.plays, "tack_jingle")).toHaveLength(3);
    for (const k of new Set(keys)) expect(SOUNDS.hoof!.keys).toContain(k);
  });

  it("a rider mounting, dismounting, a wagon hitched and unhitched: the tack jingles (louder for the mount); the first sight of a horse already ridden is silent", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ mounts: { h1: horse({ rider: "old" }) } });
    c.update(1 / 60, view(w));
    expect(r.plays).toEqual([]);
    w.mounts.h1!.rider = "";
    frames(c, w, 3);
    w.mounts.h1!.rider = "me";
    frames(c, w, 3);
    w.mounts.h1!.hitch = "w1";
    frames(c, w, 3);
    const j = named(r.plays, "tack_jingle");
    expect(j).toHaveLength(3);
    expect(j[1]!.volume!).toBeGreaterThan(j[0]!.volume!); // mounting is louder than dismounting
    expect(j.every((p) => p.x === 10 && p.z === -5)).toBe(true);
    // a horse that appears mid-game (a late joiner's world) starts silent too
    w.mounts.h3 = horse({ x: 70, rider: "x" });
    frames(c, w, 3);
    expect(named(r.plays, "tack_jingle")).toHaveLength(3);
  });

  it("a wrecked or removed horse is dropped: its track goes, and a new horse under the same id starts silent", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ mounts: { h1: horse({ speed: 6.4 }) } });
    frames(c, w, 30);
    const n = r.plays.length;
    expect(n).toBeGreaterThan(0);
    w.mounts.h1!.phase = MOUNT_PHASE.wrecked;
    frames(c, w, 60);
    expect(r.plays.length).toBe(n);
    delete w.mounts.h1;
    frames(c, w, 5);
    w.mounts.h1 = horse({ speed: 0, rider: "new" });
    frames(c, w, 5);
    expect(r.plays.length).toBe(n);
  });
});

describe("ContentAudio: the sailing, the paper, the bells, the gun crew", () => {
  it("sailing: the creak every frame of phase 2 (never outside it), stopped when it ends, and gulls on a fixed schedule from the seed", () => {
    const run = (seed: number): { gulls: number[]; creaks: number; stops: string[]; plays: Played[] } => {
      const r = recorder();
      const c = new ContentAudio({ sfx: r.sfx });
      const w = world({ seed });
      c.update(1 / 60, view(w));
      w.travelPhase = 1;
      frames(c, w, 30);
      expect(named(r.plays, "sail_creak")).toHaveLength(0); // the vote is not the voyage
      w.travelPhase = 2;
      const times: number[] = [];
      for (let i = 0; i < 60 * 20; i++) {
        const before = r.plays.length;
        c.update(1 / 60, view(w));
        if (r.plays.slice(before).some((p) => p.name === "gull")) times.push(i / 60);
      }
      const creaks = named(r.plays, "sail_creak").length;
      w.travelPhase = 3;
      frames(c, w, 60 * 4);
      w.travelPhase = 0;
      frames(c, w, 60 * 10);
      return { gulls: times, creaks, stops: r.stops, plays: r.plays };
    };
    const a = run(7);
    expect(a.creaks).toBe(60 * 20);
    expect(a.stops).toEqual(["sail_creak"]);
    expect(a.gulls.length).toBeGreaterThanOrEqual(2);
    expect(a.gulls.length).toBeLessThanOrEqual(8);
    expect(run(7).gulls).toEqual(a.gulls); // deterministic
    expect(run(8).gulls).not.toEqual(a.gulls);
    // no gulls once ashore: nothing is played after the last frame of landfall but the stop
    const lastGull = a.plays.map((p) => p.name).lastIndexOf("gull");
    const lastCreak = a.plays.map((p) => p.name).lastIndexOf("sail_creak");
    expect(lastGull).toBeGreaterThan(-1);
    expect(a.plays.length - 1).toBeLessThanOrEqual(Math.max(lastGull, lastCreak) + 0); // the log ends with the last gull or creak: the 10 s on land added none
    for (let n = 0; n < 50; n++) {
      expect(gullGap(7, n)).toBeGreaterThanOrEqual(2.5);
      expect(gullGap(7, n)).toBeLessThanOrEqual(7.5);
    }
    // the gull's variant is chosen by number
    expect(named(a.plays, "gull").map((p) => p.seed)).toEqual(named(a.plays, "gull").map((_, i) => i));
  });

  it("the campaign: a new revision puts the paper up at the notice board; a new DAY rings the HQ bell once, when the party is at HQ and not at sea", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ region: "kessar", day: 1, rev: 0 });
    c.update(1 / 60, view(w));
    w.rev = 1; // an outcome in Kessar: the day advances while they are away
    w.day = 2;
    frames(c, w, 3);
    expect(named(r.plays, "paper_rustle")).toHaveLength(1);
    expect(named(r.plays, "paper_rustle")[0]!.x).toBeUndefined(); // away from the board: heard in the centre, low
    expect(named(r.plays, "bell")).toHaveLength(0); // not at HQ
    w.travelPhase = 2;
    frames(c, w, 3);
    w.region = "hollowmere";
    frames(c, w, 3);
    expect(named(r.plays, "bell")).toHaveLength(0); // still at sea
    w.travelPhase = 0;
    frames(c, w, 3);
    const bells = named(r.plays, "bell");
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({ key: "hq", x: hqPlan().marquee.x, z: hqPlan().marquee.z });
    frames(c, w, 120);
    expect(named(r.plays, "bell")).toHaveLength(1); // once
    // a revision with the same day: paper, no bell; at HQ the paper is positional
    w.rev = 2;
    frames(c, w, 3);
    expect(named(r.plays, "bell")).toHaveLength(1);
    const p = named(r.plays, "paper_rustle");
    expect(p).toHaveLength(2);
    expect(p[1]).toMatchObject({ x: hqPlan().notice.x, z: hqPlan().notice.z });
  });

  it("a settlement's revision rings the outpost bell where the integrator says the outpost is; nowhere known: silent; the first sight is silent", () => {
    const r = recorder();
    let site: { x: number; z: number } | undefined = { x: 30, z: 72 };
    const c = new ContentAudio({ sfx: r.sfx, outpostSite: () => site });
    const w = world({ region: "kessar", sRev: 4 });
    frames(c, w, 3);
    expect(named(r.plays, "bell")).toHaveLength(0);
    w.sRev = 5;
    frames(c, w, 3);
    expect(named(r.plays, "bell")).toEqual([expect.objectContaining({ key: "outpost", x: 30, z: 72 })]);
    site = undefined;
    w.sRev = 6;
    frames(c, w, 3);
    expect(named(r.plays, "bell")).toHaveLength(1);
  });

  it("the gun crew calls its work as the gun's phase moves: Loading!, Stand clear!, Fire! at the gun, once each, and never for a gun first seen mid-load", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ cannons: { "cannon:0": gun(1) } });
    frames(c, w, 3);
    expect(named(r.plays, "crew_shout")).toHaveLength(0);
    for (const ph of [2, 3, 0, 1, 2, 3, 0]) {
      w.cannons["cannon:0"]!.phase = ph;
      frames(c, w, 4);
    }
    const shouts = named(r.plays, "crew_shout");
    expect(shouts.map((s) => s.key)).toEqual(["stand_clear", "fire", "loading", "stand_clear", "fire"]);
    for (const s of shouts) expect(s).toMatchObject({ x: 20, z: 30 });
    for (const s of shouts) expect(SOUNDS.crew_shout!.keys).toContain(s.key);
  });
});

describe("ContentAudio: robust and allocation-free", () => {
  it("hostile frames and rows never throw", () => {
    const r = recorder();
    const c = new ContentAudio({ sfx: r.sfx });
    const w = world({ mounts: { h1: horse({ speed: NaN }), h2: horse({ speed: Infinity, x: NaN }), h3: horse({ speed: -5 }) }, cannons: { c1: gun(250) } });
    for (const dt of [NaN, -1, Infinity, 0, 0.5, 1e9, 1 / 60]) expect(() => c.update(dt, view(w))).not.toThrow();
    w.rev = NaN as unknown as number;
    expect(() => frames(c, w, 3)).not.toThrow();
    const bad = { ...view(w), campaign: "{not json" };
    expect(() => c.update(1 / 60, bad)).not.toThrow();
    c.dispose();
    expect(() => c.update(1 / 60, view(w))).not.toThrow();
  });

});
