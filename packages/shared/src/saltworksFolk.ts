import type { CollisionWorld } from "./collision.ts";
import { SALTMARKET } from "./saltmarket.ts";
import { SALTWORKS, saltworksPlan, type SaltHut } from "./saltworks.ts";
import { buildFolkFrom, type CastDef, type Folk, type FolkSpec, type Meeting } from "./villagers.ts";
import { buildNavFrom, setFolkWater, type Nav, type NavTrail, type StationDef } from "./villagerNav.ts";

/**
 * THE BRINEFOLK AT THE PANS (D-123): the people who work the Brine Houses' salt works (D-121), on the same pure schedule as Hollowmere's folk and Lampside's (`villagerAt`:
 * every client computes the same people in the same places from the world clock; nothing simulated, nothing sent, nobody hit; D-122's fright works on them as on the others).
 * They live in the rakers' row between the yard and the Customs Cut and go in by the low doors at the back; by day the Pump-Keeper minds the pump and the sluices, two rakers work
 * the raked pans between the windrows, the barrow-man carts the lifted pan's salt to the heaps, the crust-skimmer works the crystallisers, the Tally-Keeper counts the heaps for the
 * Houses, an elder holds court at the hut fronts and a child walks the bunds. Rain stops the work: everybody goes in. A Brinefolk is named for the lot they were born on.
 */

const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const L = SALTMARKET.level;
const BUND = L + SALTWORKS.bund.height;

/** A point in a hut's own frame (collision convention: local +x out of its front, to the yard; local z along it). */
function at(h: SaltHut, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  return { x: h.x + c * lx - s * lz, z: h.z + s * lx + c * lz };
}

const ROW_FRONT = 77.7;
const ROW_BACK = 82.9;
const TOWPATH = 26.8;
const YARD = 67.95;

/** The works' paths: the front lane before the huts, the back lane behind them (to their doors), the west end round the first hut, the towpath along the Long Cut and the barrow way under the pans. */
export const SALTWORKS_TRAILS: readonly NavTrail[] = [
  { width: 1.6, line: [5.4, ROW_FRONT, 9, ROW_FRONT, 13, ROW_FRONT, 17, ROW_FRONT, 21, ROW_FRONT, TOWPATH, ROW_FRONT] },
  { width: 1.3, line: [5.4, ROW_BACK, 9, ROW_BACK, 13, ROW_BACK, 17, ROW_BACK, 21, ROW_BACK, TOWPATH, ROW_BACK] },
  { width: 1.2, line: [5.4, ROW_FRONT, 5.4, 80.3, 5.4, ROW_BACK] },
  { width: 1.6, line: [TOWPATH, 15.5, TOWPATH, 22, TOWPATH, 30, TOWPATH, 40, TOWPATH, 50, TOWPATH, 60, TOWPATH, YARD, TOWPATH, ROW_FRONT] },
  { width: 1.2, line: [TOWPATH, ROW_FRONT, TOWPATH, 80.3, TOWPATH, ROW_BACK] },
  { width: 1.4, line: [3.6, YARD, 8, YARD, 12, YARD, 16, YARD, 20, YARD, 24, YARD, TOWPATH, YARD] },
];

/** Open ground over the pans and the yard (people cross the bunds and the brine, not only the paths). */
export const SALTWORKS_GRID = { x0: 3, x1: 27, z0: 15, z1: 83, step: 2 } as const;

/** Every station of the works, from the plan (ideals: `buildNavFrom` nudges each to free ground and drops what cannot be reached). */
export function saltworksStations(): StationDef[] {
  const plan = saltworksPlan();
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  for (const h of plan.huts) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    // home: the step at the back door (on the cut side) and just inside it (out of sight); the front wall to lean on, looking at the yard
    const step = at(h, -(h.hx + 0.95), 0);
    add({ key: `step:${h.id}`, x: step.x, z: step.z, facing: face(-c, -s), reach: 4 });
    const door = at(h, -(h.hx + 0.3), 0);
    add({ key: `in:${h.id}`, x: door.x, z: door.z, facing: face(c, s), hidden: true, sheltered: true, parent: `step:${h.id}` });
    const lean = at(h, h.hx + 0.45, -1.0);   // (a shoulder's width out from the wall: the head clear of the eave's thatch)
    add({ key: `lean:${h.id}`, x: lean.x, z: lean.z, facing: face(c, s), reach: 4 });
  }
  // the pump, from the north side of its corner, looking up at the wheel
  const p = plan.pump;
  add({ key: "pump", x: p.x + 1.5, z: p.z - 1.7, facing: face(-1.5, 1.7), reach: 5 });
  // each sluice, from the bund a step east of its gate
  plan.sluices.forEach((sl, i) => add({ key: `sluice:${i}`, x: sl.x + 1.0, z: sl.z, y: BUND, facing: face(-1, 0), reach: 6 }));
  // the raked pans: between the windrows, in by the clear strip at the pan's west end (nobody walks on the raked salt)
  const raked = plan.pans.filter((q) => q.state === "raked");
  const rows = plan.rows;
  raked.forEach((q, k) => {
    const zs = rows.filter((r) => r.x === (q.x0 + q.x1) / 2).map((r) => r.z).sort((a, b) => a - b);
    const gaps = zs.slice(1).map((z, i) => (z + zs[i]!) / 2);
    const side = k === 0 ? "w" : "e";
    for (const [j, g] of [[0, gaps[1]!], [1, gaps[2]!]] as const) {
      add({ key: `rake:${side}:${j === 0 ? "a" : "b"}`, x: q.x0 + 1.9 + j * 2.1, z: g, facing: face(1, 0), via: [[q.x0 + 0.3, g]], reach: 7 });
    }
  });
  // the lifted pan (where the barrow is loaded) and the crystallisers (where the crust is skimmed)
  const lifted = plan.pans.find((q) => q.state === "lifted")!;
  add({ key: "lift", x: (lifted.x0 + lifted.x1) / 2, z: (lifted.z0 + lifted.z1) / 2, facing: face(0, 1), reach: 5 });
  plan.pans.filter((q) => q.state === "crust").forEach((q, i) => add({ key: `skim:${"abc"[i]}`, x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, facing: face(0, -1), reach: 5 }));
  // the heaps: at each one's north foot, on the barrow way, looking at it
  plan.heaps.forEach((h, i) => add({ key: `heap:${i}`, x: h.x, z: h.z - h.r - 0.6, facing: face(0, 1), reach: 5 }));
  // the Tally-Keeper's place on the front lane, facing the heaps; where the child plays (the yard, a bund top)
  add({ key: "tally", x: 15.6, z: ROW_FRONT - 0.2, facing: face(0, -1), reach: 4 });
  add({ key: "play:yard", x: 14.4, z: YARD + 0.3, facing: face(1, 0), reach: 5 });
  add({ key: "play:bund", x: 10.4, z: 39, y: BUND, facing: face(0, -1), reach: 6 });
  // conversation spots: pairs a metre apart facing each other (the front lane twice, the towpath)
  for (const [i, c] of ([[11.2, ROW_FRONT + 0.1, 0], [21.6, ROW_FRONT + 0.1, 0], [TOWPATH, 44, 1.57]] as const).entries()) {
    const [cx, cz, a] = c;
    const ux = Math.cos(a) * 0.55;
    const uz = Math.sin(a) * 0.55;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: face(ux, uz), reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: face(-ux, -uz), reach: 5 });
  }
  return out;
}

/** The works' walking network in a Saltmarket world (its water is the delta's channels: `setFolkWater`; a pan's brine is a sheet, waded). */
export function saltworksNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  setFolkWater(world, (x, z) => (t.waterDepth?.(x, z) ?? 0) > 0.02);
  return buildNavFrom(world, { trails: SALTWORKS_TRAILS, grid: SALTWORKS_GRID, stations: saltworksStations() }, why);
}

// ---- the cast ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry is the morning at the back door, the last is bed.
 * Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed.
 */
const CAST: readonly CastDef[] = [
  { key: "rakerW", title: "Raker", occupation: "gardener", age: "adult", home: "hut0", lines: "bRaker", archetype: 4, script: [
    [5.8, "step:hut0", "idle"], [6.2, "rake:w:a", "sweep"], [9.5, "rake:w:b", "sweep"], [12.2, "lean:hut0", "lean"], [13.2, "rake:w:a", "sweep"], [16.5, "rake:w:b", "sweep"], [18.9, "step:hut0", "idle"], [19.5, "in:hut0", "sleep"],
  ] },
  { key: "pump", title: "Pump-Keeper", occupation: "keeper", age: "adult", home: "hut3", lines: "bPump", archetype: 2, script: [
    [5.6, "step:hut3", "idle"], [6.0, "pump", "lookup"], [8.0, "sluice:0", "tend", { to: "sluice:1", actTo: "tend" }], [11.0, "pump", "lookup"], [12.3, "lean:hut3", "lean"], [13.2, "sluice:2", "tend", { to: "sluice:3", actTo: "tend" }], [16.0, "pump", "lookup"], [17.4, "sluice:4", "tend"], [18.8, "step:hut3", "idle"], [19.4, "in:hut3", "sleep"],
  ] },
  { key: "barrow", title: "Barrow-Man", occupation: "miller", age: "adult", home: "hut1", lines: "bBarrow", archetype: 0, script: [
    [6.4, "step:hut1", "idle"], [6.8, "lift", "sack", { to: "heap:1", actTo: "sack", carryOut: "sack" }], [12.2, "lean:hut1", "lean"], [13.2, "lift", "sack", { to: "heap:3", actTo: "sack", carryOut: "sack" }], [18.4, "step:hut1", "idle"], [19.2, "in:hut1", "sleep"],
  ] },
  { key: "tally", title: "Tally-Keeper", occupation: "registrar", age: "adult", home: "hut1", lines: "bTally", archetype: 5, script: [
    [7.2, "step:hut1", "idle"], [7.6, "tally", "write", { carry: "book" }], [10.5, "heap:0", "write", { carry: "book" }], [11.5, "heap:2", "write", { carry: "book" }], [12.6, "tally", "write", { carry: "book" }], [15.0, "heap:3", "write", { carry: "book" }], [16.2, "heap:1", "write", { carry: "book" }], [17.5, "tally", "write", { carry: "book" }], [18.9, "step:hut1", "idle"], [19.6, "in:hut1", "sleep"],
  ] },
  { key: "rakerE", title: "Raker", occupation: "gardener", age: "adult", home: "hut2", lines: "bRaker", archetype: 3, script: [
    [6.0, "step:hut2", "idle"], [6.4, "rake:e:a", "sweep"], [9.8, "rake:e:b", "sweep"], [12.4, "lean:hut2", "lean"], [13.4, "rake:e:b", "sweep"], [16.8, "rake:e:a", "sweep"], [19.0, "step:hut2", "idle"], [19.6, "in:hut2", "sleep"],
  ] },
  { key: "skimmer", title: "Crust-Skimmer", occupation: "laundress", age: "adult", home: "hut2", lines: "bSkim", archetype: 1, script: [
    [6.6, "step:hut2", "idle"], [7.0, "skim:a", "tend"], [10.0, "skim:b", "tend"], [13.4, "skim:c", "tend"], [16.4, "skim:a", "tend"], [18.6, "step:hut2", "idle"], [19.3, "in:hut2", "sleep"],
  ] },
  { key: "elder", title: "Elder of the Pans", occupation: "elder", age: "elder", home: "hut0", lines: "bElder", archetype: 5, walk: 0.7, script: [
    [8.0, "step:hut0", "idle"], [8.4, "lean:hut0", "lean"], [12.5, "lean:hut1", "lean"], [16.0, "lean:hut0", "lean"], [19.0, "step:hut0", "idle"], [19.5, "in:hut0", "sleep"],
  ] },
  { key: "child", title: "Wick", occupation: "child", age: "child", home: "hut3", lines: "bChild", scale: 0.7, walk: 1.5, archetype: 3, script: [
    [7.8, "step:hut3", "play"], [8.3, "play:yard", "play", { to: "play:bund", actTo: "play" }], [12.4, "step:hut3", "idle"], [13.4, "play:bund", "play", { to: "play:yard", actTo: "play" }], [17.6, "step:hut3", "play"], [19.2, "in:hut3", "sleep"],
  ] },
];

/** Talking events at the conversation spots. */
const MEETINGS: readonly Meeting[] = [
  { at: 12.3, dur: 0.8, spot: 0, a: "rakerW", b: "rakerE" },
  { at: 15.6, dur: 0.8, spot: 1, a: "barrow", b: "tally" },
  { at: 17.9, dur: 0.7, spot: 2, a: "pump", b: "skimmer" },
];

/** Invented given names (no real language's); a Brinefolk is named for the lot they were born on. */
const FIRSTS = ["Ombry", "Teskel", "Varra", "Quillet", "Hobbe", "Saffin", "Merrow", "Nettick", "Olvey", "Dimmock", "Wenlo", "Tarrow"];
const LOTS = ["Three", "Five", "Seven", "Nine", "Eleven", "Twelve", "Fourteen", "Sixteen"];

export const SALTWORKS_FOLK: FolkSpec = {
  id: "saltworks",
  salt: 0x5a17f0,
  lookSalt: 0x5a17f0,
  cast: CAST,
  meetings: MEETINGS,
  firsts: FIRSTS,
  lasts: LOTS,
  roofs: [],
  // (rain stops the work: everybody goes in)
  indoors: () => true,
  name: (c, i, firsts, lasts) => (c.age === "child" ? `${c.title} of Lot ${lasts[(i * 3 + 1) % lasts.length]!}` : `${firsts[i % firsts.length]!} of Lot ${lasts[i % lasts.length]!}`),
  people: "brinefolk",
  nav: (world) => saltworksNav(world),
};

/** The Brinefolk at the pans, for a Saltmarket world and its seed: deterministic in both, built once and cached. */
export function buildSaltworksFolk(world: CollisionWorld, seed: number): Folk {
  return buildFolkFrom(world, seed, SALTWORKS_FOLK);
}
