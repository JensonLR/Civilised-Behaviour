import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A } from "./campaignTypes.ts";
import { createArena } from "./arena.ts";
import { BUTTON, FLAG } from "./constants.ts";
import { PALETTE, chroma, contrast, hsl } from "./palette.ts";
import { buildingIdAt } from "./levelPlan.ts";
import { KESSAR, KESSAR_SIGNS, createKessarWorld, kessarLevel, kessarPlan, kessarProps, kessarRiverZ, kessarRoad, kessarSpawn } from "./kessar.ts";
import { createCharState, stepCharacter, yawToWire, type CharState } from "./movement.ts";
import { PropKind } from "./props.ts";
import type { CollisionWorld } from "./collision.ts";

const hashOf = (world: CollisionWorld): string => {
  let h = 2166136261;
  const s = JSON.stringify(world.obstacles.map((o) => [o.kind, o.tag, +o.x.toFixed(3), +o.z.toFixed(3), +o.y0.toFixed(3), +o.y1.toFixed(3)]));
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${world.obstacles.length}:${h >>> 0}`;
};

describe("Kessar Reach: the world", () => {
  it("is deterministic per seed across 5 seeds and never touches Hollowmere's arena", () => {
    const arenaBefore = hashOf(createArena(7));
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const a = createKessarWorld(seed);
      const b = createKessarWorld(seed);
      expect(hashOf(a)).toBe(hashOf(b));
      expect(a.obstacles.length).toBeGreaterThan(80);
      for (const [x, z] of [[0, 0], [12, 40], [-30, -20], [46, 20]] as const) expect(a.terrainHeight(x, z)).toBe(b.terrainHeight(x, z));
    }
    expect(hashOf(createKessarWorld(1))).not.toBe(hashOf(createKessarWorld(2)));
    expect(hashOf(createArena(7))).toBe(arenaBefore);
  });

  it("the collapsed world differs from the intact one only at the bridge", () => {
    const seed = 7;
    const intact = createKessarWorld(seed, "intact");
    const rigged = createKessarWorld(seed, "rigged");
    const down = createKessarWorld(seed, "collapsed");
    expect(hashOf(rigged)).toBe(hashOf(intact));
    const key = (o: { kind: string; tag?: string; x: number; z: number }): string => `${o.kind}:${o.tag}:${o.x.toFixed(2)}:${o.z.toFixed(2)}`;
    const near = (o: { x: number; z: number }): boolean => Math.abs(o.x) < 8 && Math.abs(o.z - A.bridge.z) < 14;
    const far = (w: CollisionWorld): string[] => w.obstacles.filter((o) => !near(o)).map(key);
    expect(far(down)).toEqual(far(intact));
    // no deck, no parapets; pier stumps and rubble remain
    expect(down.obstacles.some((o) => o.tag === "bridge" && o.kind === "box")).toBe(false);
    expect(intact.obstacles.some((o) => o.tag === "bridge" && o.kind === "box")).toBe(true);
    expect(down.obstacles.filter((o) => o.tag === "bridge" && o.kind === "circle").length).toBe(2);
    expect(down.obstacles.filter((o) => near(o) && o.tag === "rock").length).toBeGreaterThan(2);
  });

  it("no story anchor stands inside anything that blocks a walker, and nothing stands on the deck", () => {
    const world = createKessarWorld(7);
    const pts: [string, number, number][] = [
      ["landing", A.landing.x, A.landing.z], ["tollBar", A.tollBar.x, A.tollBar.z], ["wardenPost", A.wardenPost.x, A.wardenPost.z], ["pier", A.pier.x, A.pier.z],
      ["ford", A.ford.x, A.ford.z], ["gate", A.fort.gate.x, A.fort.gate.z], ["rivalCamp", A.rivalCamp.x, A.rivalCamp.z], ["rivalParley", A.rivalParley.x, A.rivalParley.z], ["powder", A.powder.x, A.powder.z],
      ...A.sentries.map((s, i): [string, number, number] => [`sentry${i}`, s.x, s.z]),
    ];
    const p = { x: 0, z: 0 };
    for (const [name, x, z] of pts) {
      p.x = x;
      p.z = z;
      const y = world.groundHeight(x, z, 1e6);
      expect(world.resolveXZ(p, y, 0.4, 1.8), name).toBe(false);
    }
    for (let i = 0; i < 4; i++) {
      const s = kessarSpawn(i);
      p.x = s.x;
      p.z = s.z;
      expect(world.resolveXZ(p, world.groundHeight(s.x, s.z, 1e6), 0.4, 1.8), `spawn ${i}`).toBe(false);
      expect(s.z, "spawn is not on the pier").toBeLessThan(A.landing.z + 3);
    }
    const plan = kessarPlan();
    for (const pr of kessarProps(7, world)) {
      const onDeck = Math.abs(pr.x - plan.bridge.x) < KESSAR.deckHalf + 0.5 && pr.z > plan.bridge.z0 && pr.z < plan.bridge.z1;
      expect(onDeck).toBe(false);
    }
  });

  it("authored things do not stand inside each other (tents, carts, palms, posts, booths, signs, crates)", () => {
    const world = createKessarWorld(7);
    const tags = new Set(["tent", "cart", "flag", "crate", "house", "stall", "pole", "sign"]);
    const items = world.obstacles.filter((o) => tags.has(o.tag ?? "") && !(o.tag === "house" && Math.abs(o.x) < 7 && o.z < -30));
    const reach = (o: (typeof items)[number]): number => (o.kind === "circle" ? o.r : Math.min(o.hx, o.hz));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        // (D-038: the toll booth is a room, several wall boxes of ONE building)
        const ia = buildingIdAt(kessarLevel(), a.x, a.z, 0.2), ib = buildingIdAt(kessarLevel(), b.x, b.z, 0.2);
        if (a.tag === "house" && b.tag === "house" && ia !== undefined && ia === ib) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.tag}@${a.x.toFixed(1)},${a.z.toFixed(1)} vs ${b.tag}@${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(reach(a) + reach(b));
      }
    }
  });

  it("props: three barrels of powder by the cart, the rest clear of everything solid", () => {
    const world = createKessarWorld(7);
    const props = kessarProps(7, world);
    const powder = props.filter((p) => p.kind === PropKind.BARREL && Math.hypot(p.x - A.powder.x, p.z - A.powder.z) < 3);
    expect(powder.length).toBe(3);
    expect(props.length).toBeLessThan(20);
    expect(kessarProps(7, world)).toEqual(props);
    const pos = { x: 0, z: 0 };
    for (const pr of props) {
      pos.x = pr.x;
      pos.z = pr.z;
      expect(world.resolveXZ(pos, world.groundHeight(pr.x, pr.z, 1e6), 0.3, 0.8), `${pr.x},${pr.z}`).toBe(false);
    }
  });

  it("the road runs landing -> bridge -> gate", () => {
    expect(kessarRoad(0, 60)).toBeGreaterThan(0.95);
    expect(kessarRoad(0, 40)).toBeGreaterThan(0.95);
    expect(kessarRoad(0, 10)).toBeGreaterThan(0.95);
    expect(kessarRoad(0, -30)).toBeGreaterThan(0.95);
    expect(kessarRoad(30, -10)).toBe(0);
  });
});

// ---- reachability with the REAL movement step ----------------------------------------------------------------------------------------

const CELL = 2;
const span = Math.ceil(A.bounds / CELL);
const key = (i: number, j: number): number => (i + span) * (2 * span + 1) + (j + span);

/**
 * Directed flood fill on a 2 m grid: an edge exists when a character standing at one cell's centre, pushing the stick toward the next cell with
 * the real `stepCharacter`, arrives within half a cell. Descending into the gorge is free, climbing out is not, exactly as in the game.
 */
function reach(world: CollisionWorld, from: { x: number; z: number }, forbid: (x: number, z: number) => boolean = () => false): (x: number, z: number) => boolean {
  const seen = new Set<number>();
  const st: CharState = createCharState(0, 0, world);
  const probe = { x: 0, z: 0 };
  /** The surface a walker stands on: the ground, or the deck / pier planks over it (never the top of a wall). */
  const surface = (x: number, z: number): number => {
    let y = world.terrainHeight(x, z);
    world.forEachNear(x, z, (o) => {
      if ((o.tag === "bridge" || o.tag === "jetty") && o.kind === "box" && Math.abs(x - o.x) <= o.hx && Math.abs(z - o.z) <= o.hz && o.y1 > y) y = o.y1;
    });
    return y;
  };
  const standable = (x: number, z: number): boolean => {
    probe.x = x;
    probe.z = z;
    return !world.resolveXZ(probe, surface(x, z), 0.4, 1.8);
  };
  const tryEdge = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (!standable(x0, z0) || !standable(x1, z1)) return false;
    st.x = x0;
    st.z = z0;
    st.y = surface(x0, z0);
    st.vx = st.vy = st.vz = 0;
    st.flags = FLAG.GROUNDED;
    st.stumble = 0;
    const yaw = yawToWire(Math.atan2(-(x1 - x0), -(z1 - z0)));
    for (let k = 0; k < 40; k++) {
      stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: 0 }, 1 / 30, world);
      if (Math.hypot(st.x - x1, st.z - z1) < 0.6) return true;
    }
    return false;
  };
  const q: [number, number][] = [];
  const si = Math.round(from.x / CELL);
  const sj = Math.round(from.z / CELL);
  seen.add(key(si, sj));
  q.push([si, sj]);
  while (q.length) {
    const [i, j] = q.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      const x1 = ni * CELL;
      const z1 = nj * CELL;
      if (Math.hypot(x1, z1) > A.bounds - 1 || seen.has(key(ni, nj)) || forbid(x1, z1)) continue;
      if (tryEdge(i * CELL, j * CELL, x1, z1)) {
        seen.add(key(ni, nj));
        q.push([ni, nj]);
      }
    }
  }
  return (x, z) => {
    // any visited cell centre within 1.5 m of the point
    for (const di of [0, -1, 1]) for (const dj of [0, -1, 1]) {
      const i = Math.round(x / CELL) + di;
      const j = Math.round(z / CELL) + dj;
      if (Math.hypot(i * CELL - x, j * CELL - z) <= 1.5 && seen.has(key(i, j))) return true;
    }
    return false;
  };
}

const onBridge = (x: number, z: number): boolean => Math.abs(x) < 4.6 && z > 9.4 && z < 31.6;
/** The ford's whole north-south band (the bed is open water under the rim, so cutting the ford means cutting the band). */
const onFord = (x: number): boolean => Math.abs(x - KESSAR.fordX) < 20;
const north: [string, number, number][] = [
  ["tollBar", A.tollBar.x, A.tollBar.z], ["wardenPost", A.wardenPost.x, A.wardenPost.z], ["rivalParley", A.rivalParley.x, A.rivalParley.z], ["fort gate", A.fort.gate.x, A.fort.gate.z],
  ...A.sentries.map((s, i): [string, number, number] => [`sentry ${i}`, s.x, s.z]),
];

describe("Kessar Reach: the crossing is the bridge or the ford, nothing else", () => {
  const seed = 7;
  const intact = createKessarWorld(seed, "intact");
  const landing = A.landing;

  it("south bank: the landing, the powder, the Syndicate's camp and the pier are all walkable from the beach", () => {
    const r = reach(intact, landing, (x, z) => onBridge(x, z) || onFord(x));
    for (const [n, x, z] of [["powder", A.powder.x, A.powder.z], ["camp", A.rivalCamp.x, A.rivalCamp.z], ["south end of the bridge", 0, 34], ["south bank, west of the ford", 22, 38]] as const) expect(r(x, z), n).toBe(true);
    for (const [n, x, z] of north) expect(r(x, z), `${n} must be cut off without bridge and ford`).toBe(false);
  });

  it("the bridge alone reaches every northern post; the ford alone reaches them too", () => {
    const viaBridge = reach(intact, landing, (x, z) => onFord(x) && z > 12.5); // (the north bank at the ford stays open: the patrol ends stand there)
    const viaFord = reach(intact, landing, onBridge);
    for (const [n, x, z] of north) {
      expect(viaBridge(x, z), `bridge -> ${n}`).toBe(true);
      expect(viaFord(x, z), `ford -> ${n}`).toBe(true);
    }
  }, 60_000);

  it("with the bridge collapsed the ford is the only way: the toll bar needs it", () => {
    const down = createKessarWorld(seed, "collapsed");
    const noFord = reach(down, landing, (x) => onFord(x));
    expect(noFord(A.tollBar.x, A.tollBar.z)).toBe(false);
    expect(noFord(A.fort.gate.x, A.fort.gate.z)).toBe(false);
    const withFord = reach(down, landing);
    expect(withFord(A.tollBar.x, A.tollBar.z)).toBe(true);
    expect(withFord(A.fort.gate.x, A.fort.gate.z)).toBe(true);
  }, 60_000);

  it("the deck is solid to a walker and the parapet keeps him on it; the collapsed span drops him to the bed", () => {
    const st = createCharState(0, 12, intact);
    expect(st.y).toBeCloseTo(KESSAR.level, 1);
    let midY = 0;
    for (let k = 0; k < 160; k++) {
      stepCharacter(st, { moveF: 127, moveR: 0, yaw: yawToWire(Math.PI), buttons: BUTTON.SPRINT }, 1 / 30, intact); // yaw PI = toward +z
      if (st.z > 19.5 && st.z < 20.5) midY = st.y;
    }
    expect(st.z).toBeGreaterThan(31);
    expect(midY, "mid-span he walks on the deck, four metres over the bed").toBeCloseTo(KESSAR.level, 1);
    const wall = createCharState(0, 20, intact);
    for (let k = 0; k < 60; k++) stepCharacter(wall, { moveF: 0, moveR: 127, yaw: yawToWire(Math.PI), buttons: 0 }, 1 / 30, intact);
    expect(Math.abs(wall.x)).toBeLessThan(KESSAR.deckHalf + 0.1);
    const down = createKessarWorld(seed, "collapsed");
    const fall = createCharState(0, 20, intact);
    fall.flags = FLAG.GROUNDED;
    for (let k = 0; k < 60; k++) stepCharacter(fall, { moveF: 0, moveR: 0, yaw: 0, buttons: 0 }, 1 / 30, down);
    expect(fall.y).toBeLessThan(KESSAR.level - 3);
  });

  it("the gorge is fenced by a rim wall except at the bridge and the ford, and the ford is shallow", () => {
    const plan = kessarPlan();
    expect(plan.rim.length).toBeGreaterThan(40);
    for (const w of plan.rim) {
      expect(Math.abs(w.x), "no rim across the bridge").toBeGreaterThan(3.7);
      expect(Math.abs(w.x - KESSAR.fordX), "no rim across the ford").toBeGreaterThan(13);
    }
    const side = (n: number): number => plan.rim.filter((w) => (w.z < kessarRiverZ(w.x)) === (n < 0)).length;
    expect(Math.abs(side(-1) - side(1))).toBeLessThanOrEqual(4);
    const t = intact.terrain as unknown as { waterDepth(x: number, z: number): number };
    expect(t.waterDepth(A.ford.x, A.ford.z)).toBeGreaterThan(0.4);
    expect(t.waterDepth(A.ford.x, A.ford.z)).toBeLessThan(1.0);
    expect(t.waterDepth(0, 60)).toBe(0);
    expect(t.waterDepth(0, 110)).toBeGreaterThan(0.3); // the sea wades, it does not drown
    // a walker dropped in the bed under the bridge cannot climb out diagonally at the abutments (deck overhead) or anywhere along the rim
    const st = createCharState(-30, 24, intact);
    st.y = intact.groundHeight(-30, 24, 1e6);
    for (let k = 0; k < 600; k++) stepCharacter(st, { moveF: 127, moveR: k % 40 < 20 ? 60 : -60, yaw: yawToWire(0), buttons: 0 }, 1 / 30, intact);
    expect(st.z, "still inside the gorge, south of the north rim").toBeGreaterThan(7);
  });
});

describe("Kessar Reach: authored content", () => {
  it("sign text is Latin-letter satire with no real-world nation, people, religion or city", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|spanish|rome|roman|india|indian|china|chinese|japan|africa|african|arab|arabia|egypt|turk|persia|mecca|islam|muslim|christ|jesus|jewish|hindu|buddh|empire of|america|russia|paris|berlin|cairo|union jack)\b/i;
    for (const s of KESSAR_SIGNS) {
      expect(s).toMatch(/^[A-Z0-9 .,:()'-]+$/);
      expect(s).not.toMatch(banned);
    }
  });

  it("the plan is stable, sealed at the gate and dressed with banners of the three flags", () => {
    const p = kessarPlan();
    expect(kessarPlan()).toBe(p);
    expect(p.fort.towers.length).toBe(4);
    expect(p.fort.cannons.length).toBeGreaterThanOrEqual(4);
    expect(new Set(p.banners.map((b) => b.kind))).toEqual(new Set(["ward", "syndicate", "society"]));
    expect(p.signs.every((s) => s.text >= 0 && s.text < KESSAR_SIGNS.length)).toBe(true);
    // the wall ring closes: consecutive segments overlap, bastions and the door fill the gate
    const ring = [...p.fort.wall, ...p.fort.bastions, p.fort.door];
    expect(ring.length).toBe(24 - 3 + 2 + 1);
  });

  it("the Kessar palette is dusty, distinct and readable under ink", () => {
    const k = Object.values(PALETTE.kessar);
    expect(new Set(k).size).toBe(k.length);
    for (const c of k) {
      expect(chroma(c)).toBeLessThanOrEqual(c === PALETTE.kessar.lampGold ? 0.6 : 0.4); // (the lamps are light sources: the one saturated colour)
      expect(contrast(PALETTE.ink, c)).toBeGreaterThan(1.6);
      expect(hsl(c)[2]).toBeLessThan(0.95);
    }
  });
});
