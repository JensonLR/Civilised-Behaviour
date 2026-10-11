import type { CollisionWorld } from "./collision.ts";
import { HIGHMARK, highmarkPlan, highmarkRoad, hillPoint, type HighmarkBox } from "./highmark.ts";
import { buildFolkFrom, type CastDef, type Folk, type FolkSpec, type Meeting } from "./villagers.ts";
import { buildNavFrom, setFolkHeadroom, setFolkWater, type Nav, type NavTrail, type StationDef } from "./villagerNav.ts";

/**
 * THE MARCHERS OF THE CAPITAL (D-124): the people of Highmark's hill-capital, on the same pure schedule as Hollowmere's folk, Lampside's and the Brinefolk's
 * (`villagerAt`: every client computes the same people in the same places from the world clock; nothing simulated, nothing sent, nobody hit; D-122's fright works on
 * them as on the others). The capital was built and nobody lived in it: five stocked stalls with no one behind them, a court before a boarded palace with no one waiting.
 *
 * Twelve people. On the market terrace four stallkeepers sell cheese, loaves, hides and grain; the Town Crier rings his bell from behind the fifth stall (it has no licence,
 * so it is his) and at either end of the market; the water-carrier takes buckets from the well to the stalls. On the granary terrace the Granary-Reeve counts the three
 * granaries with a book and a porter carries sacks between them (the Chamberlain likes them level). On the court terrace an Under-Clerk goes from one of the Chamberlain's
 * offices to the next with notices, and two petitioners wait all day at the sealed door of his office (one has waited so long they gave her a room in it). A child plays on
 * the guild terrace and in the market. They lodge in three of the sealed halls and come and go by back doors on the halls' inward faces (the sealed fronts stay sealed).
 * Rain sends the court's people, the elder and the child in; the market's people stand it out under the stalls' awnings and the granary pair in the lee of the
 * granaries. A Marcher is named for the ring of the hill they lodge on.
 * They keep off the plateau and away from every story point (the succession's claimants, the Chamberlain and his guards, the Grange's delegates, the envoy).
 */

/** Character facing that looks along (dx, dz) (0 = -Z), as villagerNav's. */
const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** A point in a hall's or a stall's own frame (collision convention: local +x along it, local +z out of its face: a stall's front, a sealed hall's door). */
function at(b: HighmarkBox, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + c * lx - s * lz, z: b.z + s * lx + c * lz };
}

/** The sealed halls the Marchers lodge in (the assay office on the guild terrace; two of the Chamberlain's offices on the court terrace), and the ring each is on. */
export const MARCHER_HOMES: readonly { hall: number; ring: string }[] = [
  { hall: 1, ring: "Third" },
  { hall: 2, ring: "Fourth" },
  { hall: 3, ring: "Fourth" },
];
/** The Chamberlain's offices the Under-Clerk posts notices at. */
const OFFICES = [2, 3, 4] as const;
/** The granaries' bearings on the hill (the plan's). */
const GRANARY_DEG = [-45, -58, -71] as const;

/** A polyline cut into links of at most two metres (a trail's nodes). */
function cut(pts: readonly { x: number; z: number }[]): number[] {
  const line: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const q = pts[i - 1]!;
      const n = Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / 2);
      for (let k = 1; k < n; k++) line.push(q.x + ((p.x - q.x) * k) / n, q.z + ((p.z - q.z) * k) / n);
    }
    line.push(p.x, p.z);
  }
  return line;
}

/** The Processional Road from the quay's foot over the hill to the court (D-128: the whole of it, the plain too: the Grange's hands walk it to the fields). */
function roadTrail(): NavTrail {
  const L = highmarkPlan().quay;
  return { width: HIGHMARK.rampHalf * 2, line: cut([{ x: L.x, z: L.z0 - 1.4 }, ...highmarkRoad()]) };
}

/**
 * D-128: the quay's deck (at the planks' height, over the river: `NavTrail.y`) from its foot to the barge, and the field paths: from the road into each worked field
 * the Grange's hands work, threaded between its haycocks, stooks and scarecrow.
 */
function plainTrails(): NavTrail[] {
  const q = highmarkPlan().quay;
  const deck: NavTrail = { width: q.half * 2, y: HIGHMARK.level, line: cut([{ x: q.x, z: q.z0 - 0.9 }, { x: q.x, z: q.z1 - 0.6 }]) };
  const path = (pts: { x: number; z: number }[]): NavTrail => ({ width: 1.6, line: cut(pts) });
  const roadAt = (z: number): { x: number; z: number } => {
    const r = highmarkRoad();
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i]!, b = r[i + 1]!;
      if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) return { x: a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z), z };
    }
    return { x: 0, z };
  };
  return [
    deck,
    path([roadAt(78), { x: -19, z: 78 }, { x: -19, z: 90 }]),   // the hay (west): between its haycocks
    path([roadAt(66), { x: 25, z: 66 }]),   // the stubble (east): between its rows of stooks
    path([roadAt(2), { x: 30, z: 2 }]),   // the plough (east)
    path([roadAt(13.5), { x: -27, z: 13.5 }]),   // the young green (west): north of its scarecrow
  ];
}

/** Open ground over the whole hill (its terraces are joined only by the road's ramps, and the gate's passage): people cross a terrace, not only walk the road. */
export const MARCHER_GRID = { x0: -74, x1: 74, z0: -170, z1: -22, step: 2 } as const;

/** Every station of the capital's people, from the plan (ideals: `buildNavFrom` nudges each to free ground and drops what cannot be reached). */
export function marcherStations(): StationDef[] {
  const plan = highmarkPlan();
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  const ring = (r: number, deg: number, key: string, facing: number, reach = 5): void => {
    const p = hillPoint(r, deg);
    add({ key, x: p.x, z: p.z, facing, reach });
  };
  // homes: the step at each lodging hall's back door (on its inward face, away from the sealed front) and just inside it (out of sight)
  for (const { hall } of MARCHER_HOMES) {
    const h = plan.halls[hall]!;
    const s = Math.sin(h.yaw), c = Math.cos(h.yaw);
    const step = at(h, 0, -(h.hz + 1.65));   // (a stride and more out from the wall: the lodgers who come home together stand in two rows, not on one another)
    add({ key: `step:hall${hall}`, x: step.x, z: step.z, facing: face(s, -c), sheltered: true, reach: 5 });   // (under the eave: rain at the door is waited out there, not walked off to an awning)
    const door = at(h, 0, -(h.hz + 0.3));
    add({ key: `in:hall${hall}`, x: door.x, z: door.z, facing: face(-s, c), hidden: true, sheltered: true, parent: `step:hall${hall}` });
  }
  // the Chamberlain's offices: before each sealed door (the Under-Clerk's notices), and the two places either side of his own office's door where the petitioners wait
  for (const i of OFFICES) {
    const h = plan.halls[i]!;
    const s = Math.sin(h.yaw), c = Math.cos(h.yaw);
    const p = at(h, 0, h.hz + 1.1);
    add({ key: `office:hall${i}`, x: p.x, z: p.z, facing: face(s, -c), reach: 5 });
  }
  {
    const h = plan.halls[2]!;
    const s = Math.sin(h.yaw), c = Math.cos(h.yaw);
    for (const [k, lx] of [["a", -1.7], ["b", 1.7]] as const) {
      const p = at(h, lx, h.hz + 1.3);
      add({ key: `petition:${k}`, x: p.x, z: p.z, facing: face(s, -c), reach: 5 });
    }
  }
  // the stalls: the keeper behind the counter (in round the end of the stall: the strip between the counter and the guild terrace's wall), a customer before it
  plan.stalls.forEach((st, i) => {
    const s = Math.sin(st.yaw), c = Math.cos(st.yaw);
    const keep = at(st, 0, -1.3);
    const way = at(st, (i % 2 ? 1 : -1) * (st.hx + 0.8), -1.3);
    add({ key: `stall:${i}`, x: keep.x, z: keep.z, facing: face(-s, c), sheltered: true, via: [[way.x, way.z]], reach: 6 });
    const front = at(st, 0, st.hz + 0.9);
    add({ key: `front:${i}`, x: front.x, z: front.z, facing: face(s, -c), reach: 5 });
  });
  // the crier's corners at either end of the market, facing along it
  {
    const w = hillPoint(56, -32), e = hillPoint(56, 32);
    add({ key: "cry:west", x: w.x, z: w.z, facing: face(Math.cos(w.th), -Math.sin(w.th)), reach: 5 });
    add({ key: "cry:east", x: e.x, z: e.z, facing: face(-Math.cos(e.th), Math.sin(e.th)), reach: 5 });
  }
  // the well (one each side of it, along the terrace)
  const wl = plan.well;
  for (const [k, d] of [["a", -2.9], ["b", 2.9]] as const) {
    const p = hillPoint(54, 55 + d);
    add({ key: `well:${k}`, x: p.x, z: p.z, facing: face(wl.x - p.x, wl.z - p.z), reach: 5 });
  }
  // the granaries: on each one's west side (the east of the first is where the Reapers' Strike sets its scale), facing its door-less flank (the hatch is up the ladder)
  plan.granaries.forEach((g, i) => {
    const p = hillPoint(66, GRANARY_DEG[i]! - 4.4);
    add({ key: `granary:${i}`, x: p.x, z: p.z, facing: face(g.x - p.x, g.z - p.z), sheltered: true, reach: 5 });   // (in the lee of its cone: the granary pair work through the rain)
  });
  // where the child plays: the guild terrace by the market ramp's head, the ramp's head itself, the middle of the market
  ring(45, -52, "play:guild", face(1, 0));
  ring(47, -40, "play:ramp", face(0, 1));
  ring(56, -8, "play:market", face(0, 1));
  // conversation spots: pairs a metre apart facing each other (the market's west and east halves, the lee of the middle granary, the court terrace)
  for (const [i, [r, d, lee]] of ([[56, -19.5, false], [56, 13.5, false], [69.6, -60, true], [31.5, -42.5, false]] as const).entries()) {
    const p = hillPoint(r, d);
    // (along the terrace: the tangent at that bearing)
    const ux = Math.cos(p.th) * 0.55;
    const uz = -Math.sin(p.th) * 0.55;
    add({ key: `chat:${i}:a`, x: p.x - ux, z: p.z - uz, facing: face(ux, uz), sheltered: lee, reach: 5 });
    add({ key: `chat:${i}:b`, x: p.x + ux, z: p.z + uz, facing: face(-ux, -uz), sheltered: lee, reach: 5 });
  }
  // D-128: the Grange's hands. Their home is the Grange's barge at the quay: the step on the deck beside her and, out of sight, the gangplank's head at the deck's edge
  const q = plan.quay;
  add({ key: "step:barge", x: q.x + q.half - 0.7, z: q.boat.z, facing: face(1, 0), y: HIGHMARK.level, sheltered: true, reach: 4 });
  add({ key: "in:barge", x: q.x + q.half - 0.25, z: q.boat.z, facing: face(1, 0), y: HIGHMARK.level, hidden: true, sheltered: true, parent: "step:barge" });
  // the fields' places (each on its path): turning the hay between two of its rows, building a haycock, the plough's two headlands, gleaning between the stooks, hoeing the green
  for (const [key, x, z, fx, fz] of [
    ["hay:a", -19, 79, 1, 0], ["hay:b", -19, 89, 1, 0], ["hay:c", -12.6, 79, 0, 1],
    ["plough:a", 17, 2, 1, 0], ["plough:b", 29, 2, -1, 0],
    ["glean:a", 13.5, 66, 0, 1], ["glean:b", 19.5, 66, 0, -1], ["glean:c", 24.5, 66, 0, 1],
    ["hoe:a", -25, 13.5, 1, 0], ["hoe:b", -15.5, 13.5, -1, 0],
  ] as const) add({ key, x, z, facing: face(fx, fz), reach: 4 });
  // their two conversation spots: by the hay's road side, by the stubble's
  for (const [i, [cx, cz]] of ([[-8.5, 82], [7.5, 66]] as const).entries()) {
    add({ key: `chat:${4 + i}:a`, x: cx, z: cz - 0.55, facing: face(0, 1), reach: 5 });
    add({ key: `chat:${4 + i}:b`, x: cx, z: cz + 0.55, facing: face(0, -1), reach: 5 });
  }
  return out;
}

/**
 * The capital's walking network in a Highmark world: its water is the river (`setFolkWater`), and the folk walk under the gate's lintel (3.6 m over the passage:
 * `setFolkHeadroom`), the one way onto the court terrace.
 */
export function marcherNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  setFolkWater(world, (x, z) => (t.waterDepth?.(x, z) ?? 0) > 0.02);
  setFolkHeadroom(world, 2.2);
  return buildNavFrom(world, { trails: [roadTrail(), ...plainTrails()], grid: MARCHER_GRID, stations: marcherStations() }, why);
}

// ---- the cast ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry is the morning at the back door, the last is bed.
 * Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed. The hill is big: the long walks (the court terrace to the market, the guild terrace
 * round to the granaries) are given an hour and more, so nobody hurries.
 */
const CAST: readonly CastDef[] = [
  { key: "cheese", title: "Cheese-Seller", occupation: "seller", age: "adult", home: "hall1", lines: "hSeller", archetype: 0, script: [
    [5.6, "step:hall1", "idle"], [7.0, "stall:0", "sell", { carryIn: "basket" }], [12.9, "stall:0", "sell"], [18.2, "step:hall1", "idle"], [19.0, "in:hall1", "sleep"],
  ] },
  { key: "loaves", title: "Loaf-Seller", occupation: "seller", age: "adult", home: "hall1", lines: "hSeller", archetype: 3, script: [
    [5.4, "step:hall1", "idle"], [6.8, "stall:1", "sell", { carryIn: "loaves" }], [13.2, "stall:1", "sell"], [18.5, "step:hall1", "idle"], [19.3, "in:hall1", "sleep"],
  ] },
  { key: "crier", title: "Town Crier", occupation: "watch", age: "adult", home: "hall3", lines: "hCrier", archetype: 2, script: [
    [6.0, "step:hall3", "idle"], [7.6, "stall:2", "ring"], [10.4, "cry:west", "ring"], [11.8, "stall:2", "ring"], [14.6, "cry:east", "ring"], [16.2, "stall:2", "ring"], [18.0, "step:hall3", "idle"], [19.4, "in:hall3", "sleep"],
  ] },
  { key: "hides", title: "Hide-Seller", occupation: "seller", age: "adult", home: "hall3", lines: "hSeller", archetype: 4, script: [
    [5.5, "step:hall3", "idle"], [7.4, "stall:3", "sell", { carryIn: "crate" }], [13.4, "stall:3", "sell"], [17.8, "step:hall3", "idle"], [19.6, "in:hall3", "sleep"],
  ] },
  { key: "grain", title: "Grain-Seller", occupation: "seller", age: "adult", home: "hall3", lines: "hSeller", archetype: 1, script: [
    [5.9, "step:hall3", "idle"], [7.8, "stall:4", "sell", { carryIn: "sack" }], [14.0, "stall:4", "sell"], [17.9, "step:hall3", "idle"], [19.8, "in:hall3", "sleep"],
  ] },
  { key: "water", title: "Water-Carrier", occupation: "laundress", age: "adult", home: "hall1", lines: "hWater", archetype: 2, script: [
    [5.5, "step:hall1", "idle"], [7.6, "well:a", "draw", { to: "front:4", actTo: "idle", carryOut: "bucket" }], [10.4, "well:b", "draw", { to: "front:3", actTo: "idle", carryOut: "bucket" }],
    [13.2, "well:a", "draw", { to: "front:2", actTo: "idle", carryOut: "bucket" }], [16.0, "well:b", "draw", { to: "front:4", actTo: "idle", carryOut: "bucket" }], [18.3, "step:hall1", "idle"], [19.5, "in:hall1", "sleep"],
  ] },
  { key: "petitioner", title: "Petitioner", occupation: "registrar", age: "adult", home: "hall2", lines: "hPetition", archetype: 5, script: [
    [6.9, "step:hall2", "idle"], [7.4, "petition:b", "read", { carry: "book" }], [13.1, "petition:b", "read", { carry: "book" }], [18.6, "step:hall2", "idle"], [19.2, "in:hall2", "sleep"],
  ] },
  { key: "clerk", title: "Under-Clerk", occupation: "registrar", age: "adult", home: "hall2", lines: "hClerk", archetype: 5, script: [
    [6.6, "step:hall2", "idle"], [7.1, "office:hall2", "write", { carry: "book" }], [9.4, "office:hall3", "write", { carry: "book" }], [11.6, "office:hall2", "write", { carry: "book" }],
    [13.6, "office:hall4", "write", { carry: "book" }], [16.0, "office:hall2", "write", { carry: "book" }], [18.4, "step:hall2", "idle"], [19.0, "in:hall2", "sleep"],
  ] },
  { key: "reeve", title: "Granary-Reeve", occupation: "keeper", age: "adult", home: "hall1", lines: "hReeve", archetype: 1, script: [
    [5.3, "step:hall1", "idle"], [8.0, "granary:0", "write", { carry: "book" }], [9.8, "granary:1", "write", { carry: "book" }], [11.8, "granary:2", "write", { carry: "book" }],
    [14.0, "granary:0", "write", { carry: "book" }], [17.0, "step:hall1", "idle"], [19.2, "in:hall1", "sleep"],
  ] },
  { key: "porter", title: "Porter", occupation: "miller", age: "adult", home: "hall1", lines: "hPorter", archetype: 0, script: [
    [5.4, "step:hall1", "idle"], [8.1, "granary:0", "sack", { to: "granary:1", actTo: "sack", carryOut: "sack" }], [11.9, "granary:2", "sack", { to: "granary:1", actTo: "sack", carryOut: "sack" }],
    [14.2, "granary:1", "sack", { to: "granary:0", actTo: "sack", carryOut: "sack" }], [17.4, "step:hall1", "idle"], [19.4, "in:hall1", "sleep"],
  ] },
  { key: "elder", title: "Old Petitioner", occupation: "elder", age: "elder", home: "hall2", lines: "hPetition", archetype: 5, walk: 0.7, script: [
    [7.8, "step:hall2", "idle"], [8.3, "petition:a", "read", { carry: "book" }], [12.6, "petition:a", "read", { carry: "book" }], [16.8, "petition:a", "read", { carry: "book" }], [19.0, "step:hall2", "idle"], [19.5, "in:hall2", "sleep"],
  ] },
  { key: "tibb", title: "Tibb", occupation: "child", age: "child", home: "hall1", lines: "hChild", scale: 0.68, walk: 1.5, archetype: 3, script: [
    [7.9, "step:hall1", "play"], [8.5, "play:guild", "play", { to: "play:ramp", actTo: "play" }], [12.4, "step:hall1", "idle"], [13.5, "play:market", "play", { to: "front:2", actTo: "play" }], [17.4, "step:hall1", "play"], [19.1, "in:hall1", "sleep"],
  ] },
  // D-128: the Grange's hands, who live on the Grange's barge at the quay and walk up the road to the plain's fields (the far ones are given an hour and a half)
  { key: "turner", title: "Hay-Turner", occupation: "gardener", age: "adult", home: "barge", lines: "hField", archetype: 0, script: [
    [5.8, "step:barge", "idle"], [7.0, "hay:a", "sweep", { to: "hay:b", actTo: "sweep" }], [12.8, "hay:a", "sweep", { to: "hay:b", actTo: "sweep" }], [17.6, "step:barge", "idle"], [18.6, "in:barge", "sleep"],
  ] },
  { key: "haycock", title: "Haycock-Builder", occupation: "gardener", age: "adult", home: "barge", lines: "hField", archetype: 2, script: [
    [6.0, "step:barge", "idle"], [7.2, "hay:c", "tend"], [12.8, "hay:c", "tend"], [17.8, "step:barge", "idle"], [18.8, "in:barge", "sleep"],
  ] },
  { key: "plough", title: "Ploughman", occupation: "gardener", age: "adult", home: "barge", lines: "hField", archetype: 4, script: [
    [5.6, "step:barge", "idle"], [7.4, "plough:a", "tend", { to: "plough:b", actTo: "tend" }], [12.0, "plough:a", "idle"], [12.8, "plough:a", "tend", { to: "plough:b", actTo: "tend" }], [16.8, "step:barge", "idle"], [17.8, "in:barge", "sleep"],
  ] },
  { key: "hoer", title: "Hoer", occupation: "gardener", age: "adult", home: "barge", lines: "hField", archetype: 1, script: [
    [5.7, "step:barge", "idle"], [7.5, "hoe:a", "tend", { to: "hoe:b", actTo: "tend" }], [12.2, "hoe:a", "idle"], [13.0, "hoe:a", "tend", { to: "hoe:b", actTo: "tend" }], [17.0, "step:barge", "idle"], [18.0, "in:barge", "sleep"],
  ] },
  { key: "gleaner", title: "Gleaner", occupation: "gardener", age: "elder", home: "barge", lines: "hField", archetype: 5, walk: 0.7, script: [
    [6.6, "step:barge", "idle"], [8.0, "glean:a", "tend", { to: "glean:b", actTo: "tend" }], [13.2, "glean:a", "tend", { to: "glean:b", actTo: "tend" }], [16.4, "step:barge", "idle"], [17.4, "in:barge", "sleep"],
  ] },
  { key: "pip", title: "Pip", occupation: "child", age: "child", home: "barge", lines: "hField", scale: 0.66, walk: 1.5, archetype: 3, script: [
    [7.0, "step:barge", "play"], [8.2, "glean:c", "play", { to: "glean:b", actTo: "play" }], [12.6, "glean:c", "play", { to: "glean:b", actTo: "play" }], [16.2, "step:barge", "play"], [17.2, "in:barge", "sleep"],
  ] },
];

/** Talking events at the conversation spots. */
const MEETINGS: readonly Meeting[] = [
  { at: 12.2, dur: 0.6, spot: 0, a: "cheese", b: "loaves" },
  { at: 15.2, dur: 0.6, spot: 1, a: "hides", b: "grain" },
  { at: 10.9, dur: 0.5, spot: 2, a: "reeve", b: "porter" },
  { at: 12.4, dur: 0.7, spot: 3, a: "clerk", b: "petitioner" },
  { at: 12.1, dur: 0.5, spot: 4, a: "turner", b: "haycock" },
  { at: 12.7, dur: 0.5, spot: 5, a: "gleaner", b: "pip" },
];

/** Invented given names (no real language's); a Marcher is named for the ring of the hill they lodge on. */
const FIRSTS = ["Corvane", "Hessaly", "Brannick", "Tirelle", "Oswend", "Maddrey", "Fennor", "Savric", "Ondrel", "Pelleth", "Grisane", "Varrow", "Lorcet", "Huldry", "Arnet", "Wystan", "Calloe", "Dunmere"];
const ringOf = (home: string): string => MARCHER_HOMES.find((h) => `hall${h.hall}` === home)?.ring ?? "Third";
/** A Marcher's house: the ring of the hill they lodge on, or (D-128) the Grange, for its hands on the barge. */
const houseOf = (home: string): string => (home === "barge" ? "the Grange" : `the ${ringOf(home)} Ring`);

export const MARCHER_FOLK: FolkSpec = {
  id: "highmark",
  salt: 0x4a1c3e,
  lookSalt: 0x4a1c3e,
  cast: CAST,
  meetings: MEETINGS,
  firsts: FIRSTS,
  lasts: ["Third", "Fourth", "Grange"],
  roofs: ["stall:0", "stall:1", "stall:2", "stall:3", "stall:4"],
  // (the market's people stand the rain out under the stalls' awnings, the granary pair under the granaries' cones; the court's people, the elder and the child go in)
  // (D-128: the Grange's hands go home to the barge: there is no roof on the plain)
  indoors: (v) => v.age !== "adult" || v.occupation === "registrar" || v.occupation === "keeper" || v.occupation === "miller" || v.occupation === "gardener",
  name: (c, i, firsts) => `${c.age === "child" ? c.title : firsts[i % firsts.length]!} of ${houseOf(c.home)}`,
  people: "marchers",
  nav: (world) => marcherNav(world),
};

/** The Marchers of Highmark's capital, for a Highmark world and its seed: deterministic in both, built once and cached. */
export function buildHighmarkFolk(world: CollisionWorld, seed: number): Folk {
  return buildFolkFrom(world, seed, MARCHER_FOLK);
}
