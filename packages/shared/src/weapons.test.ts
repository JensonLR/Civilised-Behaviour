import { describe, expect, it } from "vitest";
import { createArena } from "./arena.ts";
import { MOVEMENT } from "./constants.ts";
import {
  CANNON,
  CANNON_SPOTS,
  CARRIED,
  CARRIED_MASK,
  COMBAT,
  WEAPON,
  WEAPONS,
  WEAPON_COUNT,
  aimDirection,
  blastFalloff,
  cannonLoadRate,
  elevFromWire,
  elevToWire,
  falloffMul,
  isCarried,
  projectileLag,
  isWeapon,
  meleeDamage,
  rangedDamage,
  shotDirection,
  shotSeed,
  spreadFor,
  weaponFromWire,
  weaponToWire,
  type WeaponId,
} from "./weapons.ts";
import { ZONE } from "./wounds.ts";

const v = { x: 0, y: 0, z: 0 };
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => a.x * b.x + a.y * b.y + a.z * b.z;

describe("weapon table", () => {
  it("wire ids are frozen (they are the wire format and the bit index of PlayerState.weapons)", () => {
    expect(WEAPON).toEqual({ PISTOL: 0, RIFLE: 1, BLUNDERBUSS: 2, SABRE: 3, UMBRELLA: 4, CANNON: 5, FISTS: 6 });
    expect(WEAPON_COUNT).toBe(7);
    for (let i = 0; i < WEAPON_COUNT; i++) expect(WEAPONS[i as WeaponId].id).toBe(i);
    expect(CARRIED).toEqual([0, 1, 2, 3, 4]);
    expect(CARRIED_MASK).toBe(0b11111);
  });

  it("every weapon is sane: positive numbers, six zone multipliers, hitscan iff no muzzle speed", () => {
    for (const d of Object.values(WEAPONS)) {
      expect(d.noise, d.name).toBeGreaterThan(0);
      expect(d.ffScale, d.name).toBeGreaterThan(0);
      expect(d.ffScale, d.name).toBeLessThanOrEqual(1);
      expect(d.severBias, d.name).toBeGreaterThanOrEqual(0);
      expect(d.melee || d.ranged, d.name).toBeTruthy();
      if (d.ranged) {
        const r = d.ranged;
        expect(r.zoneMul, d.name).toHaveLength(6);
        expect(r.damage).toBeGreaterThan(0);
        expect(r.pellets).toBeGreaterThanOrEqual(1);
        expect(r.cooldown).toBeGreaterThan(0);
        expect(r.reload).toBeGreaterThan(0);
        expect(r.magazine).toBeGreaterThanOrEqual(1);
        expect(r.range).toBeGreaterThan(r.falloffStart);
        expect(r.falloffEnd).toBeGreaterThan(r.falloffStart);
        expect(r.falloffMin).toBeGreaterThan(0);
        expect(r.falloffMin).toBeLessThanOrEqual(1);
        expect(r.spreadAimed).toBeLessThanOrEqual(r.spread);
        expect(d.fire === "hitscan").toBe(r.speed === 0);
        expect(d.fire === "projectile").toBe(r.speed > 0);
        if (d.id !== WEAPON.CANNON) {
          expect(r.startReserve).toBeLessThanOrEqual(r.reserveMax);
          expect(r.startReserve).toBeGreaterThan(0);
        }
      }
      if (d.melee) {
        expect(d.melee.zoneMul).toHaveLength(6);
        expect(d.melee.reach).toBeGreaterThan(0.5);
        expect(d.melee.windup).toBeLessThan(d.melee.cooldown);
        expect(d.melee.cleave).toBeGreaterThanOrEqual(1);
      }
      expect(d.fire === "melee").toBe(!d.ranged);
    }
  });

  it("only the listed weapons can be carried; the cannon and fists cannot; junk ids are not weapons", () => {
    for (const id of CARRIED) expect(isCarried(id)).toBe(true);
    expect(isCarried(WEAPON.CANNON)).toBe(false);
    expect(isCarried(WEAPON.FISTS)).toBe(false);
    for (const junk of [-1, 7, 99, 1.5, NaN, Infinity, "0", null, undefined]) expect(isWeapon(junk)).toBe(false);
  });

  it("the roster reads as intended: a rifle head shot downs a healthy man, a pistol needs several torso hits, a sabre does not one-shot, the umbrella never severs", () => {
    const rifle = WEAPONS[WEAPON.RIFLE].ranged!;
    expect(rangedDamage(rifle, ZONE.HEAD, 10)).toBeGreaterThanOrEqual(100);
    expect(rangedDamage(rifle, ZONE.TORSO, 10)).toBeLessThan(100);
    expect(rangedDamage(rifle, ZONE.TORSO, 10) * 2).toBeGreaterThanOrEqual(100);
    const pistol = WEAPONS[WEAPON.PISTOL].ranged!;
    expect(Math.ceil(100 / rangedDamage(pistol, ZONE.TORSO, 5))).toBeGreaterThanOrEqual(3);
    const sabre = WEAPONS[WEAPON.SABRE].melee!;
    expect(meleeDamage(sabre, ZONE.TORSO)).toBeLessThan(50);
    expect(WEAPONS[WEAPON.UMBRELLA].severBias).toBe(0);
    expect(WEAPONS[WEAPON.FISTS].severBias).toBe(0);
    expect(WEAPONS[WEAPON.SABRE].severBias).toBeGreaterThan(1);
  });
});

describe("damage rules", () => {
  it("range falloff: full inside the start, the floor beyond the end, monotone in between", () => {
    for (const d of Object.values(WEAPONS)) {
      if (!d.ranged) continue;
      const r = d.ranged;
      expect(falloffMul(r, 0)).toBe(1);
      expect(falloffMul(r, r.falloffStart)).toBe(1);
      expect(falloffMul(r, r.falloffEnd)).toBeCloseTo(r.falloffMin, 9);
      expect(falloffMul(r, r.falloffEnd * 3)).toBeCloseTo(r.falloffMin, 9);
      let prev = 1;
      for (let x = 0; x <= r.falloffEnd * 1.2; x += r.falloffEnd / 40) {
        const m = falloffMul(r, x);
        expect(m).toBeLessThanOrEqual(prev + 1e-12);
        expect(m).toBeGreaterThanOrEqual(r.falloffMin - 1e-12);
        prev = m;
      }
    }
    expect(falloffMul(WEAPONS[WEAPON.PISTOL].ranged!, NaN)).toBe(1); // NaN distance is treated as point blank rather than poisoning the damage
  });

  it("head hurts more than torso, torso more than limbs, for every gun", () => {
    for (const id of [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS] as const) {
      const r = WEAPONS[id].ranged!;
      expect(rangedDamage(r, ZONE.HEAD, 3)).toBeGreaterThan(rangedDamage(r, ZONE.TORSO, 3));
      expect(rangedDamage(r, ZONE.TORSO, 3)).toBeGreaterThan(rangedDamage(r, ZONE.ARM_L, 3));
      expect(rangedDamage(r, ZONE.ARM_L, 3)).toBe(rangedDamage(r, ZONE.ARM_R, 3));
      expect(rangedDamage(r, ZONE.LEG_L, 3)).toBe(rangedDamage(r, ZONE.LEG_R, 3));
    }
  });

  it("a blunderbuss is a room-clearer and nothing at range: point blank torso beats a rifle, thirty metres is a nuisance", () => {
    const b = WEAPONS[WEAPON.BLUNDERBUSS].ranged!;
    const rifle = WEAPONS[WEAPON.RIFLE].ranged!;
    expect(b.pellets * rangedDamage(b, ZONE.TORSO, 2)).toBeGreaterThan(rangedDamage(rifle, ZONE.TORSO, 2));
    expect(b.pellets * rangedDamage(b, ZONE.TORSO, 25)).toBeLessThan(30);
  });

  it("blast falloff: 1 at the centre, 0 at and beyond the radius, smooth and monotone; garbage distances are harmless", () => {
    expect(blastFalloff(0, 5)).toBe(1);
    expect(blastFalloff(5, 5)).toBe(0);
    expect(blastFalloff(9, 5)).toBe(0);
    expect(blastFalloff(2.5, 5)).toBeCloseTo(0.5, 9);
    let prev = 1;
    for (let d = 0; d <= 5; d += 0.1) {
      const f = blastFalloff(d, 5);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
    expect(blastFalloff(-3, 5)).toBe(1);
    expect(blastFalloff(NaN, 5)).toBe(0);
  });
});

describe("accuracy", () => {
  const pistol = WEAPONS[WEAPON.PISTOL].ranged!;

  it("aiming tightens the cone; moving widens it (half as much when aiming); crouching tightens it; sprinting is capped", () => {
    const still = spreadFor(pistol, { aiming: false, speed: 0, crouching: false });
    expect(spreadFor(pistol, { aiming: true, speed: 0, crouching: false })).toBeLessThan(still);
    expect(spreadFor(pistol, { aiming: false, speed: 4, crouching: false })).toBeGreaterThan(still);
    const hipMove = spreadFor(pistol, { aiming: false, speed: 4, crouching: false }) - still;
    const aimMove = spreadFor(pistol, { aiming: true, speed: 4, crouching: false }) - spreadFor(pistol, { aiming: true, speed: 0, crouching: false });
    expect(aimMove).toBeCloseTo(hipMove / 2, 9);
    expect(spreadFor(pistol, { aiming: false, speed: 0, crouching: true })).toBeLessThan(still);
    expect(spreadFor(pistol, { aiming: false, speed: 99, crouching: false })).toBe(spreadFor(pistol, { aiming: false, speed: MOVEMENT.sprintSpeed, crouching: false }));
    expect(spreadFor(pistol, { aiming: false, speed: -5, crouching: false })).toBe(still);
  });

  it("aimDirection is a unit vector looking down -Z at yaw 0 and up with elevation", () => {
    expect(aimDirection(0, 0, v)).toEqual({ x: -0, y: 0, z: -1 });
    const d = aimDirection(Math.PI / 2, 0, { x: 0, y: 0, z: 0 });
    expect(d.x).toBeCloseTo(-1, 9);
    expect(d.z).toBeCloseTo(0, 9);
    const up = aimDirection(0.3, 0.7, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1, 9);
    expect(up.y).toBeCloseTo(Math.sin(0.7), 9);
  });

  it("a shot pattern is deterministic: the same seed and index give bit-identical directions, different ones differ", () => {
    const seed = shotSeed(1234, 2, 17);
    expect(shotSeed(1234, 2, 17)).toBe(seed);
    expect(shotSeed(1234, 3, 17)).not.toBe(seed);
    expect(shotSeed(1234, 2, 18)).not.toBe(seed);
    expect(shotSeed(1235, 2, 17)).not.toBe(seed);
    const a = shotDirection(0.4, 0.1, 0.1, seed, 3, { x: 0, y: 0, z: 0 });
    const b = shotDirection(0.4, 0.1, 0.1, seed, 3, { x: 0, y: 0, z: 0 });
    expect(a).toEqual(b);
    const c = shotDirection(0.4, 0.1, 0.1, seed, 4, { x: 0, y: 0, z: 0 });
    expect(c).not.toEqual(a);
    // pinned values: the pattern is what the client draws and the server resolves, so changing it is a wire-visible change and must be deliberate
    expect(seed).toBe(3959641721);
    expect(a.x).toBeCloseTo(-0.42292676756, 9);
    expect(a.y).toBeCloseTo(0.02914521150, 9);
    expect(a.z).toBeCloseTo(-0.90569504024, 9);
  });

  it("pellets stay inside the cone, are unit length, are centred on the aim, and fill the disc", () => {
    const yaw = 1.1;
    const elev = -0.2;
    const spread = 0.1;
    const aim = aimDirection(yaw, elev, { x: 0, y: 0, z: 0 });
    const sum = { x: 0, y: 0, z: 0 };
    let inner = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const d = shotDirection(yaw, elev, spread, 99 + (i >> 3), i & 7, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      const ang = Math.acos(Math.min(1, dot(aim, d)));
      expect(ang).toBeLessThanOrEqual(spread + 1e-9);
      if (ang < spread / 2) inner++;
      sum.x += d.x;
      sum.y += d.y;
      sum.z += d.z;
    }
    // uniform over the disc: a quarter of the pellets land in the inner half-radius
    expect(inner / n).toBeGreaterThan(0.22);
    expect(inner / n).toBeLessThan(0.28);
    // the mean pellet is the aim
    const m = Math.hypot(sum.x, sum.y, sum.z);
    expect(dot(aim, { x: sum.x / m, y: sum.y / m, z: sum.z / m })).toBeGreaterThan(0.9999);
  });

  it("zero spread is exactly the aim, and a hostile NaN spread cannot make NaN directions leak out as a valid-looking shot", () => {
    const aim = aimDirection(0.5, 0.25, { x: 0, y: 0, z: 0 });
    const d = shotDirection(0.5, 0.25, 0, 7, 0, { x: 0, y: 0, z: 0 });
    expect(d.x).toBeCloseTo(aim.x, 12);
    expect(d.y).toBeCloseTo(aim.y, 12);
    expect(d.z).toBeCloseTo(aim.z, 12);
    const bad = shotDirection(0.5, 0.25, NaN, 7, 0, { x: 0, y: 0, z: 0 });
    expect(Number.isFinite(bad.x + bad.y + bad.z)).toBe(false); // callers validate (the server never passes a spread it did not compute)
  });
});

describe("wire helpers", () => {
  it("elevation round-trips within a thousandth of a degree, clamps and survives garbage", () => {
    for (const e of [-1.4, -0.5, 0, 0.001, 0.77, 1.4]) expect(Math.abs(elevFromWire(elevToWire(e)) - e)).toBeLessThan(1e-4);
    expect(elevFromWire(elevToWire(9))).toBe(COMBAT.aimElevMax);
    expect(elevFromWire(elevToWire(-9))).toBe(-COMBAT.aimElevMax);
    expect(elevToWire(NaN)).toBe(0);
    expect(elevFromWire(NaN)).toBe(0);
    expect(elevFromWire(32767)).toBe(COMBAT.aimElevMax);
    expect(elevToWire(COMBAT.aimElevMax)).toBeLessThanOrEqual(32767);
  });

  it("weapon slot: 0 is nothing drawn, ids are offset by one, junk decodes to nothing", () => {
    expect(weaponToWire(-1)).toBe(0);
    expect(weaponFromWire(0)).toBe(-1);
    for (let i = 0; i < WEAPON_COUNT; i++) expect(weaponFromWire(weaponToWire(i as WeaponId))).toBe(i);
    for (const junk of [8, 200, 255, -3, 1.5, NaN]) expect(weaponFromWire(junk)).toBe(-1);
  });
});

describe("projectile lag", () => {
  it("a young projectile is judged with the shooter's full lag, an old one in the present, smoothly between; never negative", () => {
    expect(projectileLag(180, 0)).toBe(180);
    expect(projectileLag(180, COMBAT.projectileRewindHold)).toBe(180);
    expect(projectileLag(180, COMBAT.projectileRewindHold + COMBAT.projectileRewindFade)).toBe(0);
    expect(projectileLag(180, 5)).toBe(0);
    let prev = 180;
    for (let a = 0; a < 0.6; a += 0.01) {
      const l = projectileLag(180, a);
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      expect(l).toBeGreaterThanOrEqual(0);
      prev = l;
    }
    expect(projectileLag(-50, 0)).toBe(0);
  });
});

describe("cannon crew", () => {
  it("nobody loads nothing; a lone gunner works at half speed; two or more at full speed and no faster", () => {
    expect(cannonLoadRate(0)).toBe(0);
    expect(cannonLoadRate(-1)).toBe(0);
    expect(cannonLoadRate(2)).toBeCloseTo(cannonLoadRate(1) * 2, 12);
    expect(cannonLoadRate(3)).toBe(cannonLoadRate(2));
    expect(1 / cannonLoadRate(2)).toBeCloseTo(CANNON.loadSeconds, 9);
  });
});

describe("the camp cannon", () => {
  it("stands in every campaign as one collidable fixture, clear of the camp, the trees and the spawn, with room for a crew round it", () => {
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      const w = createArena(seed);
      const guns = w.obstacles.filter((o) => o.tag === "cannon");
      expect(guns, `seed ${seed}`).toHaveLength(CANNON_SPOTS.length);
      const g = guns[0]!;
      expect(g.x).toBe(CANNON_SPOTS[0]!.x);
      for (const o of w.obstacles) {
        if (o === g) continue;
        const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
        expect(Math.hypot(o.x - g.x, o.z - g.z) - r, `seed ${seed} ${o.tag}`).toBeGreaterThan(1.6);
      }
      // a crew stands within reach on at least six of eight bearings
      let open = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = g.x + Math.cos(a) * 1.9;
        const z = g.z + Math.sin(a) * 1.9;
        if (w.obstacles.every((o) => o === g || Math.hypot(o.x - x, o.z - z) > (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz)) + 0.5)) open++;
      }
      expect(open, `seed ${seed}`).toBeGreaterThanOrEqual(6);
    }
  });
});
