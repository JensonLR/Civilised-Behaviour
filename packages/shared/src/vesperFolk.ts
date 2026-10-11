import type { CollisionWorld } from "./collision.ts";
import { staithePlan } from "./staithe.ts";
import { CLOISTER, vesperPlan, vesperRoad } from "./vesper.ts";
import { buildFolkFrom, type CastDef, type Folk, type FolkSpec, type Meeting } from "./villagers.ts";
import { buildNavFrom, setFolkWater, type Nav, type NavTrail, type StationDef } from "./villagerNav.ts";

/**
 * VESPER'S FOLK (D-125): the people of the gorge, on the same pure schedule as the other regions' folk (`villagerAt`: every client computes the same people in the same
 * places from the world clock; nothing simulated, nothing sent, nobody hit; D-122's fright works on them). The gorge's rule holds: they are members of its institutions,
 * never a people of their own. The Lamentation Guild lodge in the Long Cloister, behind a door in its corridor's back wall: the Bell-Warden rings the hours in the arcade,
 * two choristers practise their dirges in the arches, a novice sweeps, and the senior mourner leans at the south arch watching the gorge. The Assay House's sample clerk
 * walks the ore road's carts with a book and its porter carries samples from a cart to the house (they lodge behind its east door, on the cliff side). The bargefolk live
 * aboard the ore barge at the wharf: the bargee minds the moorings, the barge-hand loads from the cart by the road, and their child plays on the bank.
 * Everyone keeps clear of the head of the gorge (the mine's yard and the winding house are the contracts') and at least 6 m from every story point.
 */

/** Character facing that looks along (dx, dz) (0 = -Z), as villagerNav's. */
const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** Where the folk's own doors are (z): the Guild's in the cloister corridor's back wall (clear of the records room and the cloister's story point), the Assay House's on its east face. */
export const GORGE_DOORS = { guild: 56, assay: 17 } as const;
/** D-127: the Staithe's houses the folk live in, each with a back door on the side away from the road (bunk0 stands empty: let by the hour, and nobody has the hour). */
export const STAITHE_LODGINGS: readonly string[] = ["receiving", "weigh", "bunk1", "bunk2"];
const GUILD_DOOR_Z = GORGE_DOORS.guild;
const ASSAY_DOOR_Z = GORGE_DOORS.assay;

/** The ore road up the gorge from the wharf to the trestle (the head beyond it is the contracts'), every two metres. */
function roadTrail(): NavTrail {
  const pts = vesperRoad().filter((p) => p.z >= -46);
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
  return { width: 5, line };
}

/** Open ground over the gorge's floor and benches from the wharf to the trestle. */
export const GORGE_GRID = { x0: -52, x1: 47, z0: -46, z1: 134, step: 2 } as const;

/** Every station of the gorge's folk, from the plan (ideals: `buildNavFrom` nudges each to free ground and drops what cannot be reached). */
export function gorgeStations(): StationDef[] {
  const plan = vesperPlan();
  const C = CLOISTER;
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  const corridor = (C.backX + C.pierIn) / 2;
  // the Guild's door in the corridor's back wall: the step in the corridor before it, and just inside (out of sight)
  add({ key: "step:guild", x: C.backX + 1.0, z: GUILD_DOOR_Z, facing: face(1, 0), sheltered: true, reach: 4 });
  add({ key: "in:guild", x: C.backX + 0.3, z: GUILD_DOOR_Z, facing: face(-1, 0), hidden: true, sheltered: true, parent: "step:guild" });
  // the arcade: the Bell-Warden's place under the gable, the choristers in two south arches looking out, the novice's two sweeping places
  add({ key: "bell", x: corridor + 0.3, z: 51, facing: face(1, 0), sheltered: true, reach: 4 });
  const archZ = (i: number): number => plan.cloister.z - plan.cloister.hz + C.pierW + C.archClear / 2 + i * (C.pierW + C.archClear);
  add({ key: "arch:a", x: C.pierIn - 0.4, z: archZ(5), facing: face(1, 0), sheltered: true, reach: 4 });
  add({ key: "arch:b", x: C.pierIn - 0.4, z: archZ(6), facing: face(1, 0), sheltered: true, reach: 4 });
  add({ key: "sweep:a", x: corridor, z: 49, facing: face(0, 1), sheltered: true, reach: 4 });
  add({ key: "sweep:b", x: corridor, z: C.southEnd - 1.4, facing: face(0, -1), sheltered: true, reach: 4 });
  // the senior mourner: outside the southmost arch, leaning on its pier, looking out over the gorge
  add({ key: "lean:arch", x: C.frontX + 0.5, z: archZ(6) + 1.6, facing: face(1, 0), reach: 4 });
  // the Assay House: its back door on the east face (the cliff side), and the sample bin against its south wall (the station before the bin, facing it)
  const a = plan.assay;
  const sb = plan.sampleBin;
  add({ key: "step:assay", x: a.x + a.hx + 1.15, z: ASSAY_DOOR_Z, facing: face(-1, 0), sheltered: true, reach: 4 });
  add({ key: "in:assay", x: a.x + a.hx + 0.3, z: ASSAY_DOOR_Z, facing: face(-1, 0), hidden: true, sheltered: true, parent: "step:assay" });
  add({ key: "bin", x: sb.x, z: sb.z - sb.hz - 0.65, facing: face(0, 1), reach: 4 });
  // the ore carts on the road's verge: where the sample clerk reads them and the porter and the barge-hand load
  plan.carts.forEach((k, i) => add({ key: `cart:${i}`, x: k.x + (k.x < 0 ? -1.9 : 1.9), z: k.z, facing: face(k.x < 0 ? 1 : -1, 0), reach: 5 }));
  // the barge: the step on the wharf beside it, the gangplank's foot (aboard: out of sight), the bargee's two moorings at the wharf's far end, the plank where the cargo goes aboard
  const w = plan.wharf;
  add({ key: "step:barge", x: w.x + 1.0, z: w.barge.z, facing: face(1, 0), sheltered: true, y: w.y, reach: 4 });
  add({ key: "in:barge", x: w.x + w.half - 0.25, z: w.barge.z, y: w.y, facing: face(1, 0), hidden: true, sheltered: true, parent: "step:barge" });   // (at the deck's edge, where the gangplank crosses to the barge's gunwale)
  add({ key: "moor:w", x: w.x - 1.1, z: w.bollards[2]!.z, facing: face(-1, 0), y: w.y, reach: 4 });
  add({ key: "moor:e", x: w.x + 1.1, z: w.bollards[3]!.z - 1.2, facing: face(1, 0), y: w.y, reach: 4 });
  add({ key: "plank", x: w.x + 1.0, z: w.barge.z - 2.6, facing: face(1, 0), y: w.y, reach: 4 });
  // where the barge child plays: the bank west of the basin, and by the road below the landing
  add({ key: "play:bank", x: -9, z: 124, facing: face(1, 0), reach: 5 });
  add({ key: "play:road", x: -8, z: 104, facing: face(0, 1), reach: 5 });
  // D-127, the Staithe (D-126). The Guild's Receiving House: the Receiver's place by the measuring post, their watch on the landing (clear of the horses' places and the
  // arrival), the two places at the crepe line (its back door, on the line's side, is the lodgings' below)
  const st = staithePlan();
  const rh = st.houses.find((h) => h.kind === "receiving")!;
  add({ key: "post", x: st.post.x + 0.9, z: st.post.z + 0.6, facing: face(-1, 0), reach: 4 });
  add({ key: "watch:landing", x: -7.5, z: 104.5, facing: face(7.5, 13.5), reach: 4 });
  add({ key: "line:a", x: st.line.x + 0.8, z: st.line.z0 + 1.2, facing: face(-1, 0), reach: 4 });
  add({ key: "line:b", x: st.line.x + 0.8, z: st.line.z1 - 1.2, facing: face(-1, 0), reach: 4 });
  // the lodgings' back doors, on the side away from the road: the Receiving House's (west), the weigh-house's (the Weigher lives over the scale) and the two bunkhouses its
  // miners have let (east); the Weigher's place at the steelyard's pan, two places to lean at the Rows' fronts
  for (const h of st.houses.filter((b) => STAITHE_LODGINGS.includes(b.id))) {
    const back = -Math.cos(h.yaw);   // (the back's outward x: the doors are to the road, east or west)
    add({ key: `step:${h.id}`, x: h.x + back * (h.hx + 1.15), z: h.z, facing: face(-back, 0), sheltered: true, reach: 4 });
    add({ key: `in:${h.id}`, x: h.x + back * (h.hx + 0.3), z: h.z, facing: face(-back, 0), hidden: true, sheltered: true, parent: `step:${h.id}` });
  }
  const g = st.gallows;
  add({ key: "scale", x: g.panX - 0.1, z: g.z - g.r - 0.55, facing: face(0, 1), reach: 4 });
  const [, b1, b2] = st.houses.filter((b) => b.kind === "bunk");
  add({ key: "lean:rows:a", x: b1!.x - b1!.hx - 0.35, z: b1!.z - 1.55, facing: face(-1, 0), reach: 4 });
  add({ key: "lean:rows:b", x: b2!.x - b2!.hx - 0.35, z: b2!.z + 1.55, facing: face(-1, 0), reach: 4 });
  // conversation spots: pairs a metre apart facing each other (the arcade, the assay's yard, the wharf's bank; D-127: before the Rows, before the Receiving House)
  for (const [i, [cx, cz, ang]] of ([[corridor, 59, Math.PI / 2], [36, 6, 0], [-9, 114, Math.PI / 2], [8.6, 73, Math.PI / 2], [-6.6, 101, 0]] as const).entries()) {
    const ux = Math.cos(ang) * 0.55;
    const uz = Math.sin(ang) * 0.55;
    const roofed = i === 0;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: face(ux, uz), sheltered: roofed, reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: face(-ux, -uz), sheltered: roofed, reach: 5 });
  }
  return out;
}

/** The gorge's walking network in a Vesper world: its only standing water is the wharf's basin (`setFolkWater`). */
export function gorgeNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const pool = vesperPlan().wharf.pool;
  setFolkWater(world, (x, z) => Math.hypot(x - pool.x, z - pool.z) < pool.r + 1 && world.terrainHeight(x, z) < pool.y + 0.02);
  const w = vesperPlan().wharf;
  // the wharf's planks (over the basin: the walker's feet are on the deck, not the basin's floor)
  const deck: NavTrail = { width: w.half * 2, y: w.y, line: [w.x, w.z0 - 1, w.x, w.z0 + 2, w.x, w.z0 + 5, w.x, w.z0 + 8, w.x, w.z0 + 11, w.x, w.z1 - 0.6] };
  return buildNavFrom(world, { trails: [roadTrail(), deck], grid: GORGE_GRID, stations: gorgeStations() }, why);
}

// ---- the cast ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry is the morning at the door, the last is bed.
 * Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed.
 */
const CAST: readonly CastDef[] = [
  { key: "bell", title: "Bell-Warden", occupation: "clockkeeper", age: "adult", home: "guild", lines: "vBell", archetype: 2, script: [
    [5.6, "step:guild", "idle"], [6.0, "bell", "ring"], [7.0, "sweep:a", "idle"], [9.0, "bell", "ring"], [10.0, "lean:arch", "lean"], [12.0, "bell", "ring"], [13.0, "arch:b", "idle"], [15.0, "bell", "ring"], [16.0, "lean:arch", "lean"], [18.0, "bell", "ring"], [19.0, "step:guild", "idle"], [19.6, "in:guild", "sleep"],
  ] },
  { key: "choirA", title: "Chorister", occupation: "registrar", age: "adult", home: "guild", lines: "vGuild", archetype: 5, script: [
    [6.6, "step:guild", "idle"], [7.0, "arch:a", "read", { carry: "book" }], [12.6, "arch:a", "read", { carry: "book" }], [18.4, "step:guild", "idle"], [19.2, "in:guild", "sleep"],
  ] },
  { key: "choirB", title: "Chorister", occupation: "registrar", age: "adult", home: "guild", lines: "vGuild", archetype: 3, script: [
    [6.8, "step:guild", "idle"], [7.2, "arch:b", "read", { carry: "book" }], [12.8, "arch:b", "read", { carry: "book" }], [18.6, "step:guild", "idle"], [19.3, "in:guild", "sleep"],
  ] },
  { key: "clerk", title: "Sample-Clerk", occupation: "registrar", age: "adult", home: "assay", lines: "vAssay", archetype: 1, script: [
    [6.4, "step:assay", "idle"], [7.0, "bin", "write", { carry: "book" }], [8.6, "cart:1", "write", { carry: "book" }], [10.4, "cart:0", "write", { carry: "book" }], [12.4, "bin", "write", { carry: "book" }],
    [14.0, "cart:2", "write", { carry: "book" }], [15.0, "bin", "write", { carry: "book" }], [17.4, "step:assay", "idle"], [19.0, "in:assay", "sleep"],
  ] },
  { key: "bargee", title: "Bargee", occupation: "ferryman", age: "adult", home: "barge", lines: "vBarge", archetype: 4, script: [
    [5.8, "step:barge", "idle"], [6.2, "moor:w", "tend"], [9.0, "moor:e", "tend"], [12.0, "step:barge", "idle"], [13.0, "moor:w", "tend"], [16.0, "moor:e", "tend"], [18.6, "step:barge", "idle"], [19.4, "in:barge", "sleep"],
  ] },
  { key: "hand", title: "Barge-Hand", occupation: "miller", age: "adult", home: "barge", lines: "vBarge", archetype: 0, script: [
    [6.0, "step:barge", "idle"], [6.6, "cart:2", "sack", { to: "plank", actTo: "sack", carryOut: "crate" }], [11.6, "step:barge", "idle"], [12.6, "cart:2", "sack", { to: "plank", actTo: "sack", carryOut: "crate" }], [18.0, "step:barge", "idle"], [19.0, "in:barge", "sleep"],
  ] },
  { key: "porter", title: "Sample-Porter", occupation: "miller", age: "adult", home: "assay", lines: "vAssay", archetype: 0, script: [
    [6.2, "step:assay", "idle"], [7.0, "cart:1", "sack", { to: "bin", actTo: "sack", carryOut: "sack" }], [12.2, "step:assay", "idle"], [13.2, "cart:1", "sack", { to: "bin", actTo: "sack", carryOut: "sack" }], [18.2, "step:assay", "idle"], [19.2, "in:assay", "sleep"],
  ] },
  { key: "novice", title: "Novice", occupation: "keeper", age: "adult", home: "guild", lines: "vGuild", archetype: 3, script: [
    [6.0, "step:guild", "idle"], [6.4, "sweep:b", "sweep"], [9.4, "sweep:a", "sweep"], [12.0, "step:guild", "idle"], [13.0, "sweep:b", "sweep"], [16.0, "sweep:a", "sweep"], [18.8, "step:guild", "idle"], [19.5, "in:guild", "sleep"],
  ] },
  { key: "elder", title: "Senior Mourner", occupation: "elder", age: "elder", home: "guild", lines: "vElder", archetype: 5, walk: 0.7, script: [
    [8.0, "step:guild", "idle"], [8.6, "lean:arch", "lean"], [12.4, "arch:a", "idle"], [13.4, "lean:arch", "lean"], [18.6, "step:guild", "idle"], [19.2, "in:guild", "sleep"],
  ] },
  { key: "scrap", title: "Scrap", occupation: "child", age: "child", home: "barge", lines: "vChild", scale: 0.68, walk: 1.5, archetype: 3, script: [
    [7.8, "step:barge", "play"], [8.4, "play:bank", "play", { to: "play:road", actTo: "play" }], [12.4, "step:barge", "idle"], [13.4, "play:bank", "play", { to: "moor:w", actTo: "play" }], [17.6, "step:barge", "play"], [19.2, "in:barge", "sleep"],
  ] },
  // D-127: the Staithe. The Guild's Receiver measures the arrivals at the post and watches the landing; its Crepe-Keeper hangs the mourning black between the line's ends;
  // the Company's Weigher works the steelyard and checks the near cart; two of its miners, off shift, lean at the Rows
  { key: "receiver", title: "Receiver", occupation: "registrar", age: "adult", home: "receiving", lines: "vReceive", archetype: 4, script: [
    [6.0, "step:receiving", "idle"], [6.5, "post", "write", { carry: "book" }], [9.0, "watch:landing", "idle"], [10.0, "post", "write", { carry: "book" }], [12.0, "step:receiving", "idle"],
    [13.0, "watch:landing", "idle"], [14.2, "post", "write", { carry: "book" }], [17.4, "watch:landing", "idle"], [18.4, "step:receiving", "idle"], [19.0, "in:receiving", "sleep"],
  ] },
  { key: "crepe", title: "Crepe-Keeper", occupation: "laundress", age: "adult", home: "receiving", lines: "vGuild", archetype: 3, script: [
    [6.6, "step:receiving", "idle"], [7.0, "line:a", "hang", { to: "line:b", actTo: "hang", carryOut: "washing" }], [12.2, "step:receiving", "idle"],
    [13.0, "line:a", "hang", { to: "line:b", actTo: "hang", carryOut: "washing" }], [18.2, "step:receiving", "idle"], [18.8, "in:receiving", "sleep"],
  ] },
  { key: "weigher", title: "Weigher", occupation: "registrar", age: "adult", home: "weigh", lines: "vCompany", archetype: 2, script: [
    [6.2, "step:weigh", "idle"], [6.8, "scale", "write", { carry: "book" }], [9.0, "cart:2", "write", { carry: "book" }], [10.0, "scale", "write", { carry: "book" }], [12.0, "step:weigh", "idle"],
    [13.0, "scale", "write", { carry: "book" }], [15.0, "cart:2", "write", { carry: "book" }], [16.0, "scale", "write", { carry: "book" }], [18.2, "step:weigh", "idle"], [19.0, "in:weigh", "sleep"],
  ] },
  { key: "minerA", title: "Miner, Off Shift", occupation: "miller", age: "adult", home: "bunk1", lines: "vCompany", archetype: 0, script: [
    [8.0, "step:bunk1", "idle"], [8.4, "lean:rows:a", "lean"], [12.6, "lean:rows:a", "lean"], [15.0, "scale", "idle"], [16.0, "lean:rows:a", "lean"], [18.6, "step:bunk1", "idle"], [19.2, "in:bunk1", "sleep"],
  ] },
  { key: "minerB", title: "Miner, Off Shift", occupation: "miller", age: "adult", home: "bunk2", lines: "vCompany", archetype: 2, script: [
    [9.0, "step:bunk2", "idle"], [9.4, "lean:rows:b", "lean"], [12.6, "lean:rows:b", "lean"], [17.0, "step:bunk2", "idle"], [17.6, "in:bunk2", "sleep"],
  ] },
];

/** Talking events at the conversation spots. */
const MEETINGS: readonly Meeting[] = [
  { at: 12.1, dur: 0.6, spot: 0, a: "choirA", b: "choirB" },
  { at: 15.4, dur: 0.6, spot: 1, a: "clerk", b: "porter" },
  { at: 11.0, dur: 0.6, spot: 2, a: "bargee", b: "hand" },
  { at: 12.0, dur: 0.5, spot: 3, a: "minerA", b: "minerB" },
  { at: 15.4, dur: 0.5, spot: 4, a: "receiver", b: "crepe" },
];

/** Invented given names (no real language's); a member of the gorge is named for the institution they belong to. */
const FIRSTS = ["Ilvane", "Corsk", "Mavrin", "Oddrey", "Pellan", "Severt", "Quellin", "Haddrel", "Nimsy", "Orrick", "Thaddry", "Brask", "Ulwen", "Fennet", "Ostry", "Drensk", "Quarn", "Vellet"];
const HOUSES: Readonly<Record<string, string>> = { guild: "the Guild", assay: "the Assay", barge: "the Barge", receiving: "the Guild", weigh: "the Company", bunk1: "the Company", bunk2: "the Company" };

export const GORGE_FOLK: FolkSpec = {
  id: "vesper",
  salt: 0x6e5b1d,
  lookSalt: 0x6e5b1d,
  cast: CAST,
  meetings: MEETINGS,
  firsts: FIRSTS,
  lasts: [...new Set(Object.values(HOUSES))],
  roofs: ["bell", "arch:a", "arch:b", "sweep:a", "sweep:b"],
  // (the Guild work under the arcade's roof whatever the weather; rain sends everyone else in)
  indoors: () => true,
  name: (c, i, firsts) => `${c.age === "child" ? c.title : firsts[i % firsts.length]!} of ${HOUSES[c.home] ?? "the Guild"}`,
  people: "vesperine",
  nav: (world) => gorgeNav(world),
};

/** Vesper's folk, for a Vesper world and its seed: deterministic in both, built once and cached. */
export function buildVesperFolk(world: CollisionWorld, seed: number): Folk {
  return buildFolkFrom(world, seed, GORGE_FOLK);
}
