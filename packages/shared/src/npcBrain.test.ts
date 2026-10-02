import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { NPC } from "./campaignTypes.ts";
import { CollisionWorld } from "./collision.ts";
import { BUTTON, FLAG, MOVEMENT } from "./constants.ts";
import { NPC_SIDE, type NavApi, type NpcBody, type NpcSenses, type NpcSpec } from "./expeditionTypes.ts";
import { moraleBand } from "./morale.ts";
import { NavQuery, buildNavGrid } from "./nav.ts";
import { NPC_TUNING, npcBrainNew, npcHeardShot, npcThink, type NpcBrainState } from "./npcBrain.ts";
import { stepCharacter, yawFromWire, yawToWire, type CharState, type MoveCommand } from "./movement.ts";
import { Rng, hashFloat } from "./rng.ts";
import { WEAPON, elevFromWire, weaponToWire, type WeaponId } from "./weapons.ts";

const cmd = (): MoveCommand => ({ moveF: 0, moveR: 0, yaw: 0, buttons: 0 });
const wireOf = (w: WeaponId) => weaponToWire(w);
const body = (o: Partial<NpcBody> = {}): NpcBody => ({ x: 0, z: 0, facing: 0, health: 100, weapon: wireOf(WEAPON.RIFLE), ammo: 5, flags: FLAG.GROUNDED, vx: 0, vz: 0, ...o });
const spec = (o: Partial<NpcSpec> = {}): NpcSpec => ({
  id: "t", role: NPC.SENTRY, faction: "ward", side: NPC_SIDE[NPC.SENTRY]!, group: "ward", post: { x: 0, z: 0 }, weapon: WEAPON.RIFLE, lookSeed: 1, name: "T", skill: 50, bravery: 50, brain: "garrison", ...o,
});
/** A stand-in for the grid: sight everywhere, a straight "path", a cover and flank point on request. */
const fakeNav = (o: { cover?: { x: number; z: number }; flank?: { x: number; z: number }; los?: boolean } = {}): NavApi => ({
  open: () => true,
  los: () => o.los ?? true,
  path: (_sx, _sz, tx, tz, out) => { out.x[0] = tx; out.z[0] = tz; out.n = 1; out.complete = true; return true; },
  cover: (_fx, _fz, _tx, _tz, _r, out) => { if (!o.cover) return false; out.x = o.cover.x; out.z = o.cover.z; return true; },
  flank: (_fx, _fz, _tx, _tz, _s, _d, out) => { if (!o.flank) return false; out.x = o.flank.x; out.z = o.flank.z; return true; },
  nearestOpen: (x, z, out) => { out.x = x; out.z = z; return true; },
});
const senses = (o: Partial<NpcSenses> = {}): NpcSenses => ({ allies: 3, alliesDown: 0, alert: false, standDown: false, fear: 10, token: true, underFire: 0, now: 0, rain: 0, nav: fakeNav(), ...o });
const foe = (x: number, z: number, o: Partial<NonNullable<NpcSenses["enemy"]>> = {}): NpcSenses["enemy"] => ({ id: "p1", x, z, armed: true, moving: 0, down: false, ...o });
/** Direction the command walks (the step's camera-relative convention: yaw 0 looks down -Z). */
const walk = (c: MoveCommand): { x: number; z: number } => {
  const y = yawFromWire(c.yaw), f = c.moveF / 127, r = c.moveR / 127;
  return { x: -Math.sin(y) * f + Math.cos(y) * r, z: -Math.cos(y) * f - Math.sin(y) * r };
};
const DT = 1 / 30;

/** Runs `seconds` of ticks (the host's job: advance `now`), calling `each` with the command after every tick. */
function run(b: NpcBrainState, me: NpcBody, sn: NpcSenses, seconds: number, each?: (c: MoveCommand, t: number) => void): void {
  const n = Math.round(seconds / DT);
  const c = cmd();
  for (let i = 0; i < n; i++) {
    sn.now = i * DT;
    npcThink(b, me, sn, DT, c);
    each?.(c, sn.now);
  }
}
const isFire = (c: MoveCommand): boolean => (c.buttons & BUTTON.FIRE) !== 0;
/** A lookSeed whose brain has the wanted boldness. */
function seedWith(pred: (bold: number) => boolean): number {
  for (let s = 1; s < 5000; s++) if (pred(hashFloat(s, 0xb01d, 1))) return s;
  throw new Error("no seed");
}

describe("npcThink: discipline", () => {
  it("is deterministic: equal brain, body and senses give equal commands", () => {
    const once = (): MoveCommand[] => {
      const b = npcBrainNew(spec());
      const out: MoveCommand[] = [];
      run(b, body(), senses({ alert: true, enemy: foe(0, -22) }), 8, (c) => out.push({ ...c }));
      return out;
    };
    expect(once()).toEqual(once());
  });

  it("does nothing about a player in sight until it has been provoked (alert)", () => {
    const b = npcBrainNew(spec());
    let fired = 0;
    run(b, body(), senses({ enemy: foe(0, -8) }), 10, (c) => { if (isFire(c)) fired++; });
    expect(b.mode).toBe("post");
    expect(fired).toBe(0);
  });

  it("walks back to its post when displaced", () => {
    const b = npcBrainNew(spec({ post: { x: 10, z: 0 } }));
    const c = cmd();
    npcThink(b, body({ x: 0, z: 0 }), senses({ now: 0 }), DT, c);
    expect(walk(c).x).toBeGreaterThan(0.9);
  });

  it("never acts in stand_down, whatever it is told, and the stand-down is latched", () => {
    const b = npcBrainNew(spec());
    const c = cmd();
    npcThink(b, body(), senses({ standDown: true, alert: true, enemy: foe(0, -3) }), DT, c);
    expect(b.mode).toBe("stand_down");
    for (let i = 0; i < 50; i++) {
      c.moveF = 99;
      c.buttons = 0xffff;
      npcThink(b, body({ health: 5 }), senses({ standDown: false, alert: true, enemy: foe(0, -3), now: i * DT }), DT, c);
      expect(b.mode).toBe("stand_down");
      expect(c.moveF).toBe(0);
      expect(c.moveR).toBe(0);
      expect(c.buttons).toBe(0);
    }
  });

  it("does nothing while downed", () => {
    const b = npcBrainNew(spec());
    const c = cmd();
    npcThink(b, body({ flags: FLAG.DOWNED }), senses({ alert: true, enemy: foe(0, -3) }), DT, c);
    expect(c.moveF).toBe(0);
    expect(c.buttons).toBe(0);
  });

  it("ignores a downed enemy", () => {
    const b = npcBrainNew(spec());
    let fired = 0;
    run(b, body(), senses({ alert: true, enemy: foe(0, -12, { down: true }) }), 8, (c) => { if (isFire(c)) fired++; });
    expect(fired).toBe(0);
    expect(b.mode).not.toBe("fire");
  });

  it("survives hostile input: NaN dt, NaN facing, infinite fear, NaN enemy", () => {
    const b = npcBrainNew(spec({ bravery: Number.NaN, skill: Number.NaN }));
    const c = cmd();
    npcThink(b, body({ facing: Number.NaN, health: Number.NaN, x: Number.NaN }), senses({ fear: Infinity, allies: Number.NaN, now: Number.NaN, alert: true, enemy: foe(Number.NaN, 4) }), Number.NaN, c);
    expect(Number.isFinite(c.yaw) && Number.isFinite(c.moveF) && Number.isFinite(c.aimYaw ?? 0) && Number.isFinite(c.aimElev ?? 0)).toBe(true);
    expect(Number.isFinite(b.morale.v)).toBe(true);
  });
});

describe("npcThink: attack tokens", () => {
  it("fires only with a token, and does not fire at all without one", () => {
    const withToken = npcBrainNew(spec());
    const without = npcBrainNew(spec());
    let a = 0, z = 0;
    run(withToken, body(), senses({ alert: true, enemy: foe(0, -20), token: true }), 30, (c) => { if (isFire(c)) a++; });
    run(without, body(), senses({ alert: true, enemy: foe(0, -20), token: false }), 30, (c) => { if (isFire(c)) z++; });
    expect(a).toBeGreaterThan(3);
    expect(z).toBe(0);
  });

  it("a token revoked mid-fight stops the shooting within the burst", () => {
    const b = npcBrainNew(spec({ weapon: WEAPON.PISTOL }));
    const me = body({ weapon: wireOf(WEAPON.PISTOL) });
    const sn = senses({ alert: true, enemy: foe(0, -10), token: true });
    let fired = 0;
    run(b, me, sn, 10, () => {});
    sn.token = false;
    run(b, me, sn, 10, (c) => { if (isFire(c)) fired++; });
    expect(fired).toBe(0);
  });

  it("without a token a rifleman takes cover when there is some, and goes for the flank when it is bold and friends are frontal", () => {
    const covered = npcBrainNew(spec());
    run(covered, body(), senses({ alert: true, enemy: foe(0, -22), token: false, underFire: 0.6, nav: fakeNav({ cover: { x: 4, z: 2 } }) }), 6);
    expect(covered.mode).toBe("cover");
    const bold = npcBrainNew(spec({ lookSeed: seedWith((v) => v > 0.8) }));
    run(bold, body(), senses({ alert: true, enemy: foe(0, -22), token: false, allies: 3, nav: fakeNav({ flank: { x: 12, z: -14 } }) }), 6);
    expect(bold.mode).toBe("flank");
    const c = cmd();
    npcThink(bold, body(), senses({ alert: true, enemy: foe(0, -22), token: false, nav: fakeNav({ flank: { x: 12, z: -14 } }), now: 7 }), DT, c);
    expect(walk(c).x).toBeGreaterThan(0.2); // heading for the flank point (east of the line to the target)
    const timid = npcBrainNew(spec({ lookSeed: seedWith((v) => v < 0.1) }));
    run(timid, body(), senses({ alert: true, enemy: foe(0, -22), token: false, allies: 3, nav: fakeNav({ flank: { x: 12, z: -14 } }) }), 6);
    expect(timid.mode).not.toBe("flank");
  });

  it("closes the distance when out of range, with the stick forward", () => {
    const b = npcBrainNew(spec({ weapon: WEAPON.PISTOL }));
    let moved = false;
    run(b, body({ weapon: wireOf(WEAPON.PISTOL) }), senses({ alert: true, enemy: foe(0, -45) }), 5, (c) => { if (walk(c).z < -0.9) moved = true; });
    expect(moved).toBe(true);
    expect(b.mode).toBe("advance");
  });
});

describe("npcThink: believable misses", () => {
  const firstFire = (skill: number, seed: number): number => {
    const b = npcBrainNew(spec({ skill, lookSeed: seed }));
    let t = -1;
    run(b, body(), senses({ alert: true, enemy: foe(0, -20) }), 8, (c, now) => { if (t < 0 && isFire(c)) t = now; });
    return t;
  };

  it("takes 0.35 .. 0.65 s to react at skill 100 and 1.25 .. 1.55 s at skill 0 (plus the decision tick), never firing first", () => {
    for (let s = 1; s <= 40; s++) {
      const fast = firstFire(100, s);
      const slow = firstFire(0, s);
      expect(fast).toBeGreaterThanOrEqual(NPC_TUNING.react.base - 0.05);
      expect(fast).toBeLessThan(1.6);
      expect(slow).toBeGreaterThanOrEqual(NPC_TUNING.react.base + NPC_TUNING.react.perSkill - 0.05);
      expect(slow).toBeGreaterThan(fast);
    }
  });

  it("reacts again to a target it lost for more than two seconds, not to one it kept seeing", () => {
    const b = npcBrainNew(spec({ skill: 100 }));
    const me = body();
    const sn = senses({ alert: true, enemy: foe(0, -20) });
    run(b, me, sn, 4);
    expect(b.react).toBe(0);
    // looks away for 1 s: no new reaction
    sn.enemy = undefined;
    const c = cmd();
    for (let i = 0; i < 30; i++) { sn.now = 4 + i * DT; npcThink(b, me, sn, DT, c); }
    sn.enemy = foe(0, -20);
    sn.now = 5.1;
    npcThink(b, me, sn, DT, c);
    expect(b.react).toBe(0);
    // gone for 3 s: a new reaction
    sn.enemy = undefined;
    for (let i = 0; i < 90; i++) { sn.now = 5.1 + i * DT; npcThink(b, me, sn, DT, c); }
    sn.enemy = foe(0, -20);
    sn.now = 8.2;
    npcThink(b, me, sn, DT, c);
    expect(b.react).toBeGreaterThan(0.3);
    // a different target is a new target too
    b.react = 0;
    sn.enemy = foe(3, -20, { id: "p2" });
    sn.now = 8.3;
    npcThink(b, me, sn, DT, c);
    expect(b.react).toBeGreaterThan(0.3);
  });

  it("turns at half the walker's rate while reacting", () => {
    const b = npcBrainNew(spec({ skill: 0 }));
    const me = body({ facing: 0 });
    const sn = senses({ alert: true, enemy: foe(20, 0) }); // 90 degrees off
    const c = cmd();
    let facing = me.facing;
    const turn: number[] = [];
    for (let i = 0; i < 8; i++) {
      sn.now = i * DT;
      me.facing = facing;
      npcThink(b, me, sn, DT, c);
      const yaw = yawFromWire(c.yaw);
      let d = Math.atan2(Math.sin(yaw - facing), Math.cos(yaw - facing));
      turn.push(Math.abs(d));
      facing = yaw;
      expect(isFire(c)).toBe(false);
      expect(c.moveF).toBe(0);
    }
    const max = MOVEMENT.turnRate * NPC_TUNING.react.turnFactor * DT;
    for (const t of turn) expect(t).toBeLessThanOrEqual(max + 1e-3);
  });

  /** RMS aim error of the FIRST shot at a target, over many shooters. */
  const rmsError = (o: { dist: number; moving?: number; skill?: number; weapon?: WeaponId; shotsBefore?: number }): number => {
    let sum = 0, n = 0;
    for (let s = 1; s <= 120; s++) {
      const b = npcBrainNew(spec({ lookSeed: s * 7919, skill: o.skill ?? 50, weapon: o.weapon ?? WEAPON.RIFLE }));
      const me = body({ weapon: wireOf(o.weapon ?? WEAPON.RIFLE) });
      const sn = senses({ alert: true, enemy: foe(0, -o.dist, { moving: o.moving ?? 0 }) });
      const want = o.shotsBefore ?? 0;
      let shots = 0;
      const c = cmd();
      for (let i = 0; i < 40 * 30 && shots <= want; i++) {
        sn.now = i * DT;
        npcThink(b, me, sn, DT, c);
        if (!isFire(c)) continue;
        if (shots === want) {
          const e = Math.atan2(Math.sin(yawFromWire(c.aimYaw!) - yawFromWire(c.yaw)), Math.cos(yawFromWire(c.aimYaw!) - yawFromWire(c.yaw)));
          sum += e * e;
          n++;
        }
        shots++;
      }
    }
    return Math.sqrt(sum / Math.max(n, 1));
  };

  it("aim error grows with range and with a moving target, shrinks with skill, and ranges in on a target that stands still", () => {
    const near = rmsError({ dist: 10 });
    const far = rmsError({ dist: 28 });
    expect(far).toBeGreaterThan(near * 1.4); // (1 + 28/20) / (1 + 10/20) = 1.6
    const still = rmsError({ dist: 25 });
    const moving = rmsError({ dist: 25, moving: 4 });
    expect(moving / still).toBeGreaterThan(1.4);
    expect(moving / still).toBeLessThan(1.9);
    const poor = rmsError({ dist: 25, skill: 10 });
    const sharp = rmsError({ dist: 25, skill: 90 });
    expect(poor).toBeGreaterThan(sharp * 1.4);
    // ranging in: each consecutive shot at a still target is 25% tighter
    const later = rmsError({ dist: 25, shotsBefore: 4 });
    expect(later / still).toBeLessThan(0.45);
    expect(later / still).toBeGreaterThan(0.2);
  });

  it("a target that starts moving resets the ranging", () => {
    const b = npcBrainNew(spec());
    const me = body();
    const sn = senses({ alert: true, enemy: foe(0, -25) });
    run(b, me, sn, 40);
    expect(b.ranged).toBeGreaterThan(2);
    sn.enemy = foe(0, -25, { moving: 4 });
    sn.now = 41;
    npcThink(b, me, sn, DT, cmd());
    expect(b.ranged).toBe(0);
  });

  it("the shot is aimed within the combat slack and slightly low (chest, not eye)", () => {
    const b = npcBrainNew(spec());
    const slack = 0.6;
    run(b, body(), senses({ alert: true, enemy: foe(0, -25) }), 60, (c) => {
      if (!isFire(c)) return;
      const d = Math.atan2(Math.sin(yawFromWire(c.aimYaw!) - yawFromWire(c.yaw)), Math.cos(yawFromWire(c.aimYaw!) - yawFromWire(c.yaw)));
      expect(Math.abs(d)).toBeLessThan(slack);
      expect(elevFromWire(c.aimElev!)).toBeLessThan(0.01);
      expect(elevFromWire(c.aimElev!)).toBeGreaterThan(-0.06);
    });
  });
});

describe("npcThink: cadence", () => {
  const shots = (weapon: WeaponId, dist: number, seconds: number, ammoAlways = 2): number[] => {
    const b = npcBrainNew(spec({ weapon }));
    const times: number[] = [];
    run(b, body({ weapon: wireOf(weapon), ammo: ammoAlways }), senses({ alert: true, enemy: foe(0, -dist) }), seconds, (c, t) => { if (isFire(c)) times.push(t); });
    return times;
  };

  it("a rifle fires one shot then thinks for 0.3-1.2 s", () => {
    const t = shots(WEAPON.RIFLE, 22, 60);
    expect(t.length).toBeGreaterThan(10);
    for (let i = 1; i < t.length; i++) {
      expect(t[i]! - t[i - 1]!).toBeGreaterThanOrEqual(NPC_TUNING.rifleThink[0]! - 0.05);
      expect(t[i]! - t[i - 1]!).toBeLessThanOrEqual(NPC_TUNING.rifleThink[1]! + 0.12);
    }
  });

  it("a pistol fires in pairs and then pauses 1.0-2.2 s", () => {
    const t = shots(WEAPON.PISTOL, 12, 60);
    expect(t.length).toBeGreaterThan(8);
    const gaps = t.slice(1).map((v, i) => v - t[i]!);
    const short = gaps.filter((g) => g < 0.6).length;
    const long = gaps.filter((g) => g >= 0.95);
    expect(short).toBeGreaterThan(2);
    expect(long.length).toBeGreaterThan(2);
    for (const g of long) expect(g).toBeLessThanOrEqual(NPC_TUNING.pistolPause[1]! + 0.12);
    // the shots alternate: pair, pause, pair
    expect(Math.abs(short - long.length)).toBeLessThanOrEqual(2);
  });

  it("a blunderbuss only fires inside 14 m", () => {
    expect(shots(WEAPON.BLUNDERBUSS, 20, 20).length).toBe(0);
    expect(shots(WEAPON.BLUNDERBUSS, 9, 20).length).toBeGreaterThan(5);
  });

  it("melee closes only with a token, pads its swings, and an empty gun is reloaded instead of fired", () => {
    const sab = npcBrainNew(spec({ weapon: WEAPON.SABRE }));
    const me = body({ weapon: wireOf(WEAPON.SABRE), ammo: 0 });
    const t: number[] = [];
    run(sab, me, senses({ alert: true, enemy: foe(0, -1.2) }), 20, (c, now) => { if (isFire(c)) t.push(now); });
    expect(t.length).toBeGreaterThan(5);
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThanOrEqual(0.7 + NPC_TUNING.meleePad - 0.05);
    const noTok = npcBrainNew(spec({ weapon: WEAPON.SABRE }));
    let moved = false, swung = 0;
    run(noTok, me, senses({ alert: true, enemy: foe(0, -9), token: false }), 10, (c) => { if (walk(c).z < -0.5) moved = true; if (isFire(c)) swung++; });
    expect(moved).toBe(false);
    expect(swung).toBe(0);
    const gun = npcBrainNew(spec());
    let reload = 0, fire = 0;
    run(gun, body({ ammo: 0 }), senses({ alert: true, enemy: foe(0, -10) }), 6, (c) => { if (c.buttons & BUTTON.RELOAD) reload++; if (isFire(c)) fire++; });
    expect(reload).toBeGreaterThan(0);
    expect(fire).toBe(0);
  });
});

describe("npcThink: morale", () => {
  it("flees at broken morale (wounded, frightened, alone), sprints away, never fires, and stays latched until rallied and 25 m clear", () => {
    const b = npcBrainNew(spec());
    const me = body({ health: 12 });
    const sn = senses({ alert: true, allies: 0, alliesDown: 3, fear: 90, underFire: 1, enemy: foe(0, -10) });
    let last = cmd();
    run(b, me, sn, 14, (c) => { last = { ...c }; });
    expect(b.mode).toBe("flee");
    expect(moraleBand(b.morale.v)).toBe("broken");
    expect(walk(last).z).toBeGreaterThan(0.9); // enemy north (-z): away is south
    expect(last.buttons & BUTTON.SPRINT).toBeTruthy();
    expect(last.buttons & BUTTON.FIRE).toBe(0);
    // far away but still frightened: still routed, and after the run it stands still
    sn.enemy = undefined;
    sn.now = 20;
    run(b, me, sn, 30, (c) => { last = { ...c }; });
    expect(b.mode).toBe("flee");
    expect(last.moveF).toBe(0);
    // calm and healthy again, enemy 30 m off: it rallies
    sn.enemy = foe(0, -30);
    sn.fear = 0; sn.underFire = 0; sn.allies = 4; sn.alliesDown = 0;
    me.health = 100;
    b.morale.shock = 0;
    let rallied = false;
    run(b, me, sn, 60, () => { if (b.mode !== "flee") rallied = true; });
    expect(rallied).toBe(true);
  });

  it("a healthy, unafraid sentry does not flee; company and a leader hold the line longer", () => {
    const steady = npcBrainNew(spec());
    run(steady, body(), senses({ alert: true, enemy: foe(0, -10) }), 20);
    expect(steady.mode).not.toBe("flee");
    const after = (allies: number): number => {
      const b = npcBrainNew(spec());
      run(b, body({ health: 60 }), senses({ alert: true, allies, fear: 70, enemy: foe(0, -10) }), 20);
      return b.morale.v;
    };
    expect(after(4)).toBeGreaterThan(after(0));
  });

  it("a brave NPC outlasts a timid one under the same fire", () => {
    const t = (bravery: number): number => {
      const b = npcBrainNew(spec({ bravery }));
      run(b, body({ health: 70 }), senses({ alert: true, allies: 1, alliesDown: 1, underFire: 0.7, fear: 40, enemy: foe(0, -15) }), 30);
      return b.morale.v;
    };
    expect(t(90)).toBeGreaterThan(t(10) + 20);
  });
});

describe("npcThink: no thrash", () => {
  it("never changes mode faster than the 1.2 s dwell in a 60 s fuzz of everything the world can throw at it", () => {
    let totalFlips = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = new Rng(seed * 101);
      const b = npcBrainNew(spec({ lookSeed: seed * 31, weapon: [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.SABRE][seed % 3] as WeaponId, bravery: 30 + seed * 10 }));
      const me = body({ weapon: wireOf([WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.SABRE][seed % 3] as WeaponId) });
      const sn = senses({ alert: true });
      const c = cmd();
      let prev = b.mode, since = 0;
      const flips: number[] = [];
      for (let i = 0; i < 60 * 30; i++) {
        const now = i * DT;
        sn.now = now;
        if (i % 20 === 0) {
          sn.enemy = r.chance(0.8) ? foe(r.range(-30, 30), r.range(-40, 10), { moving: r.chance(0.4) ? 4 : 0, armed: r.chance(0.8) }) : undefined;
          sn.token = r.chance(0.5);
          sn.underFire = r.chance(0.3) ? r.next() : 0;
          sn.allies = r.int(0, 5);
          sn.alliesDown = r.int(0, 3);
          sn.fear = r.range(0, 60);
          sn.nav = fakeNav({ cover: r.chance(0.5) ? { x: r.range(-8, 8), z: r.range(-8, 8) } : undefined, flank: r.chance(0.5) ? { x: r.range(-14, 14), z: r.range(-14, 14) } : undefined });
        }
        me.health = i % 400 < 200 ? 100 : 40;
        if (i % 540 === 539) { b.morale.v = 85; b.morale.shock = 0; } // the world rallies it now and then, so the fuzz sees every mode
        npcThink(b, me, sn, DT, c);
        if (b.mode !== prev) {
          if (flips.length > 0 || since > 0) flips.push(now - since); // (the very first decision is free: the brain starts undecided)
          prev = b.mode;
          since = now;
        }
      }
      totalFlips += flips.length;
      for (const f of flips) expect(f).toBeGreaterThanOrEqual(NPC_TUNING.dwell - 1e-6);
    }
    expect(totalFlips).toBeGreaterThan(20);
  });
});

describe("npcThink: marching and posts", () => {
  it("follows the path the host gave it, in order, and stands at the end", () => {
    const b = npcBrainNew(spec({ faction: "rival", role: NPC.RIVAL_GUARD }));
    const pts = [{ x: 0, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 0 }];
    pts.forEach((p, i) => { b.path.x[i] = p.x; b.path.z[i] = p.z; });
    b.path.n = 3;
    b.mode = "march";
    b.route = 0;
    let x = 0, z = 0;
    const seen = [0];
    const c = cmd();
    const sn = senses();
    for (let i = 0; i < 3000 && b.route < 3; i++) {
      sn.now = i * DT;
      npcThink(b, body({ x, z }), sn, DT, c);
      if (seen[seen.length - 1] !== b.route) seen.push(b.route);
      const d = walk(c);
      x += d.x * 4.4 * DT;
      z += d.z * 4.4 * DT;
    }
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(Math.hypot(x - 10, z)).toBeLessThan(2);
    npcThink(b, body({ x, z }), sn, DT, c);
    expect(c.moveF).toBe(0);
  });

  it("a marching NPC that is engaged fights instead", () => {
    const b = npcBrainNew(spec({ faction: "rival", role: NPC.RIVAL_GUARD }));
    b.mode = "march";
    b.path.x[0] = 30; b.path.z[0] = 0; b.path.n = 1;
    run(b, body(), senses({ alert: true, enemy: foe(0, -12) }), 10);
    expect(b.mode).not.toBe("march");
  });
});

describe("npcThink with the real grid", () => {
  // a wall across the way: the NPC must path round it to get a line of sight on the enemy, with the real step
  const wall = { kind: "box" as const, tag: "wall" as const, x: 0, z: -12, hx: 14, hz: 0.4, yaw: 0, y0: -1, y1: 2.6 };
  const world = new CollisionWorld({ height: () => 0 }, [wall], 60);
  const nav = new NavQuery(buildNavGrid(world));

  it("advances round the wall by the grid's path and shoots once it can see", () => {
    const b = npcBrainNew(spec({ skill: 80 }));
    const s: CharState = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, wounds: 0, missing: 0 };
    const enemy = { x: 0, z: -34 };
    let firedSeeing = 0, firedBlind = 0;
    const c = cmd();
    let sawAt = -1;
    for (let i = 0; i < 40 * 30; i++) {
      const now = i * DT;
      const sees = nav.los(s.x, s.z, enemy.x, enemy.z);
      const sn = senses({ alert: true, now, nav, enemy: sees ? foe(enemy.x, enemy.z) : undefined, token: true });
      npcThink(b, { x: s.x, z: s.z, facing: s.facing, health: 100, weapon: wireOf(WEAPON.RIFLE), ammo: 5, flags: s.flags, vx: s.vx, vz: s.vz }, sn, DT, c);
      if (isFire(c)) { if (sees) firedSeeing++; else firedBlind++; }
      if (sees && sawAt < 0) sawAt = now;
      stepCharacter(s, c, DT, world);
      // the enemy is known to be there: the host only hands it over in sight, so the NPC walks to its last known post instead
      if (!sees && b.mode === "post") b.px = enemy.x, b.pz = enemy.z;
    }
    expect(firedBlind).toBe(0);
    expect(world.resolveXZ({ x: s.x, z: s.z }, 0, 0.4, 1.7)).toBe(false);
    // it walked to the enemy's side of the wall (it can only have, via the open ends)
    expect(sawAt).toBeGreaterThan(0);
    expect(firedSeeing).toBeGreaterThan(0);
  });
});

describe("npcThink performance", () => {
  it("is allocation-free: a quarter of a million ticks retain no memory", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const b = npcBrainNew(spec());
    const me = body();
    const sn = senses({ alert: true, enemy: foe(0, -12), nav: fakeNav({ cover: { x: 2, z: 2 }, flank: { x: 9, z: -9 } }) });
    const c = cmd();
    const tickOnce = (i: number): void => {
      me.x = Math.sin(i * 0.01) * 3;
      sn.enemy!.z = -12 - (i % 50) * 0.1;
      sn.token = i % 300 < 200;
      sn.underFire = i % 500 < 100 ? 0.8 : 0;
      sn.now = i * DT;
      npcThink(b, me, sn, DT, c);
    };
    for (let i = 0; i < 20000; i++) tickOnce(i);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 250000; i++) tickOnce(i);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(400_000);
  });

  it("yaw is always a valid wire value", () => {
    const b = npcBrainNew(spec());
    const c = cmd();
    run(b, body({ facing: 100 }), senses({ alert: true, enemy: foe(3, -9) }), 3, (cc) => { expect(cc.yaw).toBe(yawToWire(yawFromWire(cc.yaw))); });
    void c;
  });
});

describe("npcHeardShot (D-041): shot at by somebody it cannot see", () => {
  // the bot playtest sniped the Ward's ford patrol from 45 m (beyond 28 m of sight) and from behind the bridge parapet: nobody ever came
  const fwd = (c: MoveCommand): number => (c.moveF > 0 ? walk(c).z : 0);
  it("an alert soldier goes toward where the shot came from, for the search time, then goes home", () => {
    const b = npcBrainNew(spec());
    const me = body();
    npcHeardShot(b, 0, -45, 0);
    let toward = 0, late = 0;
    run(b, me, senses({ alert: true }), NPC_TUNING.search + 2, (c, t) => {
      if (t > 0.5 && t < NPC_TUNING.search - 0.1 && fwd(c) < -0.9) toward++;
      if (t > NPC_TUNING.search + 0.1 && c.moveF !== 0) late++;
    });
    expect(toward).toBeGreaterThan((NPC_TUNING.search - 0.6) / DT - 3);
    expect(late).toBe(0); // (still at its post: home is where it stands)
  });
  it("never fires at a place: it walks, it does not shoot", () => {
    const b = npcBrainNew(spec());
    npcHeardShot(b, 0, -20, 0);
    let fired = 0;
    run(b, body(), senses({ alert: true }), 4, (c) => { if (isFire(c)) fired++; });
    expect(fired).toBe(0);
  });
  it("within its range it stops, unless the spot is behind something, when it keeps closing to where it can see it", () => {
    const at = (los: boolean): number => {
      const b = npcBrainNew(spec());
      npcHeardShot(b, 0, -40, 0);
      let walked = 0;
      run(b, body({ z: -25 }), senses({ alert: true, nav: fakeNav({ los }) }), 3, (c) => { if (fwd(c) < -0.9) walked++; });
      return walked;
    };
    expect(at(true)).toBe(0);
    expect(at(false)).toBeGreaterThan(2 / DT);
  });
  it("a soldier who is not alert does not go looking (the site decides what a shot means)", () => {
    const b = npcBrainNew(spec());
    npcHeardShot(b, 0, -45, 0);
    let moved = 0;
    run(b, body(), senses({ alert: false }), 3, (c) => { if (c.moveF !== 0) moved++; });
    expect(moved).toBe(0);
  });
  it("a soldier fighting somebody it can see keeps fighting him; garbage is ignored", () => {
    const b = npcBrainNew(spec());
    const sn = senses({ alert: true, enemy: foe(0, -10) });
    run(b, body(), sn, 1);
    npcHeardShot(b, 50, 50, sn.now);
    expect([b.lastTx, b.lastTz]).toEqual([0, -10]);
    const c = npcBrainNew(spec());
    npcHeardShot(c, NaN, 3, 0);
    npcHeardShot(c, 3, Infinity, 0);
    expect(c.lastSeen).toBe(-1e9);
  });
});
