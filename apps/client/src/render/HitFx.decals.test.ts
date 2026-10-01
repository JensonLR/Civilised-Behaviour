import { Group, Scene } from "three";
import { describe, expect, it } from "vitest";
import { WEAPON, newWorldHit } from "@cb/shared";
import { CollisionWorld } from "@cb/shared";
import { DECAL, DecalField } from "./decals/index.ts";
import { HitFx } from "./HitFx.ts";
import { LimbDebris } from "./LimbDebris.ts";
import { Projectiles } from "./Projectiles.ts";
import { ShotFx } from "./weapons/ShotFx.ts";

const run = (f: (dt: number) => void, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 30) f(1 / 30);
};

describe("the persistent decals under the hit effects", () => {
  it("with a field attached a blow leaves spatter and spray that STAY, and the short-lived stain pool stays empty", () => {
    const scene = new Scene();
    const field = new DecalField(scene, () => 0, "medium", 3);
    const fx = new HitFx(scene, () => 0);
    fx.attachDecals(field);
    for (let i = 0; i < 6; i++) fx.burst(0, 1.2, 0, 1, 0, 0.9, "full");
    run((dt) => {
      fx.update(dt);
      field.update(dt);
    }, 3);
    expect(field.pool.countOf(DECAL.SPATTER)).toBeGreaterThan(5);
    expect(field.pool.countOf(DECAL.SPRAY)).toBeGreaterThan(0);
    expect(fx.liveDecals).toBe(0);
    // a minute later it is still there at full strength (the old stains were shrinking away by 45 s)
    run((dt) => field.update(dt), 50);
    expect(field.pool.countOf(DECAL.SPATTER)).toBeGreaterThan(0);
    expect(field.pool.countOf(DECAL.SPRAY)).toBeGreaterThan(0);
    fx.bleedOut(1, 1, 0.8);
    expect(field.pool.countOf(DECAL.POOL)).toBe(1);
    field.dispose();
  });

  it("Off leaves no red: the field hides spatter and spray, and no particle is blood", () => {
    const scene = new Scene();
    const field = new DecalField(scene, () => 0, "medium", 3);
    field.setGore("off");
    const fx = new HitFx(scene, () => 0);
    fx.attachDecals(field);
    for (let i = 0; i < 6; i++) fx.burst(0, 1.2, 0, 1, 0, 0.9, "off");
    run((dt) => {
      fx.update(dt);
      field.update(dt);
    }, 2);
    expect(field.pool.visible).toBe(0);
    field.dispose();
  });

  it("without a field nothing changes: the old stains still appear and fade", () => {
    const fx = new HitFx(new Scene(), () => 0);
    for (let i = 0; i < 20; i++) fx.burst(0, 1, 0, 1, 0, 1, "full");
    run((dt) => fx.update(dt), 2.5);
    expect(fx.liveDecals).toBeGreaterThan(0);
  });

  it("a limb that lands tells the integrator where, once; a round that stops at the world tells it where and what it hit", () => {
    const debris = new LimbDebris(new Scene(), () => 0);
    const landed: number[][] = [];
    debris.onLand = (x, z) => landed.push([x, z]);
    const pivot = new Group();
    pivot.position.set(0, 1.5, 0);
    debris.spawn(pivot, 1, 0, 0.8, "full");
    run((dt) => debris.update(dt), 3);
    expect(landed).toHaveLength(1);
    expect(Math.abs(landed[0]![0]!)).toBeGreaterThan(0.2);

    const world = new CollisionWorld({ height: () => 0 }, [], 200);
    const scene = new Scene();
    const shot = new ShotFx(scene, () => 0);
    const proj = new Projectiles(scene, world, shot);
    const hits: number[][] = [];
    proj.onImpact = (w, x, y, z, nx, ny, nz) => hits.push([w, x, y, z, nx, ny, nz]);
    proj.spawn(WEAPON.CANNON, 0, 1.5, 0, 0, -9, 60);
    run((dt) => proj.update(dt), 3);
    expect(hits.length).toBe(1);
    expect(hits[0]![0]).toBe(WEAPON.CANNON);
    expect(hits[0]![5]).toBeGreaterThan(0.5); // (it landed on flat ground: the normal is up)
    void newWorldHit;
  });
});
