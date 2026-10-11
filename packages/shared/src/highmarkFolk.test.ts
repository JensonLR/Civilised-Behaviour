import { describe, expect, it } from "vitest";
import { insideObstacle } from "./camp.ts";
import type { FieldPlot } from "./fields.ts";
import { HIGHMARK, HIGHMARK_FIELDS, createHighmarkWorld, highmarkPlan, highmarkSitePoints, highmarkSpawn, type HighmarkTerrain } from "./highmark.ts";
import { ARRIVAL_TOWARD, arrivalCentre, inArrival } from "./stores.ts";
import { MARCHER_HOMES, buildHighmarkFolk, marcherNav } from "./highmarkFolk.ts";
import { buildLampsideFolk } from "./lampsideFolk.ts";
import { createKessarWorld } from "./kessar.ts";
import { REAL_WORLD_RE } from "./realWorld.ts";
import { createSaltmarketWorld } from "./saltmarket.ts";
import { buildSaltworksFolk } from "./saltworksFolk.ts";
import { standingHeight } from "./villagerNav.ts";
import { createFolkClock, createVillagerPose, setFolkClock, villagerAt, villagerFright, villagerGreeting, type Folk, type FolkClock, type VillagerPose } from "./villagers.ts";
import { allLines, pickLine } from "./villagerLines.ts";

/** D-124: the Marchers of Highmark's capital, on the same schedule as the other folk, on the hill's own network. */
const SEEDS = [1, 7, 42, 1337, 90210];
const clockAt = (seed: number, hours: number, ms = 0, rain?: number): FolkClock => setFolkClock(createFolkClock(), seed, ms, hours, 30, rain);
const C = HIGHMARK.centre;
const radius = (x: number, z: number): number => Math.hypot(x - C.x, z - C.z);

/** A person stands somewhere legal: nothing solid within a hand of them (the gate's lintel is over their heads), out of the river, on the ground. */
function whyIllegal(folk: Folk, p: VillagerPose): string {
  const w = folk.nav.world;
  let why = "";
  w.forEachNear(p.x, p.z, (o) => {
    if (why || o.tag === "jetty" || o.y0 > p.y + 2.2) return;   // (the quay's planks are a floor: D-128's hands walk them to the Grange's barge)
    if (insideObstacle(o, p.x, p.z, 0.2)) why = `inside a ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`;
  });
  if (why) return why;
  if ((w.terrain as HighmarkTerrain).waterDepth(p.x, p.z) > 0.02 && p.y < HIGHMARK.level - 0.1) return "in the water";   // (on the quay's deck, above it, is dry)
  if (Math.abs(w.groundHeight(p.x, p.z, p.y) - p.y) > 0.5) return `floating or sunk: y ${p.y.toFixed(2)} vs ground ${w.groundHeight(p.x, p.z, p.y).toFixed(2)}`;
  return "";
}

describe("D-124: the Marchers of Highmark's capital", () => {
  const w = createHighmarkWorld(7);
  const folk = buildHighmarkFolk(w, 7);

  it("are eighteen Marchers, each named for the ring of the hill they lodge on (D-128: or the Grange, for its hands on the barge), with a trade, a bed and a day's work", () => {
    expect(folk.roster).toHaveLength(18);
    const homes = [...MARCHER_HOMES.map((h) => `hall${h.hall}`), "barge"];
    for (const v of folk.roster) {
      expect(v.people).toBe("marchers");
      expect(v.name).toMatch(v.home === "barge" ? / of the Grange$/ : / of the (Third|Fourth) Ring$/);
      expect(homes).toContain(v.home);
      expect(v.stints.some((s) => folk.nav.stations[s.st]!.key === `in:${v.home}` && s.act === "sleep"), `${v.name} has a bed`).toBe(true);
      expect(v.stints.some((s) => !folk.nav.stations[s.st]!.hidden && s.act !== "idle"), `${v.name} has work`).toBe(true);
    }
    expect(new Set(folk.roster.map((v) => v.name)).size).toBe(18);
    for (const t of ["Cheese-Seller", "Loaf-Seller", "Hide-Seller", "Grain-Seller", "Town Crier", "Water-Carrier", "Under-Clerk", "Petitioner", "Old Petitioner", "Granary-Reeve", "Porter",
      "Hay-Turner", "Haycock-Builder", "Ploughman", "Hoer", "Gleaner"]) {
      expect(folk.roster.some((v) => v.title === t), t).toBe(true);
    }
    // deterministic in (world, seed), cached, and their own
    expect(buildHighmarkFolk(createHighmarkWorld(7), 7).roster.map((v) => v.name)).toEqual(folk.roster.map((v) => v.name));
    expect(buildHighmarkFolk(w, 7)).toBe(folk);
    expect(buildHighmarkFolk(w, 8).roster.map((v) => v.lookSeed)).not.toEqual(folk.roster.map((v) => v.lookSeed));
  });

  it("can reach every place on every seed: three terraces and the court through the gate's passage (under the lintel), the stalls from behind, the well, the granaries", () => {
    for (const seed of SEEDS) {
      const why = new Map<string, string>();
      const nav = marcherNav(createHighmarkWorld(seed), why);
      expect(nav.stations.filter((s) => !s.ok).map((s) => `${s.key}: ${why.get(s.key)}`), `seed ${seed}`).toEqual([]);
      const from = nav.index.get("step:hall1")!;
      for (const k of ["stall:0", "stall:2", "stall:4", "front:3", "cry:west", "cry:east", "well:a", "well:b", "granary:0", "granary:2", "office:hall4", "petition:a", "step:hall2", "in:hall3", "play:ramp", "chat:2:a", "chat:3:b"]) {
        expect(nav.distance(from, nav.index.get(k)!), `seed ${seed} ${k}`).toBeLessThan(Infinity);
      }
      // the court terrace is reached through the gate: the way from the court's lodgings to the market goes under the lintel
      const route = nav.route(nav.index.get("step:hall2")!, nav.index.get("stall:0")!)!;
      let gate = Infinity;
      for (let k = 0; k < route.n; k++) gate = Math.min(gate, Math.hypot(route.x[k]! - 0, route.z[k]! - -58));
      expect(gate, `seed ${seed}: through the gate`).toBeLessThan(3);
    }
    // and without the headroom the lintel shuts it (the default every other region keeps)
    const bare = createHighmarkWorld(7);
    expect(standingHeight(bare, 0, -59, HIGHMARK.heights[4]!)).toBeUndefined();
  }, 60_000);

  it("keep off the plateau and away from every story point (the succession's people, the Chamberlain's guards, the Grange's delegates, the envoy, the strike's scale)", () => {
    const sites = highmarkSitePoints();
    for (const s of folk.nav.stations) {
      for (const q of sites) expect(Math.hypot(q.x - s.x, q.z - s.z), `${s.key} by ${q.id}`).toBeGreaterThanOrEqual(6);
    }
    const pose = createVillagerPose();
    for (let i = 0; i < folk.roster.length; i++) {
      for (let h = 0; h < 24; h += 0.02) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (pose.visible) expect(radius(pose.x, pose.z), `${folk.roster[i]!.name} at ${h.toFixed(2)} h`).toBeGreaterThan(HIGHMARK.radii[4]! + 1);
      }
    }
  });

  it("nobody is ever inside a hall, a stall, a granary, a wall or the river, at any hour, dry or in a downpour, on any seed", () => {
    const pose = createVillagerPose();
    for (const seed of SEEDS) {
      const f = buildHighmarkFolk(createHighmarkWorld(seed), seed);
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

  it("they move like people on a big hill: the long walks are given their time, so nobody hurries (a brisk walk at most; the child a trot), dry or wet, and they stand still to work", () => {
    const a = createVillagerPose();
    const b = createVillagerPose();
    for (const seed of [7, 42]) {
      const f = buildHighmarkFolk(createHighmarkWorld(seed), seed);
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

  it("keep the capital's hours: nobody out in the small hours, the hill busy by mid-morning; in a downpour nobody stands about in the open", () => {
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
    expect(seen(10)).toBeGreaterThanOrEqual(9);
    expect(seen(15)).toBeGreaterThanOrEqual(9);
    // the market's people stay at their stalls in the rain, under the awnings; nobody is left standing in the open
    for (const h of [10, 11.5, 15, 16]) {
      expect(seen(h, 1, true), `${h} h in the rain`).toBe(0);
      expect(seen(h, 1), `${h} h in the rain: the stalls still kept`).toBeGreaterThanOrEqual(3);
    }
  });

  it("work in their places: the stallkeepers behind their counters, the crier ringing at the empty stall or the market's ends, the Reeve's book at the granaries, the petitioners at the Chamberlain's sealed door", () => {
    const pose = createVillagerPose();
    const plan = highmarkPlan();
    let selling = 0;
    let waiting = 0;
    for (let i = 0; i < folk.roster.length; i++) {
      const v = folk.roster[i]!;
      for (let h = 7.5; h < 17.5; h += 0.05) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (!pose.visible || pose.act === "walk" || pose.act === "chat") continue;
        if (v.title.endsWith("-Seller") && pose.act === "sell") {
          selling++;
          // between the counter and the guild terrace's wall: inside the stall's own frame, behind it
          const st = plan.stalls.reduce((best, s) => (Math.hypot(s.x - pose.x, s.z - pose.z) < Math.hypot(best.x - pose.x, best.z - pose.z) ? s : best));
          const lx = (pose.x - st.x) * Math.cos(st.yaw) + (pose.z - st.z) * Math.sin(st.yaw);
          const lz = -(pose.x - st.x) * Math.sin(st.yaw) + (pose.z - st.z) * Math.cos(st.yaw);
          expect(Math.abs(lx), `${v.name} along the counter`).toBeLessThan(st.hx + 0.5);
          expect(lz, `${v.name} behind the counter`).toBeLessThan(-st.hz * 0.7);
          expect(lz).toBeGreaterThan(-2.2);
        }
        if (v.title === "Town Crier" && pose.act === "ring") expect(radius(pose.x, pose.z), "on the market terrace").toBeGreaterThan(HIGHMARK.radii[2]!);
        if (v.title === "Granary-Reeve" && pose.act === "write") {
          expect(pose.carry).toBe("book");
          expect(Math.min(...plan.granaries.map((g) => Math.hypot(g.x - pose.x, g.z - pose.z) - g.r)), "at a granary").toBeLessThan(3);
        }
        if (v.title.includes("Petitioner") && pose.act === "read") {
          waiting++;
          expect(Math.hypot(pose.x - plan.halls[2]!.x, pose.z - plan.halls[2]!.z), `${v.name} at the Chamberlain's office`).toBeLessThan(6.5);
        }
      }
    }
    expect(selling).toBeGreaterThan(300);
    expect(waiting).toBeGreaterThan(150);
  });

  it("D-128: the Grange's hands work the plain's fields (each in the field of their trade, never the strike's barley), live on the Grange's barge at the quay, and keep out of the party's arrival", () => {
    const pose = createVillagerPose();
    const field = (id: string): FieldPlot => HIGHMARK_FIELDS.find((f) => f.id === id)!;
    const inField = (f: FieldPlot, x: number, z: number, m = 0.5): boolean => x > f.x0 - m && x < f.x1 + m && z > f.z0 - m && z < f.z1 + m;
    const want: Record<string, string> = { "Hay-Turner": "hay.west", "Haycock-Builder": "hay.west", Ploughman: "fallow.east", Hoer: "green.west", Gleaner: "stubble.east", Pip: "stubble.east" };
    const working: Record<string, number> = {};
    for (let i = 0; i < folk.roster.length; i++) {
      const v = folk.roster[i]!;
      if (v.home !== "barge") continue;
      for (let h = 7.5; h < 17.5; h += 0.05) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (!pose.visible || pose.act === "walk" || pose.act === "chat" || pose.act === "idle") continue;
        if (/^(step|in):/.test(folk.nav.stations[pose.station]!.key)) continue;   // (at the barge: a child plays at the door too)
        working[v.title] = (working[v.title] ?? 0) + 1;
        expect(inField(field(want[v.title]!), pose.x, pose.z), `${v.name} (${v.title}) in their field at ${h.toFixed(2)} h: ${pose.x.toFixed(1)}, ${pose.z.toFixed(1)}`).toBe(true);
        expect(inField(field("strike"), pose.x, pose.z, 2), `${v.name} off the strike's barley`).toBe(false);
      }
    }
    for (const t of Object.keys(want)) expect(working[t] ?? 0, t).toBeGreaterThan(40);
    // home: the barge's stations stand on the quay's deck, by the barge
    const q = highmarkPlan().quay;
    for (const k of ["step:barge", "in:barge"]) {
      const st = folk.nav.stations[folk.nav.index.get(k)!]!;
      expect(Math.abs(st.y - HIGHMARK.level), k).toBeLessThan(0.05);
      expect(Math.abs(st.x - q.x), k).toBeLessThan(q.half);
      expect(Math.abs(st.z - q.boat.z), k).toBeLessThan(0.5);
    }
    // nobody's place is in the party's arrival (the ring, the view up the road, the camera's ground)
    const arrival = arrivalCentre(highmarkSpawn);
    for (const s of folk.nav.stations) expect(inArrival(arrival, ARRIVAL_TOWARD, s.x, s.z, 0.4), s.key).toBe(false);
  });

  it("nobody stands in anybody, dry or wet", () => {
    for (const seed of [7, 42]) {
      const f = buildHighmarkFolk(createHighmarkWorld(seed), seed);
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

  it("speak in the Marchers' own voice, never the Kessarine's or the Brinefolk's, and never a real place or people", () => {
    const others = new Set<string>();
    for (const f of [buildLampsideFolk(createKessarWorld(7), 7), buildSaltworksFolk(createSaltmarketWorld(7), 7)]) {
      for (const v of f.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) others.add(pickLine(v.lines, v.id, s, m));
    }
    const theirs = new Set<string>();
    for (const v of folk.roster) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet", "fright"] as const) theirs.add(pickLine(v.lines, v.id, s, m));
    for (const line of theirs) {
      expect(others.has(line), line).toBe(false);
      expect(line, line).not.toMatch(REAL_WORLD_RE);
      expect(allLines()).toContain(line);
    }
    expect(theirs.size).toBeGreaterThan(25);
    expect(villagerGreeting(folk.roster[0]!, 3)).toBeTruthy();
    expect(villagerFright(folk.roster[0]!, 3)).toBeTruthy();
  });
});
