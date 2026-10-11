import type { CollisionWorld } from "./collision.ts";
import { lampsidePlan, stallKeeper, type LampsideHouse, type LampsideStall } from "./lampside.ts";
import { buildFolkFrom, type Appt, type CastDef, type Folk, type FolkSpec, type Meeting } from "./villagers.ts";
import { buildNavFrom, setFolkWater, type Nav, type NavTrail, type StationDef } from "./villagerNav.ts";

/**
 * LAMPSIDE'S PEOPLE (D-120): the Kessarine who live in the Ward's lower town under Kessar's fort (D-119). The same pure schedule as Hollowmere's folk (`villagerAt`:
 * every client computes the same people in the same places from the world clock; nothing simulated, nothing sent, nobody hit), on Lampside's own walking network and
 * stations: the street, the lanes between the houses and the alleys behind them, the garden paths; a back door to every house (the street doors are sealed to the Society,
 * in writing; the town comes and goes by its gardens), the stallkeepers behind their counters, the well, the nine lamps, the plots.
 *
 * Ten people: the Lamp-Trimmer who lives behind "GONE TO TRIM THE LAMPS. BACK AT DUSK" and does exactly that, at dusk and at first light; the brass-seller and the jar-seller
 * at the stalls; the water-carrier between the well and the back doors; a barley-keeper and a date-grower in the gardens; the Clerk of Chits at the street's end (the
 * notice on his house wants one); an elder; and two children. A Kessarine is named for their household's lamp ("Ossery of the Third Lamp"), never for anything real.
 */

/** Character facing that looks along (dx, dz) (0 = -Z), as villagerNav's. */
const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** A point in a house's or a stall's own frame (collision convention: local +x out of its front, local z along it). */
function at(b: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + c * lx - s * lz, z: b.z + s * lx + c * lz };
}

/** The town's footpaths (each line's vertices are x, z pairs): the street, the lanes between the houses into the west garden, the alleys behind the houses, the lane into the date grove, the garden paths. */
export const LAMPSIDE_TRAILS: readonly NavTrail[] = [
  { width: 6, line: [0, -2.5, 0, -6, 0, -10, 0, -14, 0, -18, 0, -22, 0, -26, 0, -28] },
  { width: 2.4, line: [-4.6, -11.7, -8, -11.7, -12, -11.7, -14.9, -11.7, -17.5, -11.7, -21, -11.7, -25, -11.7, -28, -11.7] },
  { width: 2.4, line: [-4.6, -20.6, -8, -20.6, -12, -20.6, -14.9, -20.6, -17.5, -20.6, -21, -20.6, -25, -20.6, -28, -20.6] },
  { width: 2.4, line: [-28, -6.8, -28, -11.7, -28, -16.5, -28, -20.6, -28, -25] },
  // (the alleys behind the houses are cut where the lanes cross them: a trail joins the others at its ends)
  { width: 2.2, line: [-14.9, -5, -14.9, -11.7] },
  { width: 2.2, line: [-14.9, -11.7, -14.9, -16.2, -14.9, -20.6] },
  { width: 2.2, line: [-14.9, -20.6, -14.9, -26.2] },
  { width: 2.2, line: [4.6, -10.9, 8, -10.9, 12, -10.9, 14.9, -10.9, 17.5, -10.9, 20, -11.4, 23.8, -11.4, 23.8, -7.5] },
  { width: 2.2, line: [14.9, -5, 14.9, -10.9] },
  { width: 2.2, line: [14.9, -10.9, 14.9, -15.4, 14.9, -19] },
  { width: 1.8, line: [23.8, -11.4, 23.8, -17, 27.5, -17] },
];

/** Open ground over the street and the square (people cross it, not only the paths). */
export const LAMPSIDE_GRID = { x0: -5, x1: 16, z0: -28, z1: -3, step: 2 } as const;

/** Which side of each stall its keeper comes in by (local z sign: the side toward the alley or the street). */
const STALL_SIDE: Readonly<Record<string, number>> = { "stall.e": -1, "stall.n": 1 };

/** The order the Lamp-Trimmer lights the nine lamps at dusk (and puts them out, the other way round, at first light): up the street, then the stalls. */
const LAMP_ORDER = ["post:0", "post:1", "w1", "e1", "w2", "e2", "w3", "stall.e", "stall.n"] as const;

/** Every station of the town, from the plan (ideals: `buildNavFrom` nudges each to free ground and drops what cannot be reached). */
export function lampsideStations(): StationDef[] {
  const plan = lampsidePlan();
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  const lamps = new Map<string, StationDef>();
  const houseLamp = (h: LampsideHouse): StationDef => {
    // (the lamp hangs 1.25 m along the street face from the door and 0.44 m out: the trimmer stands under it, a step further out, facing the wall)
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    return { key: "", x: h.x + c * (h.hx + 1.25) + s * -1.25, z: h.z + s * (h.hx + 1.25) - c * -1.25, facing: face(-c, -s), reach: 4 };
  };
  for (const h of plan.houses) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    // home: the back step in the alley, and just inside the back door (out of sight)
    const step = at(h, -(h.hx + 0.95), 0);
    add({ key: `step:${h.id}`, x: step.x, z: step.z, facing: face(-c, -s), reach: 4 });
    const door = at(h, -(h.hx + 0.3), 0);
    add({ key: `in:${h.id}`, x: door.x, z: door.z, facing: face(c, s), hidden: true, sheltered: true, parent: `step:${h.id}` });
    // against the street face beside the door (on the side away from its lamp), looking at the street; under the awning, where there is one
    const lean = at(h, h.hx + 0.35, -1.6);
    add({ key: `lean:${h.id}`, x: lean.x, z: lean.z, facing: face(c, s), reach: 4 });
    if (h.awning) {
      const a = at(h, h.hx + 0.6, 0);
      add({ key: `awning:${h.id}`, x: a.x, z: a.z, facing: face(c, s), sheltered: true, reach: 4 });
    }
    lamps.set(h.id, houseLamp(h));
  }
  for (const st of plan.stalls) {
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    const k = stallKeeper(st);
    const side = STALL_SIDE[st.id] ?? 1;
    const keep = at(st, k, 0);
    const way = at(st, k, side * (st.hz + 0.7));
    add({ key: `stall:${stallKey(st)}`, x: keep.x, z: keep.z, facing: face(c, s), sheltered: true, via: [[way.x, way.z]], reach: 6 });
    const front = at(st, st.hx + 0.95, 0);
    add({ key: `front:${stallKey(st)}`, x: front.x, z: front.z, facing: face(-c, -s), reach: 5 });
    // its lamp hangs at the front corner (local z -1.23 in the collision frame): the trimmer stands before it
    const lamp = at(st, st.hx + 1.0, -1.23);
    lamps.set(st.id, { key: "", x: lamp.x, z: lamp.z, facing: face(-c, -s), reach: 5 });
  }
  plan.posts.forEach((p, i) => {
    // (each post's bracket reaches over the street: stand under the lamp's far side, facing the post)
    const dir = p.x < 0 ? 1 : -1;
    lamps.set(`post:${i}`, { key: "", x: p.x + dir * 0.9, z: p.z, facing: face(-dir, 0), reach: 4 });
  });
  LAMP_ORDER.forEach((id, i) => add({ ...lamps.get(id)!, key: `lamp:${i}` }));
  // the well: one each side
  const w = plan.well;
  add({ key: "well", x: w.x - (w.r + 0.5), z: w.z, facing: face(1, 0), reach: 5 });
  add({ key: "well:b", x: w.x + (w.r + 0.5), z: w.z, facing: face(-1, 0), reach: 5 });
  // the gardens: a place in each plot
  add({ key: "garden:w:a", x: -31.5, z: -13.5, facing: face(-1, 0), reach: 5 });
  add({ key: "garden:w:b", x: -24.5, z: -18, facing: face(1, 0), reach: 5 });
  add({ key: "garden:e:a", x: 23.8, z: -15.6, facing: face(0, -1), reach: 5 });
  add({ key: "garden:e:b", x: 29, z: -11.4, facing: face(1, 0), reach: 7 });
  // the Clerk of Chits' place at the street's end, facing whoever comes up from the bar
  add({ key: "chits", x: 5.4, z: -4.9, facing: face(0, 1), reach: 4 });
  // where children play: the square's corner by the street, and the street itself
  add({ key: "play:sq", x: 7, z: -24.6, facing: face(1, 0), reach: 5 });
  add({ key: "play:st", x: -1.6, z: -17.5, facing: face(0, 1), reach: 4 });
  // conversation spots: pairs a metre apart facing each other
  for (const [i, c] of ([[-2.2, -12.4, 0.2], [8, -21.2, 0.6], [2.2, -21.8, 1.3], [-28, -14, 1.57], [2.4, -6, 0.3]] as const).entries()) {
    const [cx, cz, a] = c;
    const ux = Math.cos(a) * 0.55;
    const uz = Math.sin(a) * 0.55;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: face(ux, uz), reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: face(-ux, -uz), reach: 5 });
  }
  return out;
}

const stallKey = (s: LampsideStall): string => s.id.replace("stall.", "");

/** Lampside's walking network in a Kessar world (its water is the river and the sea, not Hollowmere's stream: `setFolkWater`). */
export function lampsideNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  setFolkWater(world, (x, z) => (t.waterDepth?.(x, z) ?? 0) > 0.02);
  return buildNavFrom(world, { trails: LAMPSIDE_TRAILS, grid: LAMPSIDE_GRID, stations: lampsideStations() }, why);
}

// ---- the cast ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The Lamp-Trimmer's rounds, up the street from the bar to the stalls: the nine lamps put out at first light and lit at dusk, a fifth of an hour each (the farthest
 * two are seventeen metres apart: a walk and a trim), then home by the back door.
 */
function trimmerScript(script: Appt[]): Appt[] {
  const out = script.slice();
  const n = LAMP_ORDER.length;
  for (let i = 0; i < n; i++) out.push([5.7 + i * 0.22, `lamp:${i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  for (let i = 0; i < n; i++) out.push([18.0 + i * 0.22, `lamp:${i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  out.push([20.1, "step:w1", "idle"], [20.45, "in:w1", "sleep"]);
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry is the morning at the back door, the last is bed.
 * Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed.
 */
const CAST: readonly CastDef[] = [
  { key: "trimmer", title: "Lamp-Trimmer", occupation: "lamplighter", age: "adult", home: "w1", lines: "kLamp", archetype: 1, script: [
    [5.4, "step:w1", "idle", { carry: "lantern" }], [7.9, "awning:w1|lean:w1", "lean"], [9.0, "front:n", "idle"], [9.6, "awning:w1|lean:w1", "lean"], [14.0, "well", "draw", { to: "step:w1", actTo: "idle", carryOut: "bucket" }], [16.4, "awning:w1|lean:w1", "lean"],
  ] },
  { key: "brass", title: "Brass-Seller", occupation: "seller", age: "adult", home: "e2", lines: "kSeller", archetype: 3, script: [
    [6.6, "step:e2", "idle"], [7.0, "stall:e", "sell", { carryIn: "crate" }], [12.2, "awning:e2|lean:e2", "lean"], [13.2, "stall:e", "sell"], [18.4, "step:e2", "idle"], [19.3, "in:e2", "sleep"],
  ] },
  { key: "jars", title: "Jar-Seller", occupation: "seller", age: "adult", home: "e1", lines: "kSeller", archetype: 0, script: [
    [6.8, "step:e1", "idle"], [7.3, "stall:n", "sell", { carryIn: "basket" }], [13.4, "stall:n", "sell"], [18.6, "step:e1", "idle"], [19.5, "in:e1", "sleep"],
  ] },
  { key: "gardenW", title: "Barley-Keeper", occupation: "gardener", age: "adult", home: "w2", lines: "kGarden", archetype: 4, script: [
    [6.0, "step:w2", "idle"], [6.4, "garden:w:a", "tend"], [9.8, "garden:w:b", "tend"], [13.0, "garden:w:a", "tend"], [16.8, "well", "draw", { to: "garden:w:b", actTo: "tend", carryOut: "bucket" }], [18.6, "step:w2", "idle"], [19.2, "in:w2", "sleep"],
  ] },
  { key: "water", title: "Water-Carrier", occupation: "laundress", age: "adult", home: "w3", lines: "kWater", archetype: 2, script: [
    [6.2, "step:w3", "idle"], [6.6, "well", "draw", { to: "step:w2", actTo: "idle", carryOut: "bucket" }], [9.0, "well:b", "draw", { to: "step:e1", actTo: "idle", carryOut: "bucket" }], [12.0, "lean:w3", "lean"], [13.0, "well", "draw", { to: "step:e2", actTo: "idle", carryOut: "bucket" }], [16.0, "well:b", "draw", { to: "step:w1", actTo: "idle", carryOut: "bucket" }], [18.8, "step:w3", "idle"], [19.4, "in:w3", "sleep"],
  ] },
  { key: "clerk", title: "Clerk of Chits", occupation: "registrar", age: "adult", home: "w2", lines: "kClerk", archetype: 5, script: [
    [7.0, "step:w2", "idle"], [7.6, "chits", "write", { carry: "book" }], [12.3, "lean:w2", "write", { carry: "book" }], [13.4, "chits", "write", { carry: "book" }], [17.0, "front:e", "idle"], [18.0, "step:w2", "idle"], [19.6, "in:w2", "sleep"],
  ] },
  { key: "gardenE", title: "Date-Grower", occupation: "gardener", age: "adult", home: "e1", lines: "kGarden", archetype: 4, script: [
    [6.2, "step:e1", "idle"], [6.7, "garden:e:a", "tend"], [10.2, "garden:e:b", "tend"], [13.2, "garden:e:a", "tend"], [16.5, "garden:e:b", "tend"], [18.4, "step:e1", "idle"], [19.0, "in:e1", "sleep"],
  ] },
  { key: "elder", title: "Lamp-Elder", occupation: "elder", age: "elder", home: "w3", lines: "kElder", archetype: 5, walk: 0.7, script: [
    [8.0, "step:w3", "idle"], [8.5, "lean:w3", "lean"], [12.4, "lean:w3", "lean"], [16.5, "lean:w3", "lean"], [19.0, "step:w3", "idle"], [19.5, "in:w3", "sleep"],
  ] },
  { key: "tamsel", title: "Tamsel", occupation: "child", age: "child", home: "e2", lines: "kChild", scale: 0.68, walk: 1.5, archetype: 3, script: [
    [7.8, "step:e2", "play"], [8.4, "play:sq", "play", { to: "play:st", actTo: "play" }], [12.4, "step:e2", "idle"], [13.4, "play:sq", "play", { to: "well:b", actTo: "play" }], [17.5, "step:e2", "play"], [19.2, "in:e2", "sleep"],
  ] },
  { key: "embry", title: "Embry", occupation: "child", age: "child", home: "w1", lines: "kChild", scale: 0.72, walk: 1.5, archetype: 2, script: [
    [8.0, "step:w1", "play"], [8.6, "play:st", "play", { to: "play:sq", actTo: "play" }], [12.5, "step:w1", "idle"], [13.5, "play:st", "play", { to: "chits", actTo: "play" }], [17.6, "step:w1", "play"], [19.4, "in:w1", "sleep"],
  ] },
];

/** Talking events at the conversation spots. */
const MEETINGS: readonly Meeting[] = [
  { at: 12.1, dur: 0.9, spot: 3, a: "gardenW", b: "gardenE" },
  { at: 12.6, dur: 0.8, spot: 0, a: "trimmer", b: "clerk" },
  { at: 15.2, dur: 0.9, spot: 1, a: "jars", b: "elder" },
  { at: 17.2, dur: 0.8, spot: 2, a: "water", b: "brass" },
];

/** Invented given names (no real language's); a person is named for their household's lamp. */
const FIRSTS = ["Ossery", "Talveth", "Sabrel", "Orrel", "Hestry", "Vennet", "Ilbry", "Quorrin", "Tavick", "Pellis", "Orvane", "Tullen", "Yarrel", "Sennick", "Abrith", "Morvel"];
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];
/** Each house's lamp, by the plan's order of the houses. */
const lampOf = (home: string): string => ORDINALS[Math.max(0, lampsidePlan().houses.findIndex((h) => h.id === home))] ?? ORDINALS[0]!;

export const LAMPSIDE_FOLK: FolkSpec = {
  id: "lampside",
  salt: 0x1a3b5,
  lookSalt: 0x1a3b5,
  cast: CAST,
  meetings: MEETINGS,
  firsts: FIRSTS,
  lasts: ORDINALS,
  roofs: ["stall:e", "stall:n", "awning:w1", "awning:e2"],
  // (children, the elder, the gardeners and the trimmer go home when it rains; the rest stand under the stalls' and the doors' awnings)
  indoors: (v) => v.age !== "adult" || v.occupation === "gardener" || v.occupation === "lamplighter",
  name: (c, i, firsts) => `${c.age === "child" ? c.title : firsts[i % firsts.length]!} of the ${lampOf(c.home)} Lamp`,
  script: (c, script) => (c.key === "trimmer" ? trimmerScript(script) : script),
  people: "kessarine",
  nav: (world) => lampsideNav(world),
};

/** Lampside's people for a Kessar world and its seed: deterministic in both, built once and cached. */
export function buildLampsideFolk(world: CollisionWorld, seed: number): Folk {
  return buildFolkFrom(world, seed, LAMPSIDE_FOLK);
}

/** The lamps the Lamp-Trimmer tends (every lamp of the town). */
export const LAMPSIDE_FOLK_LAMPS = LAMP_ORDER.length;
