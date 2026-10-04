import { HIGHMARK, hillPoint, highmarkPlan, type HighmarkBanner } from "./shared.ts";

/** The only thing the skyline asks of the world: how high the ground is. */
export interface Ground {
  terrainHeight(x: number, z: number): number;
}

/**
 * The capital's SKYLINE as data (package P, D-037): what stands above the roofs of Highmark's hill and where. The view's geometry (structures.ts) and its banners (cloth.ts) are built from
 * these numbers, and `skyline.test.ts` reads the same numbers to prove the picture has what the data says (a spire that is listed is a spire that is drawn). View-only: no collider, no plan
 * change (the plan in highmark.ts is frozen); everything here stands on top of what the plan already has.
 *
 * The problem it answers (BUILD_STATE: "the capital washes into the haze"): from the landing the hill is 200 m away and the exponential fog is ~95% of every pixel, so a low chalk skyline
 * of boxes and cones has no edge left. The answer is height and contrast, not more volume: a lit tower over the palace, pinnacles, taller bell-gable, stepped ridges, cloth that moves,
 * and (landmark.ts) a share of the colour the fog would take back.
 */

/** Heights above the palace's ground (m), from the plan: the base, tier two, tier three and the ridge of the roof over it. */
export function palaceHeights(): { base: number; t2: number; t3: number; capTop: number; ridge: number } {
  const b = highmarkPlan().palace;
  const t2 = 4.2;
  const t3 = 3.2;
  return { base: b.height, t2, t3, capTop: b.height + t2 + t3, ridge: b.height + t2 + t3 + 0.05 + 2.4 };
}

/** The lit tower's measure (palace-local: x east of the palace's centre, z south, y above the palace's ground). It stands on tier two, in place of that end's roof. */
export const LANTERN_TOWER = {
  /** Offset from the palace's centre (x west of it, z) of the tower's axis. */
  dx: -5.7,
  dz: -0.2,
  half: 1.3,
  shaft: 9.6,
  /** The glazed lantern room above the gallery. */
  room: 3.0,
  cap: 3.0,
  spire: 3.4,
} as const;

/** The bell-gable above the ridge: posts, then a roof and a finial (it was 2.8 m of posts and a 2.4 m roof). */
export const BELL_GABLE = { posts: 4.2, cap: 3.0, finial: 0.2 } as const;

/** Banner masts at the palace's base corners and the pinnacles on tier two. */
export const PALACE_MAST = { inset: 0.5, height: 8.6 } as const;
export const TIER2_PINNACLE = { inset: 0.35, plinth: 0.8, spire: 2.4 } as const;
/** The masts on the gate towers: from the pyramid's finial up. */
export const GATE_MAST = { height: 6.2 } as const;
/** The terrace masts: a pole standing on a riser's coping, and the cloth it flies. */
export const TERRACE_MAST = { height: 6.6, banner: { w: 1.9, h: 3.6 } } as const;
/**
 * How far in front of its pole a free-standing banner hangs (the terrace masts' and the plan's Grange and Syndicate poles): the cloth hangs from a yard on a short arm, so the pole stands
 * behind it and never runs through it. The yard is drawn in structures.ts at the cloth's plane.
 */
export const POLE_FRONT = 0.2;
/** Where the yard a banner hangs from sits in front of its pole's axis: the cloth's own plane (the cloth is drawn 2 cm in front of the banner's point). */
export const yardFront = (front: number): number => front + 0.02;

/** A banner whose (x, z) is its pole's, moved to hang `POLE_FRONT` in front of the pole along its face; `top` stays the same height in the world. */
export function offPole(b: HighmarkBanner, world: Ground): HighmarkBanner {
  const x = b.x + Math.cos(b.yaw) * POLE_FRONT;
  const z = b.z + Math.sin(b.yaw) * POLE_FRONT;
  return { ...b, x, z, top: b.top + world.terrainHeight(b.x, b.z) - world.terrainHeight(x, z) };
}

export interface Spire {
  name: string;
  x: number;
  z: number;
  /** World y of the foot and of the tip. */
  base: number;
  top: number;
}

const palaceGround = (world: Ground): { x: number; z: number; gy: number } => {
  const b = highmarkPlan().palace;
  return { x: b.x, z: b.z, gy: world.terrainHeight(b.x, b.z) };
};

/** The terrace masts: which riser, where, how high it stands. Chosen off the ramps (a mast in a ramp's mouth would be in the way of nothing but the eye) and where the south approach sees them. */
export function terraceMasts(): { riser: number; x: number; z: number; base: number; kind: HighmarkBanner["kind"]; yaw: number }[] {
  const out: { riser: number; x: number; z: number; base: number; kind: HighmarkBanner["kind"]; yaw: number }[] = [];
  // the four outer risers (granary, market, guild, court terrace), two masts each, either side of the riser's ramp
  const kinds: HighmarkBanner["kind"][] = ["grange", "syndicate", "crown", "crown"];
  for (let i = 0; i < 4; i++) {
    for (const off of [-24, 24]) {
      const p = hillPoint(HIGHMARK.radii[i]!, HIGHMARK.rampDeg[i]! + off);
      // the riser holds up terrace i + 1: the mast stands on the top of its parapet
      out.push({ riser: i, x: p.x, z: p.z, base: HIGHMARK.heights[i + 1]! + HIGHMARK.parapet + 0.2, kind: kinds[i]!, yaw: -p.th + Math.PI / 2 });
    }
  }
  return out;
}

/** Every vertical feature the capital stands on its skyline, in world coordinates: the lit tower, the bell-gable, the palace's masts and pinnacles, the gate's masts. */
export function capitalSpires(world: Ground): Spire[] {
  const plan = highmarkPlan();
  const { x, z, gy } = palaceGround(world);
  const H = palaceHeights();
  const b = plan.palace;
  const out: Spire[] = [];
  const T = LANTERN_TOWER;
  const towerBase = gy + H.base + H.t2 + 0.28;
  out.push({ name: "lantern-tower", x: x + T.dx, z: z + T.dz, base: towerBase, top: towerBase + T.shaft + 0.3 + T.room + T.cap + T.spire + 0.2 });
  out.push({ name: "bell-gable", x, z: z - 0.4, base: gy + H.ridge, top: gy + H.ridge + BELL_GABLE.posts + 0.2 + BELL_GABLE.cap + 0.05 + BELL_GABLE.finial });
  for (const sx of [-1, 1] as const) {
    out.push({ name: `palace-mast-${sx < 0 ? "w" : "e"}`, x: x + sx * (b.hx - PALACE_MAST.inset), z: z + b.hz - PALACE_MAST.inset, base: gy + H.base, top: gy + H.base + PALACE_MAST.height });
  }
  const t2 = { hx: b.hx * 0.72, hz: b.hz * 0.75 };
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) {
    const P = TIER2_PINNACLE;
    out.push({ name: `tier2-pinnacle-${sx < 0 ? "w" : "e"}${sz < 0 ? "n" : "s"}`, x: x + sx * (t2.hx - P.inset), z: z - 0.2 + sz * (t2.hz - P.inset), base: gy + H.base + H.t2, top: gy + H.base + H.t2 + P.plinth + P.spire + 0.2 });
  }
  for (const [i, t] of plan.gate.towers.entries()) {
    const ty = world.terrainHeight(t.x, t.z);
    out.push({ name: `gate-mast-${i === 0 ? "w" : "e"}`, x: t.x, z: t.z, base: ty + t.height + 0.05 + 4.2, top: ty + t.height + 0.05 + 4.2 + 0.2 + GATE_MAST.height });
  }
  return out;
}

/** The cloth the skyline adds (the plan's own banners stay): bigger on the gate and the palace, one on every terrace mast. `top` is above the ground at (x, z) like the plan's. */
export function skylineBanners(world: Ground): HighmarkBanner[] {
  const plan = highmarkPlan();
  const out: HighmarkBanner[] = [];
  const g = plan.gate;
  out.push(...lintelBanners(world));
  // the gate towers' masts
  for (const t of g.towers) {
    const ty = world.terrainHeight(t.x, t.z);
    out.push({ x: t.x, z: t.z + 0.1, yaw: Math.PI / 2, top: t.height + 0.05 + 4.2 + 0.2 + GATE_MAST.height - 0.4, w: 2.6, h: 5.4, kind: "crown" });
    void ty;
  }
  // the palace's corner masts: a banner each, taller than the plan's single one
  const { gy } = palaceGround(world);
  const b = plan.palace;
  for (const sx of [-1, 1]) {
    const px = b.x + sx * (b.hx - PALACE_MAST.inset);
    const pz = b.z + b.hz - PALACE_MAST.inset;
    out.push({ x: px, z: pz + 0.1, yaw: Math.PI / 2, top: gy + palaceHeights().base + PALACE_MAST.height - 0.4 - world.terrainHeight(px, pz + 0.1), w: 2.8, h: 6.2, kind: "crown" });
  }
  for (const m of terraceMasts()) out.push(offPole({ x: m.x, z: m.z, yaw: m.yaw, top: m.base + TERRACE_MAST.height - 0.4 - world.terrainHeight(m.x, m.z), w: TERRACE_MAST.banner.w, h: TERRACE_MAST.banner.h, kind: m.kind }, world));
  return out;
}

/** The lintel's two big Crown banners, hung from its face (on an iron rod, structures.ts) clear of the arch, so the gate has colour from the plain. */
export function lintelBanners(world: Ground): HighmarkBanner[] {
  const g = highmarkPlan().gate;
  const l = g.lintel;
  return [-1, 1].map((sx): HighmarkBanner => ({ x: sx * (l.hx - 1.5), z: l.z + l.hz + 0.12, yaw: Math.PI / 2, top: g.y - world.terrainHeight(sx * (l.hx - 1.5), l.z + l.hz + 0.12) + 6.0, w: 2.6, h: 2.4, kind: "crown" }));
}
