import { describe, expect, it } from "vitest";
import { insideObstacle } from "./camp.ts";
import { createKessarWorld, type KessarTerrain } from "./kessar.ts";
import { STALL, lampsidePlan, stallKeeper } from "./lampside.ts";
import { LAMPSIDE_FOLK_LAMPS, buildLampsideFolk, lampsideNav } from "./lampsideFolk.ts";
import { REAL_WORLD_RE } from "./realWorld.ts";
import { createArena } from "./arena.ts";
import { buildFolk, createFolkClock, createVillagerPose, setFolkClock, villagerAt, villagerGreeting, villagerSays, type Folk, type FolkClock, type VillagerPose } from "./villagers.ts";
import { allLines, pickLine } from "./villagerLines.ts";

/** D-120: Lampside's people, on the same schedule as Hollowmere's folk and their own network. */
const SEEDS = [1, 7, 42, 1337, 90210];
const clockAt = (seed: number, hours: number, ms = 0, rain?: number): FolkClock => setFolkClock(createFolkClock(), seed, ms, hours, 30, rain);

/** A test-local check that a person stands somewhere legal: nothing solid within a hand of them (Lampside's houses are solid, not rooms), out of the water, on the ground. */
function whyIllegal(folk: Folk, p: VillagerPose): string {
  const w = folk.nav.world;
  let why = "";
  w.forEachNear(p.x, p.z, (o) => {
    if (why) return;
    if (insideObstacle(o, p.x, p.z, 0.2)) why = `inside a ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`;
  });
  if (why) return why;
  if ((w.terrain as KessarTerrain).waterDepth(p.x, p.z) > 0.02) return "in the water";
  if (Math.abs(w.groundHeight(p.x, p.z, p.y) - p.y) > 0.5) return `floating or sunk: y ${p.y.toFixed(2)} vs ground ${w.groundHeight(p.x, p.z, p.y).toFixed(2)}`;
  return "";
}

describe("D-120: Lampside's people", () => {
  const w = createKessarWorld(7);
  const folk = buildLampsideFolk(w, 7);

  it("are ten Kessarine, each named for their household's lamp, with a trade, a home behind a back door and a day's work", () => {
    expect(folk.roster).toHaveLength(10);
    for (const v of folk.roster) {
      expect(v.people).toBe("kessarine");
      expect(v.name).toMatch(/ of the (First|Second|Third|Fourth|Fifth) Lamp$/);
      expect(v.stints.length, v.name).toBeGreaterThan(4);
      expect(v.stints.some((s) => folk.nav.stations[s.st]!.key === `in:${v.home}` && s.act === "sleep"), `${v.name} has a bed`).toBe(true);
      expect(v.stints.some((s) => !folk.nav.stations[s.st]!.hidden && s.act !== "idle"), `${v.name} has work`).toBe(true);
    }
    expect(new Set(folk.roster.map((v) => v.name)).size).toBe(10);
    // deterministic in (world, seed), its own people (never Hollowmere's in a Kessar world), cached
    expect(buildLampsideFolk(createKessarWorld(7), 7).roster.map((v) => v.name)).toEqual(folk.roster.map((v) => v.name));
    expect(buildLampsideFolk(w, 7)).toBe(folk);
    expect(buildLampsideFolk(w, 8).roster.map((v) => v.lookSeed)).not.toEqual(folk.roster.map((v) => v.lookSeed));
  });

  it("can reach every station of the town on every seed: the doors at the back, the stalls, the well, the nine lamps, the plots", () => {
    for (const seed of SEEDS) {
      const why = new Map<string, string>();
      const nav = lampsideNav(createKessarWorld(seed), why);
      expect(nav.stations.filter((s) => !s.ok).map((s) => `${s.key}: ${why.get(s.key)}`), `seed ${seed}`).toEqual([]);
      expect(nav.stations.filter((s) => s.key.startsWith("lamp:"))).toHaveLength(LAMPSIDE_FOLK_LAMPS);
      for (const k of ["stall:e", "stall:n", "well", "garden:w:a", "garden:w:b", "garden:e:a", "garden:e:b", "chits"]) {
        expect(nav.distance(nav.index.get("step:w1")!, nav.index.get(k)!), `seed ${seed} ${k}`).toBeLessThan(Infinity);
      }
    }
  }, 60_000);

  it("nobody is ever inside a wall, a house, a stall, a palm or the water, at any hour, dry or in a downpour, on any seed", () => {
    const pose = createVillagerPose();
    for (const seed of SEEDS) {
      const f = buildLampsideFolk(createKessarWorld(seed), seed);
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

  it("they move like people: never a jump, never faster than a brisk walk (children a trot), and they stand still to work", () => {
    const a = createVillagerPose();
    const b = createVillagerPose();
    for (const seed of [7, 42]) {
      const f = buildLampsideFolk(createKessarWorld(seed), seed);
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

  it("keep human hours: nobody out in the small hours, the street full by mid-morning, the Lamp-Trimmer out at dusk and first light with the lantern", () => {
    const pose = createVillagerPose();
    const seen = (h: number): number => {
      let n = 0;
      for (let i = 0; i < folk.roster.length; i++) {
        villagerAt(folk, i, clockAt(7, h), pose);
        if (pose.visible) n++;
      }
      return n;
    };
    expect(seen(2.5)).toBe(0);
    expect(seen(23)).toBe(0);
    expect(seen(10)).toBeGreaterThanOrEqual(9);
    expect(seen(15)).toBeGreaterThanOrEqual(9);
    // the trimmer lights the lamps in order at dusk, lantern in hand, and puts them out at first light: every lamp visited, each under its own lamp
    const t = folk.roster.findIndex((v) => v.title === "Lamp-Trimmer");
    const lit = new Set<string>();
    for (const [h0, h1] of [[17.9, 20], [5.5, 7.7]] as const) {
      for (let h = h0; h < h1; h += 0.01) {
        villagerAt(folk, t, clockAt(7, h), pose);
        const key = folk.nav.stations[pose.station]!.key;
        if (pose.act === "lamp") {
          expect(pose.carry).toBe("lantern");
          lit.add(`${h0}:${key}`);
        }
      }
    }
    expect([...lit].filter((k) => k.startsWith("17.9")).length).toBe(LAMPSIDE_FOLK_LAMPS);
    expect([...lit].filter((k) => k.startsWith("5.5")).length).toBe(LAMPSIDE_FOLK_LAMPS);
  });

  it("rain sends the gardeners, the children and the elder home and the rest under the stalls and the awnings; the stallkeepers stay put", () => {
    const dry = createVillagerPose();
    const wet = createVillagerPose();
    let visibleDry = 0;
    let visibleWet = 0;
    for (const h of [9.5, 11, 15.3, 16.5]) {
      for (let i = 0; i < folk.roster.length; i++) {
        villagerAt(folk, i, clockAt(7, h, 0, 0), dry);
        villagerAt(folk, i, clockAt(7, h, 0, 1), wet);
        if (dry.visible) visibleDry++;
        if (wet.visible) {
          visibleWet++;
          if (wet.act !== "walk") expect(folk.nav.stations[wet.station]!.sheltered, `${folk.roster[i]!.name} out in the rain at ${folk.nav.stations[wet.station]!.key}`).toBe(true);
        }
        const v = folk.roster[i]!;
        if (v.occupation === "seller" && dry.act === "sell") expect(Math.hypot(dry.x - wet.x, dry.z - wet.z)).toBeLessThan(1e-6);
      }
    }
    expect(visibleWet).toBeLessThan(visibleDry);
  });

  it("nobody stands in anybody, and a stallkeeper stands behind the counter, in the room the stall leaves between counter and backboard (too narrow for a player)", () => {
    for (const seed of [7, 42]) {
      const f = buildLampsideFolk(createKessarWorld(seed), seed);
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
    const pose = createVillagerPose();
    for (const st of lampsidePlan().stalls) {
      const i = folk.roster.findIndex((v) => v.stints.some((s) => folk.nav.stations[s.st]!.key === `stall:${st.id.replace("stall.", "")}` && s.act === "sell"));
      expect(i, st.id).toBeGreaterThanOrEqual(0);
      villagerAt(folk, i, clockAt(7, 10.5), pose);
      expect(pose.act).toBe("sell");
      const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      const lx = (pose.x - st.x) * c + (pose.z - st.z) * s;
      const lz = -(pose.x - st.x) * s + (pose.z - st.z) * c;
      expect(Math.abs(lx - stallKeeper(st)), st.id).toBeLessThan(0.05);
      expect(Math.abs(lz), st.id).toBeLessThan(st.hz);
    }
    // (the room between is 0.7 m: a villager is 0.52 across, a player 0.8)
    const gap = 2 * lampsidePlan().stalls[0]!.hx - STALL.counter - STALL.back;
    expect(gap).toBeGreaterThan(0.52);
    expect(gap).toBeLessThan(0.8);
  }, 240_000);

  it("speak the Kessarine pools, never Hollowmere's, and nothing of a real people, nation or faith", () => {
    const pose = createVillagerPose();
    const speech = { text: "", u: 0 };
    const said = new Set<string>();
    for (let i = 0; i < folk.roster.length; i++) {
      villagerAt(folk, i, clockAt(7, 10.5), pose);
      for (let s = 0; s < 2000; s += 3) {
        const out = villagerSays(folk.roster[i]!, pose, s, 10.5, 0, speech);
        if (out) said.add(out.text);
      }
      for (let k = 0; k < 6; k++) said.add(villagerGreeting(folk.roster[i]!, k));
    }
    expect(said.size).toBeGreaterThan(15);
    for (const line of said) {
      expect(line, line).not.toMatch(/Hollowmere|geese|Tuesday/);
      expect(line.length).toBeLessThan(90);
    }
    const kessar = ["kLamp", "kSeller", "kWater", "kGarden", "kClerk", "kElder", "kChild"] as const;
    for (const k of kessar) for (let s = 0; s < 40; s++) for (const m of ["", "rain", "night", "greet"] as const) expect(pickLine(k, 1, s, m)).not.toMatch(/Hollowmere|geese/);
    for (const line of allLines()) expect(REAL_WORLD_RE.test(line), line).toBe(false);
    for (const v of folk.roster) expect(REAL_WORLD_RE.test(v.name), v.name).toBe(false);
  });

  it("leave Hollowmere's people as they were: the village's own folk in its own world", () => {
    const hub = buildFolk(createArena(7), 7);
    expect(hub.roster.every((v) => v.people === undefined)).toBe(true);
    expect(hub.roster.some((v) => v.name.includes(" of the "))).toBe(false);
  });
});
