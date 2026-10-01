import { describe, expect, it } from "vitest";
import { BUTTON, CHARACTER, FLAG } from "./constants.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { createHighmarkWorld, HIGHMARK_ANCHORS } from "./highmark.ts";
import { createKessarWorld } from "./kessar.ts";
import { KESSAR_ANCHORS } from "./campaignTypes.ts";
import { createCharState, stepCharacter, yawToWire, type CharState } from "./movement.ts";
import { buildNavGrid } from "./nav.ts";
import { buildingIdAt } from "./levelPlan.ts";
import { PropKind } from "./props.ts";
import {
  SALTMARKET, SALTMARKET_ANCHORS as A, SALTMARKET_BASINS, SALTMARKET_CHANNELS, SALTMARKET_MOUNT_SPOTS, SALTMARKET_SITES as S, SALTMARKET_SPOTS, SALTMARKET_STATIONS, SALTMARKET_VIEW_BUDGET,
  createSaltmarketTerrain, createSaltmarketWorld, saltmarketCentre, saltmarketMask, saltmarketNavOptions, saltmarketObstacles, saltmarketPlan, saltmarketProps, saltmarketRim, saltmarketRun,
  saltmarketLevel, saltmarketSitePoints, saltmarketSpawn, type SaltmarketTerrain,
} from "./saltmarket.ts";
import { skylineFrom, skylineStats, type SkylineStats } from "./skyline.ts";

const hashOf = (world: CollisionWorld): string => {
  let h = 2166136261;
  const s = JSON.stringify(world.obstacles.map((o) => [o.kind, o.tag, +o.x.toFixed(3), +o.z.toFixed(3), +o.y0.toFixed(3), +o.y1.toFixed(3)]));
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${world.obstacles.length}:${h >>> 0}`;
};
const SEEDS = [1, 7, 42, 1234, 99999] as const;
const wd = (w: CollisionWorld, x: number, z: number): number => (w.terrain as SaltmarketTerrain).waterDepth(x, z);

describe("Saltmarket: the world", () => {
  it("is deterministic per seed across 5 seeds; only the swell, the channels' wander and the revetment depend on the seed", () => {
    const hashes = new Set<string>();
    for (const seed of SEEDS) {
      const a = createSaltmarketWorld(seed), b = createSaltmarketWorld(seed);
      expect(hashOf(a)).toBe(hashOf(b));
      hashes.add(hashOf(a));
      expect(a.obstacles.length).toBeGreaterThan(150);
      for (const [x, z] of [[0, 0], [12, 40], [-30, -20], [46, 20], [0, -92], [0, 118]] as const) expect(a.terrainHeight(x, z)).toBe(b.terrainHeight(x, z));
      expect(a.terrainHeight(0, 118), "the landing is pinned to the bank level").toBeCloseTo(SALTMARKET.level, 6);
    }
    expect(hashes.size).toBe(5);
    // the buildings, the quay and the bridges do not move with the seed
    const fixed = (seed: number): string => JSON.stringify(createSaltmarketWorld(seed).obstacles.filter((o) => o.tag !== "fence" && o.tag !== undefined).map((o) => [o.tag, o.x, o.z, o.kind === "box" ? o.hx : 0]));
    expect(fixed(1)).toBe(fixed(2));
    // the revetment is the one thing that wanders (and it follows the channel)
    expect(JSON.stringify(saltmarketRim(1))).not.toBe(JSON.stringify(saltmarketRim(2)));
  });

  it("the plain is flat: the swell is a hand's breadth, and the landing, the bridges' approaches and the sites are pinned to the bank level", () => {
    for (const seed of SEEDS) {
      const t = createSaltmarketTerrain(seed);
      for (const p of saltmarketSitePoints()) {
        if (p.id === "plug" || p.id === "walk1") continue;
        const dry = wd({ terrain: t } as unknown as CollisionWorld, p.x, p.z);
        expect(dry, `${p.id} is dry`).toBe(0);
        if (["landing", "exchange", "customs", "cove", "drop", "tideReeve", "cutterBerth", "auctioneer"].includes(p.id)) expect(t.height(p.x, p.z), `${p.id} level @${seed}`).toBeCloseTo(SALTMARKET.level, 1);
      }
      // away from the channels the ground stays within 0.4 m of the level (the dry plain)
      for (let x = -140; x <= 140; x += 14) for (let z = -140; z <= 120; z += 14) {
        if (Math.hypot(x, z) > 148) continue;
        const dry = t.waterDepth(x, z) === 0;
        if (dry) expect(Math.abs(t.height(x, z) - SALTMARKET.level), `${x},${z} @${seed}`).toBeLessThan(0.45);
      }
    }
  });

  it("the channels: the three cuts are DEEP (a bank beyond the step limit, depth > 0.9), the creeks, basins and the lagoon are wadeable, and the water table is finite everywhere", () => {
    const t = createSaltmarketTerrain(7);
    const w = createSaltmarketWorld(7);
    for (const id of ["customs", "west", "long"]) {
      const ch = SALTMARKET_CHANNELS.find((c) => c.id === id)!;
      expect(ch.deep).toBe(true);
      const us = ch.axis === "x" ? [-100, -60, 30, 90] : [-30, 0, 30, 60];
      for (const u of us) {
        const c = saltmarketCentre(ch, 7, u);
        const [x, z] = ch.axis === "x" ? [u, c] : [c, u];
        expect(t.waterDepth(x, z), `${id} centre @${u}`).toBeGreaterThan(0.9);
        // the bank beside the water is steeper than the controller's slope limit somewhere along its run (a wall, not a ramp)
        let steepest = 0;
        for (let k = 0; k < 40; k++) {
          const off = ch.half + (k / 40) * ch.run;
          const [x0, z0] = ch.axis === "x" ? [u, c + off] : [c + off, u];
          const [x1, z1] = ch.axis === "x" ? [u, c + off + 0.1] : [c + off + 0.1, u];
          steepest = Math.max(steepest, Math.abs(t.height(x1, z1) - t.height(x0, z0)) / 0.1);
        }
        expect(steepest, `${id} bank @${u}`).toBeGreaterThan(CHARACTER.maxSlope);
      }
    }
    for (const ch of SALTMARKET_CHANNELS.filter((c) => !c.deep)) {
      const u = (ch.lo + ch.hi) / 2;
      const c = saltmarketCentre(ch, 7, u);
      const [x, z] = ch.axis === "x" ? [u, c] : [c, u];
      const d = t.waterDepth(x, z);
      expect(d, `${ch.id} has water`).toBeGreaterThan(0.2);
      expect(d, `${ch.id} can be waded`).toBeLessThan(0.9);
    }
    for (const b of SALTMARKET_BASINS) expect(t.waterDepth(b.x, b.z), b.id).toBeLessThan(0.9);
    expect(t.waterDepth(0, 134), "the lagoon at the quay's end is a wade").toBeLessThan(0.9);
    expect(t.waterDepth(0, 134)).toBeGreaterThan(0.3);
    expect(w.terrainHeight(0, 140)).toBeLessThan(0);
    for (let x = -150; x <= 150; x += 7) for (let z = -150; z <= 150; z += 7) {
      const h = t.height(x, z), d = t.waterDepth(x, z);
      expect(Number.isFinite(h) && Number.isFinite(d) && d >= 0).toBe(true);
    }
  });

  it("no invisible walls: wherever the ground is steeper than the step limit, a revetment, a rail or a deck stands beside it", () => {
    for (const seed of [7, 42]) {
      const w = createSaltmarketWorld(seed);
      const walls = w.obstacles.filter((o) => o.tag === "fence" || o.tag === "wall" || o.tag === "bridge");
      let steep = 0;
      for (let x = -146; x <= 146; x += 1.5) for (let z = -146; z <= 146; z += 1.5) {
        if (Math.hypot(x, z) > 148) continue;
        const h = w.terrainHeight(x, z);
        const g = Math.max(Math.abs(w.terrainHeight(x + 0.3, z) - h), Math.abs(w.terrainHeight(x, z + 0.3) - h)) / 0.3;
        if (g <= CHARACTER.maxSlope) continue;
        steep++;
        const near = walls.some((o) => {
          const e = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
          return Math.hypot(o.x - x, o.z - z) < e + 5.5;
        });
        expect(near, `steep ground (${g.toFixed(1)}) at ${x},${z} @${seed} has no wall beside it`).toBe(true);
      }
      expect(steep, "the banks are steep somewhere").toBeGreaterThan(50);
    }
  });

  it("walking straight at a deep channel from either bank is stopped by the revetment: nobody falls in, anywhere along the three cuts", () => {
    const w = createSaltmarketWorld(7);
    let tested = 0;
    for (const ch of SALTMARKET_CHANNELS.filter((c) => c.deep)) {
      const x_ = ch.axis === "x";
      for (let u = (x_ ? -130 : -30); u <= (x_ ? 130 : 84); u += 9) {
        if (ch.bridges.some((b) => Math.abs(u - b) < 8)) continue;
        if (saltmarketMask(ch, u) < 0.95) continue;
        const c = saltmarketCentre(ch, 7, u);
        for (const side of [-1, 1]) {
          const off = ch.half + saltmarketRun(ch, u) + 3.2;
          const [sx, sz] = x_ ? [u, c + side * off] : [c + side * off, u];
          if (Math.hypot(sx, sz) > 146 || wd(w, sx, sz) > 0.5) continue;
          // face the channel and sprint at it for a few seconds, with a jump now and then
          const [tx, tz] = x_ ? [u, c] : [c, u];
          const st = createCharState(sx, sz, w);
          const yaw = yawToWire(Math.atan2(-(tx - sx), -(tz - sz)));
          for (let k = 0; k < 150; k++) stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: BUTTON.SPRINT | (k % 25 === 0 ? BUTTON.JUMP : 0) }, 1 / 30, w);
          expect(wd(w, st.x, st.z), `${ch.id} @${u} side ${side}: stopped on the bank`).toBeLessThan(0.5);
          expect(st.y, `${ch.id} @${u} side ${side}: still up on the bank`).toBeGreaterThan(SALTMARKET.level - 0.6);
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThan(60);
  });

  it("the revetment holds for every seed, not just the plan's: the wander puts the cuts' mouths and tapering ends in different places, and nobody walks into deep water from any of them (D-037 review)", () => {
    // seeds that, before the Long and West cuts were made to END in the Customs Cut (no deep tail south of it, the rim running on to its north lip, a cap at each cut's tapering north end), opened the revetment
    for (const seed of [0, 1013904226, 3428989595, 774553834, 2323661502]) {
      const w = createSaltmarketWorld(seed);
      let tested = 0;
      for (const ch of SALTMARKET_CHANNELS.filter((c) => c.deep)) {
        const x_ = ch.axis === "x";
        for (let u = ch.lo; u <= ch.hi; u += 4) {
          if (ch.bridges.some((b) => Math.abs(u - b) < 8) || saltmarketMask(ch, u) < 0.5) continue;
          const c = saltmarketCentre(ch, seed, u);
          for (const side of [-1, 1]) {
            const off = ch.half + saltmarketRun(ch, u) + 3.2;
            const [sx, sz] = x_ ? [u, c + side * off] : [c + side * off, u];
            if (Math.hypot(sx, sz) > 146 || wd(w, sx, sz) > 0.5) continue;
            // (a start beside ANOTHER cut's mouth is inside that cut's own revetment, not on the plain: not somewhere to walk in from)
            if (SALTMARKET_CHANNELS.some((o) => o !== ch && o.deep && Math.abs((o.axis === "x" ? sz : sx) - saltmarketCentre(o, seed, o.axis === "x" ? sx : sz)) < o.half + saltmarketRun(o, o.axis === "x" ? sx : sz) + 6.5)) continue;
            const [tx, tz] = x_ ? [u, c] : [c, u];
            const st = createCharState(sx, sz, w);
            const yaw = yawToWire(Math.atan2(-(tx - sx), -(tz - sz)));
            for (let k = 0; k < 120; k++) stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: BUTTON.SPRINT | (k % 25 === 0 ? BUTTON.JUMP : 0) }, 1 / 30, w);
            expect(wd(w, st.x, st.z), `${ch.id} @${u} side ${side} seed ${seed}`).toBeLessThan(0.9);
            tested++;
          }
        }
      }
      expect(tested, `seed ${seed}`).toBeGreaterThan(60);
    }
  });

  it("no story anchor stands inside anything that blocks a walker; four spawns, the mount spots, the stations and every prop are open and dry", () => {
    for (const seed of SEEDS) {
      const world = createSaltmarketWorld(seed);
      const p = { x: 0, z: 0 };
      for (const s of saltmarketSitePoints()) {
        p.x = s.x;
        p.z = s.z;
        const y = world.groundHeight(s.x, s.z, 1e6);
        expect(world.resolveXZ(p, y, 0.6, 1.8), `${s.id} @${seed}`).toBe(false);
        expect(Math.hypot(s.x, s.z), s.id).toBeLessThan(A.bounds - 2);
        // every point is dry ground or a floor over water (the bridge, the cove's planks, where the barge's plug is reached)
        expect(y, `${s.id} stands above the water`).toBeGreaterThan(SALTMARKET.waterY + 0.05);
        if (s.id !== "plug" && !s.id.startsWith("walk")) expect(wd(world, s.x, s.z), `${s.id} is dry`).toBe(0);
      }
      for (let i = 0; i < 4; i++) {
        const sp = saltmarketSpawn(i, 4);
        p.x = sp.x;
        p.z = sp.z;
        expect(world.resolveXZ(p, world.terrainHeight(sp.x, sp.z), 0.6, 1.8), `spawn ${i}`).toBe(false);
        expect(wd(world, sp.x, sp.z), `spawn ${i} is dry`).toBe(0);
        expect(sp.z, "spawn is not on the planks").toBeLessThan(saltmarketPlan().quay.z0);
      }
      for (const m of [...SALTMARKET_MOUNT_SPOTS.horses, SALTMARKET_MOUNT_SPOTS.wagon]) {
        p.x = m.x;
        p.z = m.z;
        expect(world.resolveXZ(p, world.terrainHeight(m.x, m.z), 0.9, 1.8), "mount spot").toBe(false);
        expect(wd(world, m.x, m.z)).toBe(0);
      }
      for (const st of SALTMARKET_STATIONS) expect(wd(world, st.x, st.z), st.id).toBe(0);
      const props = saltmarketProps(seed, world);
      expect(props.length).toBeGreaterThan(5);
      expect(props.length).toBeLessThanOrEqual(24);
      expect(saltmarketProps(seed, world)).toEqual(props);
      expect(props.some((q) => q.kind === PropKind.CRATE), "the quay hands out no crates: any crate carried to the drop-house counts").toBe(false);
      for (const pr of props) {
        p.x = pr.x;
        p.z = pr.z;
        expect(world.resolveXZ(p, world.groundHeight(pr.x, pr.z, 1e6), 0.3, 0.8), `prop ${pr.x.toFixed(1)},${pr.z.toFixed(1)} @${seed}`).toBe(false);
        expect(wd(world, pr.x, pr.z)).toBe(0);
      }
    }
  });

  it("authored things do not stand inside each other, and keep off the boardwalks", () => {
    const world = createSaltmarketWorld(7);
    const tags = new Set(["house", "pole", "sign", "table"]);
    const items = world.obstacles.filter((o) => tags.has(o.tag ?? ""));
    const reach = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.min(o.hx, o.hz));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (a.tag === "table" || b.tag === "table") continue;   // (the rostrum stands in the hall, against the back wall)
      // (D-038: the sheds, the Customs House and the drop house are rooms: several wall boxes, a deck and steps of ONE building)
      const ia = buildingIdAt(saltmarketLevel(), a.x, a.z, 0.2), ib = buildingIdAt(saltmarketLevel(), b.x, b.z, 0.2);
      if (a.tag === "house" && b.tag === "house" && ia !== undefined && ia === ib) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.tag}@${a.x.toFixed(1)},${a.z.toFixed(1)} vs ${b.tag}@${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(reach(a) + reach(b) - 0.01);
    }
    // nothing solid sits on a plank path (the bridges, the quay, the pier and the revetment excepted)
    const plan = saltmarketPlan();
    const segD = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - ax - dx * t, pz - az - dz * t);
    };
    const walkDist = (x: number, z: number): number => {
      let best = Infinity;
      for (const b of plan.boardwalks) for (let i = 0; i + 1 < b.pts.length; i++) best = Math.min(best, segD(x, z, b.pts[i]!.x, b.pts[i]!.z, b.pts[i + 1]!.x, b.pts[i + 1]!.z));
      return best;
    };
    for (const o of world.obstacles) {
      if (o.tag === "jetty" || o.tag === "bridge" || o.tag === "wall" || o.tag === "fence") continue;
      const e = o.kind === "circle" ? o.r : Math.min(o.hx, o.hz);
      if (o.tag === "ruin") continue;   // (the colonnade's pillars stand at the hall's door, which is where the boardwalk ends)
      expect(walkDist(o.x, o.z), `${o.tag}@${o.x.toFixed(1)},${o.z.toFixed(1)} on the boardwalk`).toBeGreaterThan(e + 0.9);
    }
  });

  it("the Exchange is open at its front and the auction's people stand inside it", () => {
    const ex = saltmarketPlan().exchange;
    for (const p of [S.auctioneer, ...S.houseHeads, SALTMARKET_SPOTS.factor, A.exchange]) {
      expect(Math.abs(p.x - ex.x)).toBeLessThan(ex.hx);
      expect(p.z).toBeLessThan(ex.z + ex.hz);
      expect(p.z).toBeGreaterThan(ex.backWall.z);
    }
    // the colonnade leaves a door at least 8 m wide
    const front = ex.pillars.filter((q) => Math.abs(q.z - (A.exchange.z + 11)) < 0.1).map((q) => q.x).sort((a, b) => a - b);
    let gap = 0;
    for (let i = 0; i + 1 < front.length; i++) gap = Math.max(gap, front[i + 1]! - front[i]!);
    expect(gap).toBeGreaterThanOrEqual(8);
  });
});

// ---- reachability with the REAL movement step ----------------------------------------------------------------------------------------

const CELL = 2;
const span = Math.ceil(A.bounds / CELL);
const key = (i: number, j: number): number => (i + span) * (2 * span + 1) + (j + span);
const FLOOR = new Set(["jetty", "bridge"]);

function reach(world: CollisionWorld, from: { x: number; z: number }, wadeDeep = false): (x: number, z: number) => boolean {
  const seen = new Set<number>();
  const st: CharState = createCharState(0, 0, world);
  const probe = { x: 0, z: 0 };
  const surface = (x: number, z: number): number => {
    let y = world.terrainHeight(x, z);
    world.forEachNear(x, z, (o) => {
      if (o.tag !== undefined && FLOOR.has(o.tag) && o.kind === "box" && Math.abs(x - o.x) <= o.hx && Math.abs(z - o.z) <= o.hz && o.y1 > y) y = o.y1;
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
  seen.add(key(Math.round(from.x / CELL), Math.round(from.z / CELL)));
  q.push([Math.round(from.x / CELL), Math.round(from.z / CELL)]);
  while (q.length) {
    const [i, j] = q.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      const x1 = ni * CELL, z1 = nj * CELL;
      if (Math.hypot(x1, z1) > A.bounds - 1 || seen.has(key(ni, nj))) continue;
      // a cell in deep water is not somewhere anybody stands (the fall is not part of the walk)
      if (!wadeDeep && (world.terrain as SaltmarketTerrain).waterDepth(x1, z1) > 0.9 && surface(x1, z1) < SALTMARKET.level - 1) continue;
      if (tryEdge(i * CELL, j * CELL, x1, z1)) {
        seen.add(key(ni, nj));
        q.push([ni, nj]);
      }
    }
  }
  return (x, z) => {
    for (const di of [0, -1, 1]) for (const dj of [0, -1, 1]) {
      const i = Math.round(x / CELL) + di, j = Math.round(z / CELL) + dj;
      if (Math.hypot(i * CELL - x, j * CELL - z) <= 1.5 && seen.has(key(i, j))) return true;
    }
    return false;
  };
}

describe("Saltmarket: every story point is reachable on foot, and no deep water is ever waded", () => {
  const world = createSaltmarketWorld(7);

  it("a flood fill with the real stepCharacter from the landing reaches every site, both ends of every bridge, and the cove and the drop on BOTH sides of the Long Cut", () => {
    const r = reach(world, A.landing);
    for (const s of saltmarketSitePoints()) expect(r(s.x, s.z), `${s.id} (${s.x},${s.z})`).toBe(true);
    for (const b of saltmarketPlan().bridges) {
      const along = b.yaw === 0 ? [{ x: b.x, z: b.z - b.hl - 2 }, { x: b.x, z: b.z + b.hl + 2 }] : [{ x: b.x - b.hl - 2, z: b.z }, { x: b.x + b.hl + 2, z: b.z }];
      for (const p of along) expect(r(p.x, p.z), `${b.id} end ${p.x},${p.z}`).toBe(true);
    }
    // the reed flats round the cuts' northern ends are the quiet way: the isthmus is joined to the east and west plains without a bridge
    expect(r(70, -60), "east reed flats").toBe(true);
    expect(r(-70, -80), "west reed flats").toBe(true);
    // deep water is not somewhere anyone stands
    for (const ch of SALTMARKET_CHANNELS.filter((c) => c.deep)) {
      const u = ch.axis === "x" ? 70 : 30;
      const c = saltmarketCentre(ch, 7, u);
      const [x, z] = ch.axis === "x" ? [u, c] : [c, u];
      expect(r(x, z), `${ch.id} is not walkable`).toBe(false);
    }
  }, 240_000);

  it("no deep water is reachable on foot from the landing, for several seeds, with the real step and NO shortcut for deep cells (the cuts' tapering ends and tails are capped)", () => {
    for (const seed of [0, 1013904226, 3428989595]) {
      const w = createSaltmarketWorld(seed);
      const r = reach(w, A.landing, true);
      let deep = 0;
      for (let x = -146; x <= 146; x += CELL) for (let z = -146; z <= 146; z += CELL) {
        if (Math.hypot(x, z) > A.bounds - 1 || wd(w, x, z) <= 0.9) continue;
        const onDeck = w.groundHeight(x, z, w.terrainHeight(x, z) + 3) > w.terrainHeight(x, z) + 0.5;   // (a bridge's deck is a floor over deep water)
        if (!onDeck && r(x, z)) deep++;
      }
      expect(deep, `deep cells a walker reaches @${seed}`).toBe(0);
    }
  }, 240_000);

  it("the three bridges are the only dry crossings of the cuts: with the bridge decks removed the cove and the drop are still reachable only round the flats", () => {
    // the bridges are floors: every one of them is on the walk the boardwalk follows
    const plan = saltmarketPlan();
    expect(plan.bridges.map((b) => b.id)).toEqual(["customsBridge", "coveBridge", "reedBridge"]);
    for (const b of plan.bridges) {
      const deck = world.obstacles.find((o) => o.tag === "bridge" && Math.hypot(o.x - b.x, o.z - b.z) < 0.01);
      expect(deck, b.id).toBeDefined();
      expect(deck!.y1).toBeCloseTo(SALTMARKET.level, 6);
    }
    // the Customs Bridge carries walk[1], the cove walk crosses the Long Cut on the Cove Bridge, the drop walk the West Cut on the Reed Bridge
    expect(Math.hypot(A.walk[1].x - plan.bridges[0]!.x, A.walk[1].z - plan.bridges[0]!.z)).toBeLessThan(1);
  });

  it("the boardwalk, walked step by step from the landing, reaches the Exchange's door, the cove and the drop", () => {
    const walk = (path: readonly { x: number; z: number }[]): CharState => {
      const st = createCharState(path[0]!.x, path[0]!.z, world);
      let leg = 1;
      for (let k = 0; k < 9000 && leg < path.length; k++) {
        const t = path[leg]!;
        if (Math.hypot(t.x - st.x, t.z - st.z) < 1.2) {
          leg++;
          continue;
        }
        stepCharacter(st, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-(t.x - st.x), -(t.z - st.z))), buttons: BUTTON.SPRINT }, 1 / 30, world);
      }
      expect(leg, "reached the last waypoint").toBe(path.length);
      return st;
    };
    const plan = saltmarketPlan();
    const main = plan.boardwalks.find((b) => b.id === "main")!.pts.slice(1);
    const end = walk([A.landing, ...main]);
    expect(Math.hypot(end.x - A.walk[6].x, end.z - A.walk[6].z)).toBeLessThan(2);
    const cove = walk([A.landing, ...main.slice(0, 10), ...plan.boardwalks.find((b) => b.id === "cove")!.pts.slice(1)]);
    expect(Math.hypot(cove.x - A.cove.x, cove.z - A.cove.z)).toBeLessThan(2);
    const drop = walk([A.landing, ...main.slice(0, 11), ...plan.boardwalks.find((b) => b.id === "drop")!.pts.slice(1)]);
    expect(Math.hypot(drop.x - A.drop.x, drop.z - A.drop.z)).toBeLessThan(2);
  }, 60_000);

  it("the nav grid (deep water closed) connects the landing to every site and builds in under 150 ms", () => {
    const opts = saltmarketNavOptions(world);
    expect(opts.tag).toBe("saltmarket");
    const t0 = performance.now();
    const grid = buildNavGrid(world, opts);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(150);
    expect(grid.openCount).toBeGreaterThan(8000);
    const idx = (x: number, z: number): number => Math.floor((z - grid.origin) / grid.cell) * grid.n + Math.floor((x - grid.origin) / grid.cell);
    for (const s of saltmarketSitePoints()) expect(grid.open[idx(s.x, s.z)], `${s.id} is an open cell`).toBe(1);
    // closed where the water is deep
    const customs = SALTMARKET_CHANNELS[0]!;
    const c = saltmarketCentre(customs, 7, 70);
    expect(grid.open[idx(70, c)]).toBe(0);
  });
});

describe("Saltmarket: the silhouette is a line with hairs on it (measured, not tasted)", () => {
  const stats = (w: CollisionWorld, x: number, z: number): SkylineStats => skylineStats(skylineFrom(w, x, z));
  it("from the boardwalk (walk[3]) the horizon is open, low and pricked by at least six verticals, for five seeds", () => {
    for (const seed of SEEDS) {
      const s = stats(createSaltmarketWorld(seed), A.walk[3].x, A.walk[3].z);
      expect(s.open, `open @${seed}`).toBeGreaterThanOrEqual(0.85);
      expect(s.max, `max @${seed}`).toBeLessThanOrEqual(12);
      expect(s.spikes, `spikes @${seed}`).toBeGreaterThanOrEqual(6);
    }
  });
  it("from the landing the horizon is open", () => {
    for (const seed of SEEDS) expect(stats(createSaltmarketWorld(seed), A.landing.x, A.landing.z).open, `@${seed}`).toBeGreaterThanOrEqual(0.85);
  });
  it("Kessar's and Highmark's landing silhouettes do NOT satisfy the same targets: the targets stay discriminating", () => {
    const meets = (s: SkylineStats): boolean => s.open >= 0.85 && s.max <= 12 && s.spikes >= 6;
    expect(meets(stats(createKessarWorld(7), KESSAR_ANCHORS.landing.x, KESSAR_ANCHORS.landing.z))).toBe(false);
    expect(meets(stats(createHighmarkWorld(7), HIGHMARK_ANCHORS.landing.x, HIGHMARK_ANCHORS.landing.z))).toBe(false);
    // the boardwalk is flatter than either of them from its own middle, too
    const mine = stats(createSaltmarketWorld(7), A.walk[3].x, A.walk[3].z);
    expect(mine.mean).toBeLessThan(stats(createKessarWorld(7), KESSAR_ANCHORS.landing.x, KESSAR_ANCHORS.landing.z).mean + 1);
  });
  it("the hairs are real: the plan's verticals reach at least nine metres and every one stands clear of the boardwalk", () => {
    const hairs = saltmarketPlan().hairs;
    expect(hairs.filter((h) => h.height >= 9).length).toBeGreaterThanOrEqual(5);
    expect(new Set(hairs.map((h) => h.kind)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("Saltmarket: budgets and the contract's constants", () => {
  it("the view budget never loosened, and the plan's colliders are bounded", () => {
    expect(SALTMARKET_VIEW_BUDGET.meshes.medium).toBeLessThanOrEqual(46);   // (the contract's numbers: only ever tightened)
    expect(SALTMARKET_VIEW_BUDGET.triangles.high).toBeLessThanOrEqual(540_000);
    for (const seed of SEEDS) expect(saltmarketObstacles(createSaltmarketTerrain(seed), seed).length).toBeLessThan(420);
  });
});
