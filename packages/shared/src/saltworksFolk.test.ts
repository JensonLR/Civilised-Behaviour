import { describe, expect, it } from "vitest";
import { insideObstacle } from "./camp.ts";
import { REAL_WORLD_RE } from "./realWorld.ts";
import { createSaltmarketWorld, type SaltmarketTerrain } from "./saltmarket.ts";
import { saltworksPlan } from "./saltworks.ts";
import { buildSaltworksFolk, saltworksNav } from "./saltworksFolk.ts";
import { buildLampsideFolk } from "./lampsideFolk.ts";
import { createKessarWorld } from "./kessar.ts";
import { createFolkClock, createVillagerPose, setFolkClock, villagerAt, villagerFright, villagerGreeting, type Folk, type FolkClock, type VillagerPose } from "./villagers.ts";
import { allLines, pickLine } from "./villagerLines.ts";

/** D-123: the Brinefolk at the Brine Houses' salt pans, on the same schedule as Hollowmere's folk and Lampside's, on the works' own network. */
const SEEDS = [1, 7, 42, 1337, 90210];
const clockAt = (seed: number, hours: number, ms = 0, rain?: number): FolkClock => setFolkClock(createFolkClock(), seed, ms, hours, 30, rain);

/** A person stands somewhere legal: nothing solid within a hand of them (a bund is a floor they walk along), out of the delta's water, on the ground or a bund. */
function whyIllegal(folk: Folk, p: VillagerPose): string {
  const w = folk.nav.world;
  let why = "";
  w.forEachNear(p.x, p.z, (o) => {
    if (why || o.tag === "bund") return;
    if (insideObstacle(o, p.x, p.z, 0.2)) why = `inside a ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`;
  });
  if (why) return why;
  if ((w.terrain as SaltmarketTerrain).waterDepth(p.x, p.z) > 0.02) return "in the water";
  if (Math.abs(w.groundHeight(p.x, p.z, p.y) - p.y) > 0.5) return `floating or sunk: y ${p.y.toFixed(2)} vs ground ${w.groundHeight(p.x, p.z, p.y).toFixed(2)}`;
  return "";
}

describe("D-123: the Brinefolk at the pans", () => {
  const w = createSaltmarketWorld(7);
  const folk = buildSaltworksFolk(w, 7);

  it("are eight Brinefolk, each named for the lot they were born on, with a trade, a hut in the rakers' row and a day's work", () => {
    expect(folk.roster).toHaveLength(8);
    for (const v of folk.roster) {
      expect(v.people).toBe("brinefolk");
      expect(v.name).toMatch(/ of Lot [A-Z][a-z]+$/);
      expect(v.home).toMatch(/^hut[0-3]$/);
      expect(v.stints.some((s) => folk.nav.stations[s.st]!.key === `in:${v.home}` && s.act === "sleep"), `${v.name} has a bed`).toBe(true);
      expect(v.stints.some((s) => !folk.nav.stations[s.st]!.hidden && s.act !== "idle"), `${v.name} has work`).toBe(true);
    }
    expect(new Set(folk.roster.map((v) => v.name)).size).toBe(8);
    for (const t of ["Raker", "Pump-Keeper", "Barrow-Man", "Tally-Keeper", "Crust-Skimmer"]) expect(folk.roster.some((v) => v.title === t), t).toBe(true);
    // deterministic in (world, seed), cached, and their own (never Lampside's or Hollowmere's in a Saltmarket world)
    expect(buildSaltworksFolk(createSaltmarketWorld(7), 7).roster.map((v) => v.name)).toEqual(folk.roster.map((v) => v.name));
    expect(buildSaltworksFolk(w, 7)).toBe(folk);
    expect(buildSaltworksFolk(w, 8).roster.map((v) => v.lookSeed)).not.toEqual(folk.roster.map((v) => v.lookSeed));
  });

  it("can reach every station of the works on every seed: the huts' back doors, the pump, the sluices on the bunds, between the windrows, the lifted pan, the crust, the heaps, the tally", () => {
    for (const seed of SEEDS) {
      const why = new Map<string, string>();
      const nav = saltworksNav(createSaltmarketWorld(seed), why);
      expect(nav.stations.filter((s) => !s.ok).map((s) => `${s.key}: ${why.get(s.key)}`), `seed ${seed}`).toEqual([]);
      for (const k of ["pump", "sluice:0", "sluice:4", "rake:w:a", "rake:w:b", "rake:e:a", "rake:e:b", "lift", "skim:a", "skim:c", "heap:0", "heap:3", "tally", "play:bund", "step:hut3", "in:hut2"]) {
        expect(nav.distance(nav.index.get("step:hut0")!, nav.index.get(k)!), `seed ${seed} ${k}`).toBeLessThan(Infinity);
      }
      // the sluice-tender and the child stand ON the bunds
      for (const k of ["sluice:0", "play:bund"]) expect(nav.stations[nav.index.get(k)!]!.y, k).toBeGreaterThan(0.6);
    }
  }, 60_000);

  it("nobody is ever inside a hut, a heap, the raked salt, the pump or the water, at any hour, dry or in a downpour, on any seed", () => {
    const pose = createVillagerPose();
    for (const seed of SEEDS) {
      const f = buildSaltworksFolk(createSaltmarketWorld(seed), seed);
      for (const rain of [0, 1]) {
        for (let i = 0; i < f.roster.length; i++) {
          for (let h = 0; h < 24; h += 0.03) {
            villagerAt(f, i, clockAt(seed, h, 0, rain), pose);
            if (!pose.visible) continue;
            const why = whyIllegal(f, pose);
            expect(why, `seed ${seed} rain ${rain}: ${f.roster[i]!.name} at ${h.toFixed(2)} h (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}) ${pose.act}`).toBe("");
          }
        }
      }
    }
  }, 240_000);

  it("they move like people: never a jump, never faster than a brisk walk (the child a trot), and they stand still to work", () => {
    const a = createVillagerPose();
    const b = createVillagerPose();
    for (const seed of [7, 42]) {
      const f = buildSaltworksFolk(createSaltmarketWorld(seed), seed);
      for (const rain of [0, 1]) {
        for (let i = 0; i < f.roster.length; i++) {
          const v = f.roster[i]!;
          let walked = 0;
          let stood = 0;
          const dh = 0.004;
          for (let h = 0; h < 24; h += dh) {
            villagerAt(f, i, clockAt(seed, h, 0, rain), a);
            villagerAt(f, i, clockAt(seed, h + dh, 0, rain), b);
            if (!a.visible || !b.visible) continue;
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            const dt = dh * (h < 5.2 || h > 20.6 ? 32.9 : 98.5);
            expect(d / dt, `seed ${seed} rain ${rain}: ${v.name} jumps ${d.toFixed(2)} m at ${h.toFixed(3)} h (${a.act} -> ${b.act})`).toBeLessThan(3.4);
            expect(Math.abs(b.y - a.y)).toBeLessThan(0.5);
            if (a.act === "walk") walked++;
            else stood++;
            if (a.act !== "walk" && b.act !== "walk") expect(d).toBeLessThan(1e-6);
          }
          if (rain === 0) {
            expect(walked, `${v.name} never walks`).toBeGreaterThan(5);
            expect(stood, `${v.name} never stands`).toBeGreaterThan(100);
          }
        }
      }
    }
  }, 240_000);

  it("keep the pans' hours: nobody out in the small hours, the works busy by mid-morning; rain stops the work and sends them in", () => {
    const pose = createVillagerPose();
    const seen = (h: number, rain = 0): number => {
      let n = 0;
      for (let i = 0; i < folk.roster.length; i++) {
        villagerAt(folk, i, clockAt(7, h, 0, rain), pose);
        if (pose.visible && pose.act !== "walk") n++;
      }
      return n;
    };
    expect(seen(2.5)).toBe(0);
    expect(seen(23)).toBe(0);
    expect(seen(10)).toBeGreaterThanOrEqual(7);
    expect(seen(15)).toBeGreaterThanOrEqual(7);
    // in a downpour nobody stands about in the open: they are in, or on their way
    for (const h of [10, 11.5, 15, 16]) expect(seen(h, 1), `${h} h in the rain`).toBe(0);
  });

  it("work in their places: the rakers between the windrows (never on the raked salt), the skimmer in the crust, the Tally-Keeper with the book, the Pump-Keeper looking up at the wheel", () => {
    const pose = createVillagerPose();
    const plan = saltworksPlan();
    let raking = 0;
    for (let i = 0; i < folk.roster.length; i++) {
      const v = folk.roster[i]!;
      for (let h = 6.5; h < 18.5; h += 0.05) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (!pose.visible || pose.act === "walk") continue;
        if (v.title === "Raker" && pose.act === "sweep") {
          raking++;
          const pan = plan.pans.find((q) => pose.x > q.x0 && pose.x < q.x1 && pose.z > q.z0 && pose.z < q.z1);
          expect(pan?.state, `${v.name} rakes in a raked pan`).toBe("raked");
          for (const r of plan.rows) if (Math.abs(pose.x - r.x) < r.hx) expect(Math.abs(pose.z - r.z), `${v.name} clear of the windrow at z ${r.z}`).toBeGreaterThan(r.hz + 0.2);
        }
        if (v.title === "Crust-Skimmer" && pose.act === "tend") expect(plan.pans.find((q) => pose.x > q.x0 && pose.x < q.x1 && pose.z > q.z0 && pose.z < q.z1)?.state).toBe("crust");
        if (v.title === "Tally-Keeper" && pose.act === "write") expect(pose.carry).toBe("book");
        if (v.title === "Pump-Keeper" && pose.act === "lookup") expect(Math.hypot(pose.x - plan.pump.x, pose.z - plan.pump.z)).toBeLessThan(3);
      }
    }
    expect(raking).toBeGreaterThan(100);
  });

  it("nobody stands in anybody, dry or wet", () => {
    for (const seed of [7, 42]) {
      const f = buildSaltworksFolk(createSaltmarketWorld(seed), seed);
      const poses = f.roster.map(() => createVillagerPose());
      for (const rain of [0, 1]) {
        let closest = Infinity;
        let where = "";
        for (let ms = 0; ms < (24 * 3600 * 1000) / 30; ms += 4000) {
          const c = clockAt(seed, (ms / 3_600_000) * 48, ms, rain);
          poses.forEach((p, i) => villagerAt(f, i, c, p));
          for (let i = 0; i < poses.length; i++) {
            const a = poses[i]!;
            if (!a.visible || a.act === "walk") continue;
            for (let j = i + 1; j < poses.length; j++) {
              const b = poses[j]!;
              if (!b.visible || b.act === "walk") continue;
              const d = Math.hypot(a.x - b.x, a.z - b.z);
              if (d < closest) {
                closest = d;
                where = `${f.roster[i]!.name} (${a.act} at ${f.nav.stations[a.station]!.key}) and ${f.roster[j]!.name} (${b.act} at ${f.nav.stations[b.station]!.key})`;
              }
            }
          }
        }
        expect(closest, `seed ${seed} rain ${rain}: ${where}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("speak in the Brinefolk's own voice (their trade's, the pans', the rain's, a greeting, a fright), never another people's, and never a real place or people", () => {
    const lamp = buildLampsideFolk(createKessarWorld(7), 7);
    const theirs = new Set<string>();
    for (const v of folk.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) theirs.add(pickLine(v.lines, v.id, s, m));
    const kessarine = new Set<string>();
    for (const v of lamp.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) kessarine.add(pickLine(v.lines, v.id, s, m));
    for (const line of theirs) {
      expect(kessarine.has(line), line).toBe(false);
      expect(line, line).not.toMatch(REAL_WORLD_RE);
      expect(allLines()).toContain(line);
    }
    expect(theirs.size).toBeGreaterThan(20);
    expect(villagerGreeting(folk.roster[0]!, 3)).toBeTruthy();
    expect(villagerFright(folk.roster[0]!, 3)).toBeTruthy();
  });
});
