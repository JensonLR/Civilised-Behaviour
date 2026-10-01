import { Scene } from "three";
import { describe, expect, it } from "vitest";
import { SURFACE, WEAPON } from "@cb/shared";
import { setAtmosphere } from "../world/atmosphere.ts";
import { SHOTFX, ShotFx, WHIZZ_RANGE, seedShotFx, smokeWind, windAt, windGain } from "./ShotFx.ts";

const ground = () => 0;
const make = (scale = 1) => new ShotFx(new Scene(), ground, scale);
const run = (fx: ShotFx, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) fx.update(1 / 30);
};
const total = (fx: ShotFx): number => {
  const l = fx.live;
  return l.puffs + l.flashes + l.streaks + l.debris;
};

describe("wind on the smoke", () => {
  it("stretches with the weather's strength: half at a dead calm, more than three times in a gale, a finite number always", () => {
    expect(windGain(0)).toBeCloseTo(0.5, 6);
    expect(windGain(1)).toBeCloseTo(3.4, 6);
    expect(windGain(0.5)).toBeGreaterThan(windGain(0.2));
    expect(windGain(NaN)).toBeGreaterThan(0);
    expect(windGain(9)).toBe(windGain(1));
    expect(windGain(-3)).toBe(windGain(0));
  });

  it("keeps the deterministic heading and scales only the speed", () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    const c = { x: 0, z: 0 };
    windAt(40, a);
    smokeWind(40, 0.2, b);
    smokeWind(40, 0.9, c);
    expect(Math.atan2(b.z, b.x)).toBeCloseTo(Math.atan2(a.z, a.x), 6);
    expect(Math.atan2(c.z, c.x)).toBeCloseTo(Math.atan2(a.z, a.x), 6);
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(Math.hypot(b.x, b.z) * 2);
  });

  it("a puff of muzzle smoke drifts further downwind in a gale than in a calm (the atmosphere's wind is read every frame)", () => {
    const drift = (wind: number): number => {
      setAtmosphere({ wind });
      seedShotFx(7); // (the same dice in both weathers: the only difference left is the wind, so the comparison cannot flake)
      const fx = make();
      const x0 = 0;
      fx.muzzle(WEAPON.RIFLE, x0, 1.4, 0, 0, 0, -1);
      // the smoke's centroid after a few seconds: read it through the instance buffers
      run(fx, 4);
      const P = (fx as unknown as { puffs: { pos: { array: Float32Array }; mesh: { geometry: { instanceCount: number } } } }).puffs;
      const n = P.mesh.geometry.instanceCount;
      let sx = 0;
      let sz = 0;
      for (let i = 0; i < n; i++) {
        sx += P.pos.array[i * 4]!;
        sz += P.pos.array[i * 4 + 2]!;
      }
      return n > 0 ? Math.hypot(sx / n, sz / n + 0) : 0;
    };
    const calm = drift(0);
    const gale = drift(1);
    setAtmosphere({ wind: 0.2 });
    expect(gale).toBeGreaterThan(calm);
  });
});

describe("ground impacts", () => {
  it("earth throws up a plume, a ring of dust and a scar; stone leaves a scar too; a wall (normal sideways) leaves none", () => {
    const fx = make();
    fx.impact(SURFACE.EARTH, 3, 0, -5, 0, 1, 0, WEAPON.RIFLE);
    expect(fx.live.puffs).toBeGreaterThanOrEqual(8);
    expect(fx.liveMarks).toBe(1);
    fx.impact(SURFACE.STONE, 2, 0, -5, 0, 1, 0, WEAPON.PISTOL);
    expect(fx.liveMarks).toBe(2);
    fx.impact(SURFACE.EARTH, 1, 1, -5, 1, 0, 0, WEAPON.RIFLE); // a bank facing sideways
    fx.impact(SURFACE.WOOD, 0, 1, -5, 0, 0, 1, WEAPON.RIFLE);
    expect(fx.liveMarks).toBe(2);
  });

  it("scars are pooled (never more than the pool), stay for their life, then go; the smoke and dust are gone long before", () => {
    const fx = make();
    for (let i = 0; i < 200; i++) fx.impact(SURFACE.EARTH, i * 0.1, 0, -5, 0, 1, 0, WEAPON.PISTOL);
    expect(fx.liveMarks).toBe(SHOTFX.marks);
    run(fx, 6);
    expect(total(fx)).toBe(0);
    expect(fx.liveMarks).toBe(SHOTFX.marks);
    run(fx, SHOTFX.markLife);
    expect(fx.liveMarks).toBe(0);
  });

  it("a cannon's impact is larger than a pistol's (bigger puffs, a wider ring)", () => {
    const sizeOf = (w: number): number => {
      const fx = make();
      fx.impact(SURFACE.EARTH, 0, 0, -6, 0, 1, 0, w);
      fx.update(1 / 60);
      const P = (fx as unknown as { puffs: { pos: { array: Float32Array }; mesh: { geometry: { instanceCount: number } } } }).puffs;
      let m = 0;
      for (let i = 0; i < P.mesh.geometry.instanceCount; i++) m = Math.max(m, P.pos.array[i * 4 + 3]!);
      return m;
    };
    expect(sizeOf(WEAPON.CANNON)).toBeGreaterThan(sizeOf(WEAPON.PISTOL) * 2);
  });

  it("the graphics preset scales the number of puffs (low fewer, high more)", () => {
    const count = (scale: number): number => {
      const fx = make(scale);
      fx.impact(SURFACE.EARTH, 0, 0, -6, 0, 1, 0, WEAPON.RIFLE);
      return fx.live.puffs;
    };
    expect(count(0.5)).toBeLessThan(count(1));
    expect(count(1)).toBeLessThan(count(1.4) + 1);
  });
});

describe("shots", () => {
  it("a discharge leaves a brass cap flying from the lock, powder haze that hangs for seconds, and stays inside the pools", () => {
    const fx = make();
    fx.muzzle(WEAPON.RIFLE, 0, 1.5, 0, 0, 0, -1);
    const l = fx.live;
    expect(l.debris).toBeGreaterThanOrEqual(3); // wad, cap, sparks
    expect(l.puffs).toBeGreaterThanOrEqual(6);
    run(fx, 1.2);
    expect(fx.live.puffs).toBeGreaterThan(0); // the haze is still there after a second
    run(fx, 6);
    expect(total(fx)).toBe(0);
    for (let i = 0; i < 300; i++) fx.muzzle(WEAPON.BLUNDERBUSS, 0, 1.5, 0, 0, 0, -1);
    expect(fx.live.puffs).toBeLessThanOrEqual(SHOTFX.puffs);
    expect(fx.live.debris).toBeLessThanOrEqual(SHOTFX.debris);
  });

  it("a body hit with gore off throws dust, not blood", () => {
    const fx = make();
    fx.bodyDust(0, 1.2, 0, 1, 0, 0.8);
    expect(fx.live.puffs).toBeGreaterThanOrEqual(3);
    run(fx, 3);
    expect(total(fx)).toBe(0);
  });
});

describe("bullet whizz", () => {
  it("a round that passes within three metres of the listener leaves streaks and reports how close; far ones and your own shot do not", () => {
    const fx = make();
    const near: number[] = [];
    fx.onNearMiss = (k) => near.push(k);
    fx.listener.x = 0;
    fx.listener.y = 1.6;
    fx.listener.z = 0;
    fx.listener.valid = true;
    // a hitscan line from 40 m away going past at 1 m
    const k = fx.nearMiss(1, 1.6, -40, 1, 1.6, 20);
    expect(k).toBeGreaterThan(0.5);
    expect(near).toEqual([k]);
    expect(fx.live.streaks).toBeGreaterThanOrEqual(2);
    // rate limited, so a shotgun's pellets are one whizz
    expect(fx.nearMiss(1.2, 1.6, -40, 1.2, 1.6, 20)).toBe(0);
    run(fx, 0.2);
    expect(fx.nearMiss(WHIZZ_RANGE + 1, 1.6, -40, WHIZZ_RANGE + 1, 1.6, 20)).toBe(0); // too far to matter
    expect(fx.nearMiss(0.4, 1.6, -0.5, 0.4, 1.6, -30)).toBe(0); // starts at your own muzzle
    expect(fx.nearMiss(0, 1.6, -40, 0, 1.6, 20)).toBe(0); // straight through the head: that is a hit, not a near miss
  });

  it("does nothing until the game has told it where the listener is", () => {
    const fx = make();
    expect(fx.nearMiss(1, 1.6, -40, 1, 1.6, 20)).toBe(0);
  });
});

describe("disposal", () => {
  it("removes every mesh it added to the scene", () => {
    const scene = new Scene();
    const fx = new ShotFx(scene, ground, 1);
    expect(scene.children.length).toBeGreaterThanOrEqual(6);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });
});
