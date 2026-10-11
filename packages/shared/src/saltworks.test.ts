import { describe, expect, it } from "vitest";
import { SURFACE, newWorldHit, rayWorld, surfaceOfTag } from "./ballistics.ts";
import type { Obstacle } from "./collision.ts";
import { BUTTON } from "./constants.ts";
import { regionCover } from "./groundCover.ts";
import { createCharState, stepCharacter, yawToWire } from "./movement.ts";
import { SALTMARKET, SALTMARKET_ANCHORS as A, createSaltmarketTerrain, createSaltmarketWorld, saltmarketObstacles, saltmarketPlan, saltmarketSitePoints } from "./saltmarket.ts";
import { SALTMARKET_SIGNS } from "./saltmarketText.ts";
import { BRINE_STATES, SALTWORKS, inSaltworks, saltPanAt, saltworksClear, saltworksObstacles, saltworksPad, saltworksPlan } from "./saltworks.ts";

/** D-121: the Brine Houses' salt works, between the main boardwalk and the Long Cut: one plan the terrain, the colliders, the cover, the fire, the footsteps and the view read. */
const SEEDS = [1, 7, 42, 1234, 99999] as const;
const plan = saltworksPlan();
const L = SALTMARKET.level;

/** Distance from (x, z) to an obstacle's footprint (0 inside it). */
function gap(o: Obstacle, x: number, z: number): number {
  if (o.kind === "circle") return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const lx = (x - o.x) * c + (z - o.z) * s;
  const lz = -(x - o.x) * s + (z - o.z) * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - o.hx), Math.max(0, Math.abs(lz) - o.hz));
}
/** Points round a footprint's edge, and its middle. */
function edge(o: Obstacle): [number, number][] {
  const out: [number, number][] = [[o.x, o.z]];
  if (o.kind === "circle") {
    for (let i = 0; i < 16; i++) out.push([o.x + Math.cos((i / 16) * Math.PI * 2) * o.r, o.z + Math.sin((i / 16) * Math.PI * 2) * o.r]);
    return out;
  }
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  for (let i = 0; i <= 8; i++) for (const [u, v] of [[-1 + i / 4, -1], [-1 + i / 4, 1], [-1, -1 + i / 4], [1, -1 + i / 4]] as const) {
    const lx = u * o.hx, lz = v * o.hz;
    out.push([o.x + lx * c - lz * s, o.z + lx * s + lz * c]);
  }
  return out;
}
const segD = (px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
};
const walkDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const w of saltmarketPlan().boardwalks) for (let i = 0; i + 1 < w.pts.length; i++) best = Math.min(best, segD(x, z, w.pts[i]!, w.pts[i + 1]!));
  return best;
};

describe("D-121: the salt works' plan", () => {
  it("is a reservoir, three rows of condensers, a row of crystallisers and a raked row (one pan lifted), sixteen numbered lots, each pan walled by bunds on all four sides", () => {
    expect(plan.pans).toHaveLength(16);
    expect(plan.pans[0]!.state).toBe("reservoir");
    // north to south the brine thickens: every pan's state is no earlier in the cycle than any pan north of it
    const order = ["reservoir", "green", "olive", "rose", "crust", "raked"];
    const rank = (s: string): number => order.indexOf(s === "lifted" ? "raked" : s);
    for (const a of plan.pans) for (const b of plan.pans) if (b.z0 > a.z1) expect(rank(b.state), `${a.id} -> ${b.id}`).toBeGreaterThanOrEqual(rank(a.state));
    expect(new Set(plan.pans.map((p) => p.state))).toEqual(new Set([...order, "lifted"]));
    expect(plan.pans.map((p) => p.lot)).toEqual(plan.pans.map((_, i) => i + 1));
    for (const p of plan.pans) expect(p.house).toBeGreaterThanOrEqual(0), expect(p.house).toBeLessThan(4);
    const bunds = saltworksObstacles(createSaltmarketTerrain(7)).filter((o) => o.tag === "bund");
    for (const p of plan.pans) {
      // no pan overlaps another; just outside each side's middle stands a bund
      for (const q of plan.pans) if (q !== p) expect(p.x1 <= q.x0 || q.x1 <= p.x0 || p.z1 <= q.z0 || q.z1 <= p.z0, `${p.id} / ${q.id}`).toBe(true);
      const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
      for (const [x, z] of [[p.x0 - 0.1, mz], [p.x1 + 0.1, mz], [mx, p.z0 - 0.1], [mx, p.z1 + 0.1]] as const) expect(bunds.some((b) => gap(b, x, z) === 0), `${p.id} walled at ${x},${z}`).toBe(true);
      expect(saltPanAt(mx, mz)).toBe(p);
    }
    expect(saltPanAt(14, 72)).toBeUndefined();   // (the yard)
    expect(saltPanAt(-20, 40)).toBeUndefined();
    // the raked pans hold their windrows, the yard its four heaps (two thatched), every heap a House's
    for (const w of plan.rows) expect(saltPanAt(w.x, w.z)?.state).toBe("raked");
    expect(plan.heaps).toHaveLength(4);
    expect(plan.heaps.filter((h) => h.capped)).toHaveLength(2);
    expect(new Set(plan.heaps.map((h) => h.house)).size).toBe(4);
    // the notice by the boardwalk is the delta's fifth sign, in the Houses' voice
    expect(saltmarketPlan().signs.some((s) => s.x === plan.sign.x && s.z === plan.sign.z && SALTMARKET_SIGNS[s.text] === "THE HOUSES' PANS. EVERY GRAIN SOLD BEFORE IT IS SALT.")).toBe(true);
  });

  it("keeps clear of the boardwalks, every story point, the revetment and the lanterns, on every seed", () => {
    for (const seed of SEEDS) {
      const w = createSaltmarketWorld(seed);
      const works = saltworksObstacles(w.terrain);
      for (const o of works) {
        const pts = edge(o);
        expect(Math.min(...pts.map(([x, z]) => walkDist(x, z))), `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} by a boardwalk`).toBeGreaterThan(3);
        for (const p of saltmarketSitePoints()) expect(gap(o, p.x, p.z), `${o.tag} by ${p.id}`).toBeGreaterThan(5);
        for (const f of w.obstacles) {
          if (f.tag !== "fence" && !(f.tag === "pole" && !inSaltworks(f.x, f.z))) continue;
          expect(Math.min(...pts.map(([x, z]) => gap(f, x, z))), `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} by ${f.tag} ${f.x.toFixed(1)},${f.z.toFixed(1)} @${seed}`).toBeGreaterThan(1.2);
        }
      }
      // and the towpath between the pans and the Long Cut's revetment stays a path
      const rim = w.obstacles.filter((o) => o.tag === "fence");
      for (let z = SALTWORKS.z0 + 3; z <= SALTWORKS.yardZ1; z += 2) {
        const x = SALTWORKS.x1 + SALTWORKS.bund.base + 0.5;
        expect(Math.min(...rim.map((f) => gap(f, x, z))), `towpath @${z} seed ${seed}`).toBeGreaterThan(1.3);
      }
    }
  });

  it("stands on levelled ground, dry, at the bank's level on every seed (a pan's brine is a sheet a hand deep, not the delta's water)", () => {
    for (const seed of SEEDS) {
      const t = createSaltmarketTerrain(seed);
      for (const p of plan.pans) for (const [x, z] of [[p.x0, p.z0], [p.x1, p.z1], [p.x0, p.z1], [p.x1, p.z0], [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2]] as const) {
        expect(Math.abs(t.height(x, z) - L), `${p.id} @${seed}`).toBeLessThan(0.005);
        expect(t.waterDepth(x, z)).toBe(0);
      }
      for (const h of plan.heaps) expect(Math.abs(t.height(h.x, h.z) - L)).toBeLessThan(0.005);
    }
    expect(saltworksPad(14, 40)).toBe(1);
    expect(saltworksPad(-30, 40)).toBe(0);
  });

  it("is walked: a body steps onto a bund and along it, crosses every pan from the boardwalk to the towpath, and is stopped by a heap", () => {
    const w = createSaltmarketWorld(7);
    // on a bund's line the ground is its top; it pushes nobody
    const b = plan.bunds[3]!;
    expect(w.groundHeight(b.x, b.z, L + 0.3)).toBeCloseTo(L + b.height, 3);
    expect(w.resolveXZ({ x: b.x, z: b.z }, L, 0.4, 1.7)).toBe(false);
    // across the works, west to east, along every row of pans (cross-bunds, windrows and all), and up the works north to south along a column
    const walk = (sx: number, sz: number, tx: number, tz: number, steps: number): { x: number; z: number } => {
      const st = createCharState(sx, sz, w);
      const yaw = yawToWire(Math.atan2(-(tx - sx), -(tz - sz)));
      for (let k = 0; k < steps; k++) stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: 0 }, 1 / 30, w);
      return st;
    };
    for (const p of plan.pans) {
      const z = (p.z0 + p.z1) / 2 + 0.7;
      const end = walk(SALTWORKS.x0 - 3, z, SALTWORKS.x1 + 1.6, z, 30 * 11);
      expect(end.x, `row of ${p.id}`).toBeGreaterThan(SALTWORKS.x1 + 1);
    }
    const end = walk(14.2, SALTWORKS.z0 - 3, 14.2, 68.8, 30 * 20);
    expect(end.z, "north to south down the middle column").toBeGreaterThan(68);
    // a heap is solid to the shoulder: walking at its middle stops a body at its foot
    const h = plan.heaps[1]!;
    const at = walk(h.x, h.z - h.r - 3, h.x, h.z, 30 * 4);
    expect(Math.hypot(at.x - h.x, at.z - h.z)).toBeGreaterThan(h.r * SALTWORKS.heap.lowR + 0.3);
  });

  it("a heap is cover: a round at chest height through it stops in the salt (earth to a bullet), and over a bund it flies on", () => {
    const w = createSaltmarketWorld(7);
    const hit = newWorldHit();
    const h = plan.heaps[1]!;
    expect(rayWorld(w, h.x - 8, L + 1.2, h.z, 1, 0, 0, 16, hit)).toBe(true);
    expect(hit.surface).toBe(SURFACE.EARTH);
    expect(h.x - 8 + hit.t).toBeLessThan(h.x - h.r * 0.5);
    expect(surfaceOfTag("salt")).toBe(SURFACE.EARTH);
    expect(surfaceOfTag("bund")).toBe(SURFACE.EARTH);
    // a standing man's chest over the pans: nothing in the way from the boardwalk to the towpath
    expect(rayWorld(w, SALTWORKS.x0 - 2, L + 1.3, 40, 1, 0, 0, SALTWORKS.x1 - SALTWORKS.x0 + 3, hit)).toBe(false);
  });

  it("is a firebreak: nothing grows in a worked pan or the yard (no fuel, no reeds), and the plain beyond is untouched", () => {
    const w = createSaltmarketWorld(7);
    for (const p of plan.pans) expect(regionCover("saltmarket", w, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2), p.id).toBe(0);
    for (const h of plan.heaps) expect(regionCover("saltmarket", w, h.x, h.z)).toBe(0);
    expect(saltworksClear(SALTWORKS.x1 + 6, 40)).toBe(0);
    expect(saltworksClear(-10, 40)).toBe(0);
    expect(BRINE_STATES).toEqual(["reservoir", "green", "olive", "rose"]);
  });

  it("is appended after the rest of the delta: the obstacles before it are the delta's as they were, and the pump stands in line with the cove's derrick from the boardwalk (a hair that shuts no more of the horizon)", () => {
    for (const seed of SEEDS) {
      const t = createSaltmarketTerrain(seed);
      const all = saltmarketObstacles(t, seed);
      const works = saltworksObstacles(t);
      expect(all.slice(all.length - works.length)).toEqual(works);
      expect(all.slice(0, all.length - works.length).some((o) => o.tag === "bund" || o.tag === "salt")).toBe(false);
      expect(all.length).toBeLessThan(420);
    }
    const bin = (x: number, z: number): number => Math.floor(((Math.atan2(x - A.walk[3].x, -(z - A.walk[3].z)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 72);
    const derrick = saltmarketPlan().hairs.find((h) => h.kind === "derrick")!;
    expect(bin(plan.pump.x, plan.pump.z)).toBe(bin(derrick.x, derrick.z));
  });
});
