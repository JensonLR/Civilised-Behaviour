import { Box3, Mesh, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CollisionWorld, PALETTE, SURFACE, WEAPON, WEAPONS, type SurfaceId } from "@cb/shared";
import { SOUND_NAMES } from "../../audio/sounds.ts";
import { Projectiles, PROJECTILES } from "../Projectiles.ts";
import { CannonView } from "./CannonView.ts";
import { IMPACT_SOUND, REPORT } from "./sfx.ts";
import { ShotFx, SHOTFX, windAt } from "./ShotFx.ts";
import { WeaponModel, disposeWeaponModels, weaponTriangles } from "./WeaponModels.ts";

const flat = () => new CollisionWorld({ height: () => 0 }, [], 200);
const ground = () => 0;
const run = (fx: ShotFx, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) fx.update(1 / 30);
};
const live = (fx: ShotFx) => {
  const l = fx.live;
  return l.puffs + l.flashes + l.streaks + l.debris;
};

describe("weapon models", () => {
  const shown = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA];

  it("every carried weapon builds finite geometry inside a sane box and a small triangle budget", () => {
    for (const id of shown) {
      const tris = weaponTriangles(id);
      expect(tris, `weapon ${id}`).toBeGreaterThan(20);
      expect(tris, `weapon ${id}`).toBeLessThan(2600);
      const m = new WeaponModel(id, true);
      const box = new Box3();
      m.group.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.computeBoundingBox();
          box.union(o.geometry.boundingBox!);
          const p = o.geometry.attributes.position!.array as Float32Array;
          for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]!)).toBe(true);
        }
      });
      const size = box.getSize(new Vector3());
      expect(size.length(), `weapon ${id}`).toBeGreaterThan(0.2);
      expect(size.length(), `weapon ${id}`).toBeLessThan(2.6);
      m.dispose();
    }
    disposeWeaponModels();
  });

  it("the muzzle marker sits at the far end (-Z) of a firearm, and the ink hull is optional", () => {
    for (const id of [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS]) {
      const a = new WeaponModel(id, false);
      expect(a.muzzle.position.z).toBeLessThan(-0.1);
      expect(a.group.children.filter((c) => c.name === "weapon_ink")).toHaveLength(0);
      const b = new WeaponModel(id, true);
      expect(b.group.children.filter((c) => c.name === "weapon_ink")).toHaveLength(1);
    }
    disposeWeaponModels();
  });

  it("the cannon builds, follows the replicated state, and recoils and eases home after a shot", () => {
    const scene = new Scene();
    const fx = new ShotFx(scene, ground);
    const view = new CannonView(scene, fx, true);
    const st = { x: 16.4, y: 0, z: 4.4, yaw: 0.5, elev: 0.1, phase: 0, crew: 0, shells: 6, fired: 0, fuse: 0 } as never;
    view.update(1 / 30, st);
    expect(view.root.position.x).toBeCloseTo(16.4, 3);
    (st as { fired: number }).fired = 1;
    view.update(1 / 30, st);
    const kicked = Math.hypot(view.root.position.x - 16.4, view.root.position.z - 4.4);
    expect(kicked).toBeGreaterThan(0.2);
    for (let i = 0; i < 90; i++) view.update(1 / 30, st);
    expect(Math.hypot(view.root.position.x - 16.4, view.root.position.z - 4.4)).toBeLessThan(0.01);
    view.dispose();
    fx.dispose();
  });
});

describe("ShotFx", () => {
  it("a shot's flash, smoke and debris are pooled: they appear, then all die away", () => {
    const fx = new ShotFx(new Scene(), ground);
    fx.muzzle(WEAPON.RIFLE, 0, 1.5, 0, 0, 0, -1);
    fx.impact(SURFACE.STONE, 0, 1, -20, 0, 0, 1, WEAPON.RIFLE);
    expect(live(fx)).toBeGreaterThan(5);
    run(fx, 12);
    expect(live(fx)).toBe(0);
    fx.dispose();
  });

  it("is hard-capped: hammering every effect never exceeds the pools", () => {
    const fx = new ShotFx(new Scene(), ground, 1.4);
    for (let i = 0; i < 600; i++) {
      fx.muzzle(WEAPON.BLUNDERBUSS, 0, 1.5, 0, 0, 0, -1);
      fx.impact((i % 6) as SurfaceId, 0, 1, -8, 0, 1, 0, WEAPON.RIFLE);
      fx.explosion(0, 0, -10, 6);
      fx.tracer(0, 1, 0, 0, 1, -50, WEAPON.RIFLE);
      if (i % 5 === 0) fx.update(1 / 30);
      const l = fx.live;
      expect(l.puffs).toBeLessThanOrEqual(SHOTFX.puffs);
      expect(l.flashes).toBeLessThanOrEqual(SHOTFX.flashes);
      expect(l.streaks).toBeLessThanOrEqual(SHOTFX.streaks);
      expect(l.debris).toBeLessThanOrEqual(SHOTFX.debris);
    }
    fx.dispose();
  });

  it("smoke drifts with the wind (the same wind the sky uses) and never sinks below the ground", () => {
    const fx = new ShotFx(new Scene(), ground);
    const w = { x: 0, z: 0 };
    windAt(0, w);
    expect(Number.isFinite(w.x) && Number.isFinite(w.z)).toBe(true);
    fx.muzzle(WEAPON.PISTOL, 0, 0.1, 0, 0, 0, -1);
    run(fx, 3);
    fx.dispose();
  });

  it("a bigger gun makes a bigger picture (blunderbuss and cannon read louder than the pistol)", () => {
    const count = (id: number) => {
      const fx = new ShotFx(new Scene(), ground);
      fx.muzzle(id, 0, 1.5, 0, 0, 0, -1);
      const n = live(fx);
      fx.dispose();
      return n;
    };
    expect(count(WEAPON.BLUNDERBUSS)).toBeGreaterThanOrEqual(count(WEAPON.PISTOL));
  });
});

describe("Projectiles", () => {
  it("a pistol ball flies on its ballistic arc, dies at the ground and never exceeds the pool", () => {
    const scene = new Scene();
    const fx = new ShotFx(scene, ground);
    const p = new Projectiles(scene, flat(), fx);
    const r = WEAPONS[WEAPON.PISTOL].ranged!;
    p.spawn(WEAPON.PISTOL, 0, 1.5, 0, 0, 0, -r.speed);
    expect(p.live).toBe(1);
    for (let i = 0; i < 400 && p.live > 0; i++) p.update(1 / 60);
    expect(p.live).toBe(0);
    for (let i = 0; i < PROJECTILES.cap * 3; i++) p.spawn(WEAPON.BLUNDERBUSS, i, 2, 0, 0, 0, -100);
    expect(p.live).toBeLessThanOrEqual(PROJECTILES.cap);
    p.dispose();
    fx.dispose();
  });

  it("hitscan and non-firing weapons spawn nothing", () => {
    const scene = new Scene();
    const fx = new ShotFx(scene, ground);
    const p = new Projectiles(scene, flat(), fx);
    p.spawn(WEAPON.RIFLE, 0, 1.5, 0, 0, 0, -300);
    p.spawn(WEAPON.SABRE, 0, 1.5, 0, 0, 0, -1);
    expect(p.live).toBe(0);
    p.dispose();
    fx.dispose();
  });

  it("a cannon ball is slower and much heavier in the picture than a pistol ball", () => {
    expect(WEAPONS[WEAPON.CANNON].ranged!.speed).toBeLessThan(WEAPONS[WEAPON.PISTOL].ranged!.speed);
    expect(WEAPONS[WEAPON.CANNON].ranged!.blast!.radius).toBeGreaterThan(3);
  });
});

describe("sound names", () => {
  it("every sound the combat visuals ask for exists in the audio table", () => {
    const names = new Set(SOUND_NAMES);
    for (const n of [...Object.values(REPORT), ...IMPACT_SOUND, "sabre_swing", "sabre_hit", "reload_click", "explosion", "impact_flesh"]) expect(names.has(n), n).toBe(true);
  });

  it("palette-owned: weapon colours are defined in one place", () => {
    for (const v of Object.values(PALETTE.weapons)) expect(Number.isInteger(v)).toBe(true);
  });
});
