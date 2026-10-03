import { Mesh, Scene } from "three";
import { describe, expect, it } from "vitest";
import type { GoreLevel } from "@cb/procedural/three";
import { DECAL, DECAL_ATTR, DECAL_CAP, DECAL_LIFE, DecalField, DecalPool, dayLight, styleFor, type DecalKind } from "./index.ts";

/** The persistent marks of a fight: caps, persistence, eviction order, determinism, gore levels, allocation, draw calls. */

const UP = [0, 1, 0] as const;
const run = (p: DecalPool, seconds: number, dt = 0.25): void => {
  for (let t = 0; t < seconds; t += dt) p.update(dt);
};
const addAt = (p: DecalPool, kind: DecalKind, i: number): number => p.add(kind, i * 0.7, 0, (i % 7) * 0.9, UP[0], UP[1], UP[2], 1, 0, 0.3, 0.5);
const redness = (p: DecalPool, i: number): boolean => {
  const o = i * DECAL_ATTR;
  const r = p.col[o]!;
  const g = p.col[o + 1]!;
  const b = p.col[o + 2]!;
  // (in linear light: a blood red is nearly 50 times its green; the reduced brown-red under 5; the grime tan under 2)
  return r > 0.04 && r > 6 * g && r > 6 * b;
};

describe("caps", () => {
  it("each graphics preset keeps at most its cap alive however many marks are made, and a bigger preset keeps more", () => {
    const keep: number[] = [];
    for (const preset of ["low", "medium", "high"] as const) {
      const p = new DecalPool(DECAL_CAP[preset], 3);
      for (let i = 0; i < 2000; i++) {
        addAt(p, (i % 6) as DecalKind, i);
        if (i % 10 === 0) p.update(0.05);
      }
      expect(p.count, preset).toBeLessThanOrEqual(DECAL_CAP[preset]);
      expect(p.drawn, preset).toBeLessThanOrEqual(DECAL_CAP[preset]);
      keep.push(p.count);
    }
    expect(keep[0]!).toBeLessThan(keep[1]!);
    expect(keep[1]!).toBeLessThan(keep[2]!);
  });
});

describe("persistence and eviction", () => {
  it("lifetime follows priority: mud is gone in under a minute, a pool is still there after ten, nothing lives for ever", () => {
    const p = new DecalPool(16, 1);
    p.add(DECAL.MUD, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0.3);
    p.add(DECAL.POOL, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0.8);
    run(p, 60);
    expect(p.countOf(DECAL.MUD)).toBe(0);
    expect(p.countOf(DECAL.POOL)).toBe(1);
    run(p, 400);
    expect(p.countOf(DECAL.POOL)).toBe(1); // (at 460 s, under its 540..660 s life)
    run(p, 400);
    expect(p.countOf(DECAL.POOL)).toBe(0);
    expect(DECAL_LIFE[DECAL.POOL]).toBeGreaterThan(DECAL_LIFE[DECAL.SCORCH]);
    expect(DECAL_LIFE[DECAL.SCORCH]).toBeGreaterThan(DECAL_LIFE[DECAL.MUD]);
  });

  it("when full, the OLDEST of the lowest priority goes first; a newcomer outranked by everything is dropped", () => {
    const p = new DecalPool(6, 2);
    const mud: number[] = [];
    for (let i = 0; i < 6; i++) {
      mud.push(addAt(p, DECAL.MUD, i));
      p.update(1);
    }
    // a pool takes the oldest mud's place
    const pool = addAt(p, DECAL.POOL, 99);
    expect(pool).toBe(mud[0]);
    // the next mud, outranked by a pool but not by other mud, takes the oldest mud
    const again = addAt(p, DECAL.MUD, 100);
    expect(again).toBe(mud[1]);
    // fill the rest with pools: now mud is outranked by everything
    for (let i = 0; i < 5; i++) addAt(p, DECAL.POOL, 200 + i);
    expect(p.countOf(DECAL.POOL)).toBe(6);
    expect(addAt(p, DECAL.MUD, 300)).toBe(-1);
    expect(p.count).toBe(6);
  });

  it("the freshest pool is never evicted, whatever else is", () => {
    const p = new DecalPool(4, 5);
    let last = -1;
    for (let i = 0; i < 40; i++) {
      p.update(0.5);
      const prevFreshest = last;
      last = p.pool(i, 0, 0, 0, 1, 0, 0.6);
      expect(last, `pool ${i} placed`).toBeGreaterThanOrEqual(0);
      if (prevFreshest >= 0) expect(p.kindOf(prevFreshest), `the freshest pool survived the next one (${i})`).toBe(DECAL.POOL);
    }
    // and with only pools and one slot, a new pool replaces the OLDEST, not the freshest
    const q = new DecalPool(2, 5);
    const a = q.pool(0, 0, 0, 0, 1, 0, 0.6);
    q.update(1);
    const b = q.pool(1, 0, 0, 0, 1, 0, 0.6);
    q.update(1);
    const c = q.pool(2, 0, 0, 0, 1, 0, 0.6);
    expect(new Set([a, b]).size).toBe(2);
    expect(c).toBe(a);
  });
});

describe("blood spreads, dries and darkens", () => {
  it("a pool grows from a quarter to its full size over seconds and its colour darkens as it dries", () => {
    const p = new DecalPool(8, 4);
    const i = p.pool(0, 0, 0, 0, 1, 0, 1);
    p.update(0.05);
    const small = p.pos[i * DECAL_ATTR + 3]!;
    const wetLum = p.col[i * DECAL_ATTR]! + p.col[i * DECAL_ATTR + 1]! + p.col[i * DECAL_ATTR + 2]!;
    run(p, 10);
    const big = p.pos[i * DECAL_ATTR + 3]!;
    expect(big).toBeGreaterThan(small * 2.2);
    expect(big).toBeLessThan(1.3);
    run(p, 100);
    const dryLum = p.col[i * DECAL_ATTR]! + p.col[i * DECAL_ATTR + 1]! + p.col[i * DECAL_ATTR + 2]!;
    expect(dryLum, "a dried pool is darker").toBeLessThan(wetLum * 0.85);
    expect(p.info[i * DECAL_ATTR + 1]!, "no wet highlight once dry").toBeLessThan(0.05);
  });

  it("a body dragged leaves a smear about every half metre, paler the further it has been dragged, and stops when it stops", () => {
    const p = new DecalPool(64, 6);
    let laid = 0;
    for (let k = 0; k <= 50; k++) if (p.dragStep(7, k * 0.1, 0, 0, 0, 1, 0, 1, 0, 6)) laid++;
    // 5 m of travel: ~9-10 smears
    expect(laid).toBeGreaterThanOrEqual(8);
    expect(laid).toBeLessThanOrEqual(11);
    p.update(0.2);
    const alphas: number[] = [];
    for (let i = 0; i < p.cap; i++) if (p.kindOf(i) === DECAL.DRAG) alphas.push(p.col[i * DECAL_ATTR + 3]!);
    expect(alphas[alphas.length - 1]!).toBeLessThan(alphas[0]!);
    const before = p.count;
    for (let k = 0; k < 30; k++) p.dragStep(7, 5, 0, 0, 0, 1, 0, 1, 0, 6);
    expect(p.count).toBe(before);
  });
});

describe("determinism", () => {
  const scene = (seed: number): DecalPool => {
    const p = new DecalPool(32, seed);
    for (let i = 0; i < 40; i++) {
      p.add((i % 6) as DecalKind, i * 0.3, 0.1 * i, i * 0.2, 0, 1, 0, i % 3 === 0 ? 0 : 1, 0, 0.4, 0.3 + (i % 5) * 0.1);
      if (i % 4 === 0) p.update(0.7);
    }
    run(p, 12);
    return p;
  };

  it("the same seed and the same calls draw the same field, bit for bit; another seed draws another", () => {
    const a = scene(11);
    const b = scene(11);
    const c = scene(12);
    for (const k of ["pos", "axis", "norm", "col", "info"] as const) expect(Array.from(a[k]), k).toEqual(Array.from(b[k]));
    expect(Array.from(a.norm)).not.toEqual(Array.from(c.norm));
  });

  it("every mark's detail comes from (seed, serial): no mark depends on another's existence", () => {
    const a = new DecalPool(8, 9);
    const b = new DecalPool(8, 9);
    const first = a.pool(0, 0, 0, 0, 1, 0, 0.5);
    const second = b.pool(0, 0, 0, 0, 1, 0, 0.5);
    expect(a.norm[first * DECAL_ATTR + 3]).toBe(b.norm[second * DECAL_ATTR + 3]);
    for (const bad of [NaN, Infinity, -Infinity]) expect(a.pool(bad, 0, 0, 0, 1, 0, 0.5), `x=${bad}`).toBe(-1);
    expect(a.pool(0, 0, 0, 0, 1, 0, NaN)).toBe(-1);
    expect(a.pool(0, 0, 0, 0, 1, 0, 0)).toBe(-1);
  });
});

describe("gore levels", () => {
  const field = (gore: GoreLevel): DecalPool => {
    const p = new DecalPool(64, 21);
    p.setGore(gore);
    for (let i = 0; i < 6; i++) {
      p.pool(i, 0, 0, 0, 1, 0, 0.8);
      p.spatter(i, 0, 1, 0, 1, 0, 1, 0, 0.4);
      p.spray(i, 1, 2, 1, 0, 0, 1, -0.2, 0, 0.9);
      p.dragStep(1, i * 0.7, 0, 3, 0, 1, 0, 1, 0, 4);
      p.scorch(i, 0, 4, 0, 1, 0, 0.9);
      p.mud(i, 0, 5, 0, 1, 0, 1, 0, 0.3);
    }
    return p;
  };

  it("Off draws no red at all, at any age, and hides spray, spatter and drag; scorch and mud stay", () => {
    const p = field("off");
    for (const age of [0.1, 3, 20, 80, 300]) {
      run(p, age === 0.1 ? 0.1 : age - (p.ageOf(0) > 0 ? p.ageOf(0) : 0), 0.5);
      for (let i = 0; i < p.cap; i++) {
        if (p.kindOf(i) < 0) continue;
        if (p.col[i * DECAL_ATTR + 3]! > 0.001) expect(redness(p, i), `kind ${p.kindOf(i)} at ${age}s`).toBe(false);
      }
    }
    const q = field("off");
    q.update(0.3);
    for (let i = 0; i < q.cap; i++) {
      const k = q.kindOf(i);
      if (k === DECAL.SPATTER || k === DECAL.SPRAY || k === DECAL.DRAG) expect(q.col[i * DECAL_ATTR + 3], `kind ${k} hidden`).toBe(0);
    }
    expect(q.visible).toBeGreaterThan(0);
    expect(styleFor(DECAL.SCORCH, "off")).toBeDefined();
    expect(styleFor(DECAL.MUD, "off")).toBeDefined();
    expect(styleFor(DECAL.POOL, "off")!.tone.fresh).not.toBe(styleFor(DECAL.POOL, "full")!.tone.fresh);
  });

  it("Reduced is brown and smaller with no spray; Full is red", () => {
    const full = field("full");
    const reduced = field("reduced");
    full.update(0.3);
    reduced.update(0.3);
    const poolOf = (p: DecalPool): number => {
      for (let i = 0; i < p.cap; i++) if (p.kindOf(i) === DECAL.POOL) return i;
      return -1;
    };
    expect(redness(full, poolOf(full)), "full pool is red").toBe(true);
    expect(redness(reduced, poolOf(reduced)), "reduced pool is not").toBe(false);
    expect(reduced.pos[poolOf(reduced) * DECAL_ATTR + 3]!).toBeLessThan(full.pos[poolOf(full) * DECAL_ATTR + 3]!);
    for (let i = 0; i < reduced.cap; i++) if (reduced.kindOf(i) === DECAL.SPRAY) expect(reduced.col[i * DECAL_ATTR + 3]).toBe(0);
  });

  it("changing the setting changes the field at once: the same marks go red, brown, grime", () => {
    const p = field("full");
    p.update(0.3);
    const some = (): number => {
      let n = 0;
      for (let i = 0; i < p.cap; i++) if (p.kindOf(i) >= 0 && p.col[i * DECAL_ATTR + 3]! > 0.001 && redness(p, i)) n++;
      return n;
    };
    expect(some()).toBeGreaterThan(0);
    p.setGore("off");
    p.update(0.01);
    expect(some()).toBe(0);
    p.setGore("full");
    p.update(0.01);
    expect(some()).toBeGreaterThan(0);
  });
});

describe("cost", () => {
  it("update allocates nothing: thousands of frames over a full pool move the heap by almost nothing", () => {
    const p = new DecalPool(DECAL_CAP.high, 8);
    for (let i = 0; i < DECAL_CAP.high; i++) addAt(p, (i % 6) as DecalKind, i);
    for (let i = 0; i < 300; i++) p.update(1 / 60); // (warm up the JIT)
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 6000; i++) p.update(1 / 60);
    const grew = process.memoryUsage().heapUsed - before;
    // a single small object per mark per frame would be ~2 million objects (>100 MB); allow for the runtime's own noise
    expect(grew).toBeLessThan(4_000_000);
  });

  it("the field is ONE instanced draw call whatever it holds, and follows the daylight and the preset", () => {
    const scene = new Scene();
    const field = new DecalField(scene, (x) => 0.2 * Math.sin(x), "medium", 4);
    expect(field.drawCalls).toBeLessThanOrEqual(2);
    for (let i = 0; i < 300; i++) {
      field.bloodPool(i * 0.2, i * 0.1, 0.6);
      field.mud(i * 0.1, 3, 1, 0, 0.3);
      field.blast(i, i, 1);
    }
    field.update(0.1);
    const meshes: Mesh[] = [];
    scene.traverse((o) => o instanceof Mesh && meshes.push(o));
    expect(meshes.length, "draw calls").toBeLessThanOrEqual(2);
    expect(field.pool.count).toBeLessThanOrEqual(DECAL_CAP.medium);
    field.setPreset("low");
    expect(field.pool.cap).toBe(DECAL_CAP.low);
    const again: Mesh[] = [];
    scene.traverse((o) => o instanceof Mesh && again.push(o));
    expect(again.length).toBeLessThanOrEqual(2);
    expect(dayLight(13)).toBeGreaterThan(dayLight(2));
    expect(dayLight(2)).toBeGreaterThan(0.3);
    field.dispose();
  });

  it("ground marks lie on the slope: the normal tilts with the terrain and the height follows it", () => {
    const field = new DecalField(new Scene(), (x) => 0.5 * x, "low", 1);
    const n = field.groundNormal(2, 0, { x: 0, y: 0, z: 0 });
    expect(n.x).toBeLessThan(-0.3);
    expect(n.y).toBeGreaterThan(0.7);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
    const slot = field.bloodPool(2, 0, 0.5);
    // (laid on the crest of the terrain under its footprint, a hand's breadth up: never below the ground at its centre, never floating by more than the bump it spans)
    const y = field.pool.pos[slot * DECAL_ATTR + 1]!;
    expect(y).toBeGreaterThanOrEqual(1);
    expect(y).toBeLessThan(1.35);
    field.dispose();
  });
});

describe("boot prints (D-058)", () => {
  it("a print is a small mud oval along the walk; a crowd's worth of prints never pushes out a pool of blood, only older prints", () => {
    const p = new DecalPool(DECAL_CAP.low, 5);
    const pool = p.pool(0, 0, 0, UP[0], UP[1], UP[2], 0.6);
    expect(pool).toBeGreaterThanOrEqual(0);
    const i = p.print(1, 0, 1, UP[0], UP[1], UP[2], 0, 1);
    expect(p.kindOf(i)).toBe(DECAL.MUD);
    for (let k = 0; k < 5000; k++) {
      p.print(k * 0.3, 0, (k % 11) * 0.4, UP[0], UP[1], UP[2], 1, 0);
      if (k % 50 === 0) p.update(0.05);
    }
    expect(p.kindOf(pool)).toBe(DECAL.POOL);
    expect(p.countOf(DECAL.MUD)).toBeLessThanOrEqual(DECAL_CAP.low);
  });

  it("the field sets left and right prints either side of the line walked, and none for a body shuffling on the spot", () => {
    const f = new DecalField(new Scene(), () => 0, "low", 3);
    const l = f.printAt(0, 0, 0, -2, -1);
    const r = f.printAt(0, 0, 0, -2, 1);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThanOrEqual(0);
    const xOf = (i: number): number => f.pool.pos[i * DECAL_ATTR]!;
    expect(Math.sign(xOf(l))).toBe(-Math.sign(xOf(r)));
    expect(f.printAt(0, 0, 0.1, 0.1, 1)).toBe(-1);
  });
});
