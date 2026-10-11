import { describe, expect, it } from "vitest";
import { insideObstacle } from "./camp.ts";
import { buildHighmarkFolk } from "./highmarkFolk.ts";
import { createHighmarkWorld } from "./highmark.ts";
import { buildLampsideFolk } from "./lampsideFolk.ts";
import { createKessarWorld } from "./kessar.ts";
import { REAL_WORLD_RE } from "./realWorld.ts";
import { createSaltmarketWorld } from "./saltmarket.ts";
import { buildSaltworksFolk } from "./saltworksFolk.ts";
import { CLOISTER, createVesperWorld, vesperPlan, vesperSitePoints } from "./vesper.ts";
import { buildVesperFolk, gorgeNav } from "./vesperFolk.ts";
import { createFolkClock, createVillagerPose, setFolkClock, villagerAt, villagerFright, villagerGreeting, type Folk, type FolkClock, type VillagerPose } from "./villagers.ts";
import { allLines, pickLine } from "./villagerLines.ts";

/** D-125: Vesper's folk (the Guild, the Assay, the Barge), on the same schedule as the other regions' folk, on the gorge's own network. */
const SEEDS = [1, 7, 42, 1337, 90210];
const clockAt = (seed: number, hours: number, ms = 0, rain?: number): FolkClock => setFolkClock(createFolkClock(), seed, ms, hours, 30, rain);
const FLOORS = new Set(["jetty", "bridge"]);

/** A person stands somewhere legal: nothing solid within a hand of them (the wharf's planks are a floor), out of the basin's water, on the ground or the deck. */
function whyIllegal(folk: Folk, p: VillagerPose): string {
  const w = folk.nav.world;
  let why = "";
  w.forEachNear(p.x, p.z, (o) => {
    if (why || FLOORS.has(o.tag ?? "") || o.y0 > p.y + 2.2) return;
    if (insideObstacle(o, p.x, p.z, 0.2)) why = `inside a ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`;
  });
  if (why) return why;
  const pool = vesperPlan().wharf.pool;
  if (Math.hypot(p.x - pool.x, p.z - pool.z) < pool.r && p.y < pool.y + 0.02) return "in the basin's water";
  if (Math.abs(w.groundHeight(p.x, p.z, p.y) - p.y) > 0.5) return `floating or sunk: y ${p.y.toFixed(2)} vs ground ${w.groundHeight(p.x, p.z, p.y).toFixed(2)}`;
  return "";
}

describe("D-125: Vesper's folk", () => {
  const w = createVesperWorld(7);
  const folk = buildVesperFolk(w, 7);

  it("are ten members of the gorge's institutions, each named for the one they belong to, with a trade, a bed (the cloister, the Assay House, the barge) and a day's work", () => {
    expect(folk.roster).toHaveLength(10);
    for (const v of folk.roster) {
      expect(v.people).toBe("vesperine");
      expect(v.name).toMatch(/ of the (Guild|Assay|Barge)$/);
      expect(["guild", "assay", "barge"]).toContain(v.home);
      expect(v.stints.some((s) => folk.nav.stations[s.st]!.key === `in:${v.home}` && s.act === "sleep"), `${v.name} has a bed`).toBe(true);
      expect(v.stints.some((s) => !folk.nav.stations[s.st]!.hidden && s.act !== "idle"), `${v.name} has work`).toBe(true);
    }
    expect(new Set(folk.roster.map((v) => v.name)).size).toBe(10);
    for (const t of ["Bell-Warden", "Chorister", "Novice", "Senior Mourner", "Sample-Clerk", "Sample-Porter", "Bargee", "Barge-Hand"]) expect(folk.roster.some((v) => v.title === t), t).toBe(true);
    expect(buildVesperFolk(createVesperWorld(7), 7).roster.map((v) => v.name)).toEqual(folk.roster.map((v) => v.name));
    expect(buildVesperFolk(w, 7)).toBe(folk);
  });

  it("can reach every place on every seed: the cloister's arcade and its door, the Assay House's back door on the cliff side, the carts on the road, and the wharf's planks over the basin", () => {
    for (const seed of SEEDS) {
      const why = new Map<string, string>();
      const nav = gorgeNav(createVesperWorld(seed), why);
      expect(nav.stations.filter((s) => !s.ok).map((s) => `${s.key}: ${why.get(s.key)}`), `seed ${seed}`).toEqual([]);
      const from = nav.index.get("step:guild")!;
      for (const k of ["bell", "arch:a", "arch:b", "sweep:a", "sweep:b", "lean:arch", "step:assay", "in:assay", "bin", "cart:0", "cart:1", "cart:2", "step:barge", "in:barge", "moor:w", "moor:e", "plank", "play:bank", "play:road"]) {
        expect(nav.distance(from, nav.index.get(k)!), `seed ${seed} ${k}`).toBeLessThan(Infinity);
      }
      // the bargefolk stand on the deck, not the basin's floor
      for (const k of ["step:barge", "moor:w", "plank"]) expect(Math.abs(nav.stations[nav.index.get(k)!]!.y - vesperPlan().wharf.y), k).toBeLessThan(0.05);
    }
  }, 60_000);

  it("keep away from every story point and off the head of the gorge (the mine's yard and the winding house are the contracts')", () => {
    const sites = vesperSitePoints();
    for (const s of folk.nav.stations) for (const q of sites) expect(Math.hypot(q.x - s.x, q.z - s.z), `${s.key} by ${q.id}`).toBeGreaterThanOrEqual(6);
    const pose = createVillagerPose();
    for (let i = 0; i < folk.roster.length; i++) {
      for (let h = 0; h < 24; h += 0.02) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (pose.visible) expect(pose.z, `${folk.roster[i]!.name} at ${h.toFixed(2)} h`).toBeGreaterThan(-48);
      }
    }
  });

  it("nobody is ever inside the cloister's piers, a building, a cart, the wharf's bollards or the basin, at any hour, dry or in a downpour, on any seed", () => {
    const pose = createVillagerPose();
    for (const seed of SEEDS) {
      const f = buildVesperFolk(createVesperWorld(seed), seed);
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

  it("they move like people up and down the gorge: nobody hurries (a brisk walk at most; the child a trot), dry or wet, and they stand still to work", () => {
    const a = createVillagerPose();
    const b = createVillagerPose();
    for (const seed of [7, 42]) {
      const f = buildVesperFolk(createVesperWorld(seed), seed);
      for (const rain of [0, 1]) {
        for (let i = 0; i < f.roster.length; i++) {
          const v = f.roster[i]!;
          const top = v.age === "child" ? 2.6 : 1.9;
          let walked = 0;
          let stood = 0;
          const dh = 0.004;
          for (let h = 0; h < 24; h += dh) {
            villagerAt(f, i, clockAt(seed, h, 0, rain), a);
            villagerAt(f, i, clockAt(seed, h + dh, 0, rain), b);
            if (!a.visible || !b.visible) continue;
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            const dt = dh * (h < 5.2 || h > 20.6 ? 32.9 : 98.5);
            expect(d / dt, `seed ${seed} rain ${rain}: ${v.name} at ${(d / dt).toFixed(2)} m/s at ${h.toFixed(3)} h (${a.act} -> ${b.act})`).toBeLessThan(top);
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

  it("keep the gorge's hours: nobody out in the small hours, busy by mid-morning; in rain only the Guild stay out, under the arcade's roof", () => {
    const pose = createVillagerPose();
    const seen = (h: number, rain = 0, open = false): number => {
      let n = 0;
      for (let i = 0; i < folk.roster.length; i++) {
        villagerAt(folk, i, clockAt(7, h, 0, rain), pose);
        if (!pose.visible || pose.act === "walk") continue;
        if (open && folk.nav.stations[pose.station]!.sheltered) continue;
        n++;
      }
      return n;
    };
    expect(seen(2.5)).toBe(0);
    expect(seen(23)).toBe(0);
    expect(seen(10)).toBeGreaterThanOrEqual(7);
    expect(seen(15)).toBeGreaterThanOrEqual(7);
    for (const h of [10, 11.5, 15, 16]) {
      expect(seen(h, 1, true), `${h} h in the rain`).toBe(0);
      expect(seen(h, 1), `${h} h in the rain: the arcade still kept`).toBeGreaterThanOrEqual(2);
    }
  });

  it("work in their places: the choristers in the arches with their dirges, the Bell-Warden ringing in the arcade, the clerk's book at the carts, the bargefolk on the planks", () => {
    const pose = createVillagerPose();
    const C = CLOISTER;
    const w2 = vesperPlan().wharf;
    let reading = 0;
    let mooring = 0;
    for (let i = 0; i < folk.roster.length; i++) {
      const v = folk.roster[i]!;
      for (let h = 7.5; h < 17.5; h += 0.05) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (!pose.visible || pose.act === "walk" || pose.act === "chat") continue;
        if (v.title === "Chorister" && pose.act === "read") {
          reading++;
          expect(pose.carry).toBe("book");
          expect(pose.x, `${v.name} in the arcade`).toBeGreaterThan(C.backX);
          expect(pose.x).toBeLessThan(C.frontX);
        }
        if (v.title === "Bell-Warden" && pose.act === "ring") {
          expect(pose.x).toBeGreaterThan(C.backX);
          expect(pose.x).toBeLessThan(C.pierIn);
        }
        if (v.title === "Sample-Clerk" && pose.act === "write") expect(pose.carry).toBe("book");
        if (v.title === "Bargee" && pose.act === "tend") {
          mooring++;
          expect(Math.abs(pose.x - w2.x), `${v.name} on the planks`).toBeLessThan(w2.half);
          expect(Math.abs(pose.y - w2.y)).toBeLessThan(0.05);
        }
      }
    }
    expect(reading).toBeGreaterThan(150);
    expect(mooring).toBeGreaterThan(80);
  });

  it("nobody stands in anybody, dry or wet", () => {
    for (const seed of [7, 42]) {
      const f = buildVesperFolk(createVesperWorld(seed), seed);
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

  it("speak in the gorge's own voice, never another region's folk, and never a real place or people", () => {
    const others = new Set<string>();
    for (const f of [buildLampsideFolk(createKessarWorld(7), 7), buildSaltworksFolk(createSaltmarketWorld(7), 7), buildHighmarkFolk(createHighmarkWorld(7), 7)]) {
      for (const v of f.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) others.add(pickLine(v.lines, v.id, s, m));
    }
    const theirs = new Set<string>();
    for (const v of folk.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) theirs.add(pickLine(v.lines, v.id, s, m));
    for (const line of theirs) {
      expect(others.has(line), line).toBe(false);
      expect(line, line).not.toMatch(REAL_WORLD_RE);
      expect(allLines()).toContain(line);
    }
    expect(theirs.size).toBeGreaterThan(20);
    expect(villagerGreeting(folk.roster[0]!, 3)).toBeTruthy();
    expect(villagerFright(folk.roster[0]!, 3)).toBeTruthy();
  });
});
