import { describe, expect, it } from "vitest";
import { createArena } from "./arena.ts";
import { insideObstacle } from "./camp.ts";
import { worldHours } from "./daycycle.ts";
import { waterEdgeDistance } from "./landscape.ts";
import { buildFolk, createFolkClock, createVillagerPose, setFolkClock, villagerAt, villagerSays, type Folk, type FolkClock, type Speech, type VillagerPose } from "./villagers.ts";
import { allLines } from "./villagerLines.ts";
import { standingHeight } from "./villagerNav.ts";

const SEEDS = [1, 7, 42, 1234, 20240, 987654];

const clockAt = (seed: number, hours: number, ms = 0, rain?: number): FolkClock => setFolkClock(createFolkClock(), seed, ms, hours, 30, rain);

/** A test-local check that a person stands somewhere legal: nothing solid in the way but floors and steps, and out of the water. Independent of the nav code. */
function whyIllegal(folk: Folk, p: VillagerPose): string {
  const w = folk.nav.world;
  let why = "";
  const seated = p.act === "sit";
  const onSeat = folk.nav.stations.some((st) => st.seat && Math.hypot(st.x - p.x, st.z - p.z) < 0.9); // (the last step onto a bench, or off it)
  w.forEachNear(p.x, p.z, (o) => {
    if (why || o.tag === "house" || o.tag === "jetty" || o.tag === "weir" || o.tag === "bridge") return;
    if (o.tag === "vprop" && (seated || onSeat) && Math.hypot(o.x - p.x, o.z - p.z) < 1.2) return;
    if (insideObstacle(o, p.x, p.z, 0.2)) why = `inside a ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`;
  });
  if (why) return why;
  const probe = { x: p.x, z: p.z };
  // (heights are a smoothed ramp over stairs, so allow a hand's breadth of it when asking whether a step is climbable)
  if (w.resolveXZ(probe, p.y + 0.12, 0.2, 1.7)) return `pushed out of a wall or a floor edge (feet ${p.y.toFixed(2)})`;
  const onSomething = w.groundHeight(p.x, p.z, p.y) > w.terrainHeight(p.x, p.z) + 0.04;
  if (!onSomething && waterEdgeDistance(p.x, p.z) < 0.2) return "in the water";
  if (Math.abs(w.groundHeight(p.x, p.z, p.y) - p.y) > 0.9 && !seated) return `floating or sunk: y ${p.y.toFixed(2)} vs ground ${w.groundHeight(p.x, p.z, p.y).toFixed(2)}`;
  return "";
}

describe("Hollowmere's folk: the roster", () => {
  const w = createArena(7);
  const folk = buildFolk(w, 7);

  it("is between 14 and 24 people with names, trades, homes and a look seed each, and is deterministic in (world, seed)", () => {
    expect(folk.roster.length).toBeGreaterThanOrEqual(14);
    expect(folk.roster.length).toBeLessThanOrEqual(24);
    const again = buildFolk(createArena(7), 7);
    expect(again.roster).toEqual(folk.roster);
    const other = buildFolk(createArena(7), 8);
    expect(other.roster.map((v) => v.name)).not.toEqual(folk.roster.map((v) => v.name));
    expect(new Set(folk.roster.map((v) => v.id)).size).toBe(folk.roster.length);
    expect(new Set(folk.roster.map((v) => v.name)).size).toBe(folk.roster.length);
    for (const v of folk.roster) {
      expect(v.name.length).toBeGreaterThan(3);
      expect(v.stints.length).toBeGreaterThan(2);
      expect(v.scale).toBeGreaterThan(0.5);
      expect(v.scale).toBeLessThanOrEqual(1);
    }
    expect(new Set(folk.roster.map((v) => v.occupation)).size).toBeGreaterThanOrEqual(12);
    expect(folk.roster.filter((v) => v.age === "child").length).toBeGreaterThanOrEqual(2);
    expect(folk.roster.filter((v) => v.age === "elder").length).toBeGreaterThanOrEqual(2);
  });

  it("every person has a bed indoors and a place to work, on every seed", () => {
    for (const seed of SEEDS) {
      const f = buildFolk(createArena(seed), seed);
      for (const v of f.roster) {
        const beds = v.stints.filter((s) => f.nav.stations[s.st]!.hidden && s.act === "sleep");
        expect(beds.length, `seed ${seed} ${v.name} has no bed`).toBeGreaterThanOrEqual(1);
        expect(f.nav.stations[beds[0]!.st]!.key, `${v.name} sleeps in their own house`).toBe(`in:${v.home}`);
        if (v.age === "adult") {
          const work = v.stints.filter((s) => !f.nav.stations[s.st]!.hidden && !["idle", "sit", "walk", "play", "chat"].includes(s.act));
          expect(work.length, `seed ${seed} ${v.name} (${v.occupation}) has nothing to do`).toBeGreaterThanOrEqual(1);
        }
        for (const s of v.stints) expect(f.nav.stations[s.st]!.ok, `${v.name} stint at ${f.nav.stations[s.st]!.key}`).toBe(true);
      }
    }
  });

  it("the stations that make the village what it is are all reachable on every seed", () => {
    for (const seed of SEEDS) {
      const f = buildFolk(createArena(seed), seed);
      for (const key of ["plaza", "well", "anvil", "trough", "mill-sacks", "mill-cart", "gate-out", "gate-look", "jetty-end", "step:cot-a", "in:hall", "stall:1", "stall:2", "stall:3", "stall:4", "bench:0:1", "bench:1:2", "garden:0", "hive:0", "weir"]) {
        const i = f.nav.index.get(key);
        expect(i, `seed ${seed}: no station ${key}`).toBeDefined();
        const st = f.nav.stations[i!]!;
        // the weir, the gardens and the hives are the ones that may be cut off by a hostile seed; the rest must be there
        if (!["weir", "garden:0", "hive:0"].includes(key)) expect(st.ok, `seed ${seed}: ${key}`).toBe(true);
        else if (!st.ok) continue;
        expect(f.nav.distance(f.nav.index.get("plaza")!, i!), `seed ${seed}: ${key} is cut off from the plaza`).toBeLessThan(Infinity);
      }
    }
  });

  it("an empty world has no folk network to speak of but does not throw", () => {
    const empty = createArena(7);
    expect(() => buildFolk(empty, 3)).not.toThrow();
  });
});

describe("Hollowmere's folk: where they are", () => {
  it("nobody is ever inside a wall, a prop, a stall counter or the water, at any hour, dry or in a downpour, on any seed", () => {
    const pose = createVillagerPose();
    for (const seed of SEEDS) {
      const f = buildFolk(createArena(seed), seed);
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
      const f = buildFolk(createArena(seed), seed);
      for (const rain of [0, 1]) {
        for (let i = 0; i < f.roster.length; i++) {
          const v = f.roster[i]!;
          let worst = 0;
          let stood = 0;
          let walked = 0;
          const dh = 0.004; // ~0.4 s of daylight
          for (let h = 0; h < 24; h += dh) {
            villagerAt(f, i, clockAt(seed, h, 0, rain), a);
            villagerAt(f, i, clockAt(seed, h + dh, 0, rain), b);
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            const dark = h < 5.2 || h > 20.6;
            const dt = dh * (dark ? 32.9 : 98.5); // real seconds between the samples
            if (a.visible && b.visible) {
              worst = Math.max(worst, d / dt);
              expect(d / dt, `seed ${seed} rain ${rain}: ${v.name} jumps ${d.toFixed(2)} m at ${h.toFixed(3)} h (${a.act} -> ${b.act})`).toBeLessThan(3.4);
              expect(Math.abs(b.y - a.y), `${v.name} y jump at ${h.toFixed(3)}`).toBeLessThan(0.5);
              if (a.act === "walk") walked++;
              else stood++;
              if (a.act !== "walk" && b.act !== "walk") expect(d).toBeLessThan(1e-6);
            }
          }
          if (rain === 0) expect(walked, `${v.name} never walks`).toBeGreaterThan(5);
          if (rain === 0) expect(stood, `${v.name} never stands`).toBeGreaterThan(100);
          expect(worst).toBeLessThan(3.4);
        }
      }
    }
  }, 240_000);

  it("the weather moves them without a jump too: every person, over an hour of real time of a changing sky (rain comes and goes)", () => {
    const a = createVillagerPose();
    const b = createVillagerPose();
    const f = buildFolk(createArena(7), 7);
    let sawRain = false;
    for (const wseed of [7, 11, 23]) {
      const g = buildFolk(createArena(7), wseed);
      for (let i = 0; i < g.roster.length; i++) {
        for (let ms = 0; ms < 3_600_000; ms += 500) {
          const c1 = setFolkClock(createFolkClock(), wseed, ms, worldHours(9, ms, 30), 30);
          const c2 = setFolkClock(createFolkClock(), wseed, ms + 500, worldHours(9, ms + 500, 30), 30);
          villagerAt(g, i, c1, a);
          villagerAt(g, i, c2, b);
          if (a.rained) sawRain = true;
          if (a.visible && b.visible) {
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            expect(d / 0.5, `wseed ${wseed} ${g.roster[i]!.name} at ${(ms / 1000).toFixed(1)} s: ${a.act} -> ${b.act}`).toBeLessThan(3.4);
          }
        }
      }
    }
    expect(sawRain, "the test never saw a person rained off").toBe(true);
    expect(f.roster.length).toBeGreaterThan(0);
  }, 240_000);

  it("the village keeps human hours: mostly empty in the small hours (a watchman and the odd lamp), full at noon, thinning by bedtime", () => {
    const f = buildFolk(createArena(7), 7);
    const pose = createVillagerPose();
    const seen = (h: number): number => {
      let n = 0;
      for (let i = 0; i < f.roster.length; i++) {
        villagerAt(f, i, clockAt(7, h), pose);
        if (pose.visible) n++;
      }
      return n;
    };
    expect(seen(2.5)).toBeLessThanOrEqual(3);
    expect(seen(3.0)).toBeGreaterThanOrEqual(1); // the night watch keeps a lantern
    expect(seen(9.5)).toBeGreaterThanOrEqual(13);
    expect(seen(13)).toBeGreaterThanOrEqual(13);
    expect(seen(18.8)).toBeGreaterThanOrEqual(13);
    expect(seen(22.6)).toBeLessThanOrEqual(4);
  });

  it("rain sends people who work in the open under a roof or indoors; people already under one stay put", () => {
    const f = buildFolk(createArena(7), 7);
    const dry = createVillagerPose();
    const wet = createVillagerPose();
    let moved = 0;
    let visibleDry = 0;
    let visibleWet = 0;
    for (const h of [9.5, 11, 15.3, 16.5]) {
      for (let i = 0; i < f.roster.length; i++) {
        villagerAt(f, i, clockAt(7, h, 0, 0), dry);
        villagerAt(f, i, clockAt(7, h, 0, 1), wet);
        if (dry.visible) visibleDry++;
        if (wet.visible) visibleWet++;
        if (Math.hypot(dry.x - wet.x, dry.z - wet.z) > 1) moved++;
        if (wet.act !== "walk" && f.nav.stations[wet.station]!.sheltered && f.nav.stations[dry.station]!.sheltered && dry.station === wet.station) expect(Math.hypot(dry.x - wet.x, dry.z - wet.z)).toBeLessThan(1e-6);
      }
    }
    expect(moved).toBeGreaterThan(20);
    expect(visibleWet).toBeLessThan(visibleDry);
  });

  it("nobody stands in anybody: two people at work, idling or sheltering are never in one place, and only a seat is sat on (a bench's overflow stands)", () => {
    // (two gossips stood on one paving stone, two readers sat in one body on one bench seat, a crowd sheltered in one body under the hall's porch)
    for (const seed of [7, 42]) {
      const f = buildFolk(createArena(seed), seed);
      const poses = f.roster.map(() => createVillagerPose());
      for (const rain of [0, 1]) {
        let closest = Infinity;
        let where = "";
        for (let ms = 0; ms < (24 * 3600 * 1000) / 30; ms += 4000) {
          const c = clockAt(seed, (ms / 3_600_000) * 48, ms, rain);
          poses.forEach((p, i) => villagerAt(f, i, c, p));
          for (let i = 0; i < poses.length; i++) {
            const a = poses[i]!;
            if (!a.visible) continue;
            if (a.seated) expect(f.nav.stations[a.station]!.seat, `${f.roster[i]!.name} sits off a seat`).toBe(true);
            if (a.act === "walk") continue;
            for (let j = i + 1; j < poses.length; j++) {
              const b = poses[j]!;
              if (!b.visible || b.act === "walk") continue;
              const d = Math.hypot(a.x - b.x, a.z - b.z);
              if (d < closest) {
                closest = d;
                where = `${f.roster[i]!.name} (${a.act} at ${f.nav.stations[a.station]!.key}) and ${f.roster[j]!.name} (${b.act} at ${f.nav.stations[b.station]!.key}), ${d.toFixed(2)} m apart`;
              }
            }
          }
        }
        expect(closest, `seed ${seed} rain ${rain}: ${where}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  }, 240_000);

  it("friends who meet face each other, close enough to talk", () => {
    const f = buildFolk(createArena(7), 7);
    const p = createVillagerPose();
    const q = createVillagerPose();
    let pairs = 0;
    for (let i = 0; i < f.roster.length; i++) {
      for (let h = 8; h < 21; h += 0.05) {
        villagerAt(f, i, clockAt(7, h), p);
        if (p.act !== "chat" || p.partner < 0) continue;
        villagerAt(f, p.partner, clockAt(7, h), q);
        if (q.act !== "chat") continue;
        pairs++;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        expect(d, `${f.roster[i]!.name} and ${f.roster[p.partner]!.name} at ${h.toFixed(2)}`).toBeLessThan(2.4);
        // p's forward vector points roughly at q
        const fx = -Math.sin(p.facing);
        const fz = -Math.cos(p.facing);
        expect(((q.x - p.x) * fx + (q.z - p.z) * fz) / Math.max(d, 0.01)).toBeGreaterThan(0.5);
        expect(q.partner).toBe(i);
      }
    }
    expect(pairs).toBeGreaterThan(30);
  });

  it("the same clock gives the same people in the same places: pure, and cheap enough to run every frame", () => {
    const f = buildFolk(createArena(7), 7);
    const a = createVillagerPose();
    const b = createVillagerPose();
    const c = clockAt(7, 12.34, 12345);
    for (let i = 0; i < f.roster.length; i++) {
      villagerAt(f, i, c, a);
      villagerAt(f, i, clockAt(7, 12.34, 12345), b);
      expect(b).toEqual(a);
    }
    // warm (routes are built on first use), then time it
    for (let h = 0; h < 24; h += 0.05) for (let i = 0; i < f.roster.length; i++) villagerAt(f, i, clockAt(7, h), a);
    const t0 = performance.now();
    const clock = clockAt(7, 10);
    let n = 0;
    for (let r = 0; r < 200; r++) {
      clock.hours = 8 + (r % 100) * 0.1;
      for (let i = 0; i < f.roster.length; i++) {
        villagerAt(f, i, clock, a);
        n++;
      }
    }
    const perCall = ((performance.now() - t0) * 1000) / n;
    if (process.env.FOLK_STATS) process.stderr.write(`villagerAt: ${perCall.toFixed(2)} us per villager\n`);
    expect(perCall).toBeLessThan(40);
  });

  it("what they say is authored, kind and about institutions: deterministic, a few seconds long, never real nations, peoples or faiths", () => {
    const f = buildFolk(createArena(7), 7);
    const pose = createVillagerPose();
    const out: Speech = { text: "", u: 0 };
    const lines = new Set(allLines());
    const forbidden = /\b(jew|jewish|muslim|islam|christian|church|god|allah|hindu|buddh|catholic|chinese|african|indian|arab|american|english|french|german|russian|japanese|turk|mexican|irish|scottish|black|white people|asian)\w*/i;
    let spoken = 0;
    for (const l of lines) {
      expect(l.length).toBeLessThan(90);
      expect(forbidden.test(l), l).toBe(false);
    }
    for (let ws = 0; ws < 400; ws += 1) {
      for (let i = 0; i < f.roster.length; i++) {
        const v = f.roster[i]!;
        villagerAt(f, i, clockAt(7, 13, ws * 1000), pose);
        const s = villagerSays(v, pose, ws + 0.25, 13, 0, out);
        if (s) {
          spoken++;
          expect(lines.has(s.text), s.text).toBe(true);
          expect(s.u).toBeGreaterThanOrEqual(0);
          expect(s.u).toBeLessThanOrEqual(1);
          const again = villagerSays(v, pose, ws + 0.25, 13, 0, { text: "", u: 0 });
          expect(again?.text).toBe(s.text);
        }
      }
    }
    expect(spoken).toBeGreaterThan(100);
    // and the standing test agrees with the test-local one for a spot we know is fine
    const st = f.nav.stations[f.nav.index.get("plaza")!]!;
    expect(standingHeight(f.nav.world, st.x, st.z, st.y)).toBeDefined();
  });
});
