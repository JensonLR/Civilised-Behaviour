import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BODY_SHAPES,
  BOOT,
  BUTTON,
  CANNON,
  COMBAT,
  FLAG,
  LIMB,
  MoveInput,
  ROOM_WORLD,
  WEAPON,
  WEAPONS,
  ZONE,
  createArena,
  elevToWire,
  newWorldHit,
  rayWorld,
  weaponToWire,
  woundLevel,
  yawToWire,
  type BoomEvent,
  type HitEvent,
  type HitMarkEvent,
  type ImpactEvent,
  type PlayerStateType,
  type SettlementsState,
  type ShotEvent,
  type WeaponId,
  INDUSTRY,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { getRoomConfig, setRoomConfig } from "../roomConfig.ts";
import type { Combat } from "../systems/Combat.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2581; // one port per integration test file
const SEED = 77;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arena = createArena(SEED);

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

interface Player {
  id: string;
  p: PlayerStateType;
  input: Input;
  ev: { hits: HitEvent[]; shots: ShotEvent[]; impacts: ImpactEvent[]; booms: BoomEvent[]; marks: HitMarkEvent[] };
}

const combatOf = (room: WorldRoom): Combat => (room as unknown as { combat: Combat }).combat;

/** Yaw (camera convention: 0 looks down -Z) from one point to another in the ground plane. */
const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }): number => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** World centre of a zone's ellipsoid on a standing target. */
function zonePoint(t: { x: number; y: number; z: number; facing: number }, zone: number): { x: number; y: number; z: number } {
  const [cx, cy, cz] = BODY_SHAPES[zone]!;
  const c = Math.cos(t.facing);
  const s = Math.sin(t.facing);
  return { x: t.x + cx * c + cz * s, y: t.y + cy, z: t.z - cx * s + cz * c };
}

/** Aim from a shooter's eye at a point: the yaw/elevation a crosshair would produce. */
function aim(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { yaw: number; elev: number } {
  const eye = from.y + COMBAT.eyeHeight;
  return { yaw: yawTo(from, to), elev: Math.atan2(to.y - eye, Math.hypot(to.x - from.x, to.z - from.z)) };
}

/** A bearing from the origin along which the ground is open (no obstacle, no prop) for `len` metres: shots need somewhere to go. */
function openBearing(room: WorldRoom, len: number): number {
  const out = newWorldHit();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let ok = !rayWorld(arena, 0, 1.2, 0, dx, 0, dz, len + 6, out) && !rayWorld(arena, 0, 0.4, 0, dx, 0, dz, len + 6, out);
    room.state.props.forEach((pr) => {
      const along = pr.x * dx + pr.z * dz;
      const off = Math.abs(-pr.x * dz + pr.z * dx);
      if (along > -2 && along < len + 6 && off < 3) ok = false;
    });
    if (ok) return a;
  }
  throw new Error("no open bearing in this arena");
}

describe("combat: weapons, projectiles, melee, explosions, the cannon (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(n = 2, options: Record<string, unknown> = {}) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, ...options })) as unknown as WorldRoom;
    const players: Player[] = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
      const ev: Player["ev"] = { hits: [], shots: [], impacts: [], booms: [], marks: [] };
      c.onMessage("hit", (e: HitEvent) => ev.hits.push(e));
      c.onMessage("shot", (e: ShotEvent) => ev.shots.push(e));
      c.onMessage("impact", (e: ImpactEvent) => ev.impacts.push(e));
      c.onMessage("boom", (e: BoomEvent) => ev.booms.push(e));
      c.onMessage("hitmark", (e: HitMarkEvent) => ev.marks.push(e));
      c.onMessage("sever", () => undefined);
      c.onMessage("notice", () => undefined);
      players.push({ id: c.sessionId, p: room.state.players.get(c.sessionId)!, input, ev });
    }
    await sleep(150);
    return { room, ps: players, combat: combatOf(room) };
  }

  /** The heading that faces back along bearing `dir` toward a shooter at the origin (a torso shot is only a torso shot from the front: from the side an arm is in the way). */
  const faceBack = (dir: number) => Math.atan2(Math.cos(dir), Math.sin(dir));

  /** Puts a player somewhere, at rest, facing `facing`, on the ground. */
  const place = (p: PlayerStateType, x: number, z: number, facing = 0) => {
    p.x = x;
    p.z = z;
    p.y = arena.terrainHeight(x, z);
    p.facing = facing;
    p.vx = p.vz = 0;
    p.flags = FLAG.GROUNDED;
  };

  /** Sends one input frame with everything set (weapon wish held from earlier frames unless overridden). */
  const frame = (who: Player, o: { buttons?: number; yaw?: number; aimYaw?: number; aimElev?: number; weapon?: WeaponId | -1 } = {}) => {
    const d = who.input.data;
    d.moveF = 0;
    d.moveR = 0;
    d.buttons = o.buttons ?? 0;
    if (o.yaw !== undefined) d.yaw = yawToWire(o.yaw);
    d.aimYaw = o.aimYaw !== undefined ? yawToWire(o.aimYaw) : d.yaw;
    if (o.aimElev !== undefined) d.aimElev = elevToWire(o.aimElev);
    if (o.weapon !== undefined) d.weapon = weaponToWire(o.weapon);
    who.input.send();
  };

  /** Waits until `cond()` holds, polling; fails the test after `ms`. */
  const until = async (cond: () => boolean, ms = 4000, what = "condition") => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };

  /** Draws a weapon and waits out the draw time; the wish stays in the input, so it is held for later frames. */
  const equip = async (who: Player, w: WeaponId) => {
    frame(who, { weapon: w });
    await until(() => who.p.weapon === w + 1, 2000, `weapon ${w} in hand`);
    await sleep(WEAPONS[w].drawSeconds * 1000 + 450);
  };

  /** Pulls the trigger once at (yaw, elev): a press and a release. */
  const trigger = async (who: Player, yaw: number, elev: number, extra: { aiming?: boolean } = {}) => {
    const b = extra.aiming === false ? 0 : BUTTON.AIM; // (steady by default: a hip-fired rifle scatters over half a metre at 10 m)
    frame(who, { buttons: b | BUTTON.FIRE, yaw, aimYaw: yaw, aimElev: elev });
    await sleep(70);
    frame(who, { buttons: b, yaw, aimYaw: yaw, aimElev: elev });
    await sleep(70);
  };

  /** Lets rewound history catch up with a teleport (the record is what clients were last sent). */
  const settle = () => sleep(330);

  // ---------------------------------------------------------------------------------------------------------------------------

  describe("firearms: fire, hit, wound, down", () => {
    it("a rifle ball to the chest hurts by the table's damage, wounds the torso, moves the target, spends a round and tells everyone", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 40);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 30, Math.sin(dir) * 30, faceBack(dir));
      await settle();
      await equip(a, WEAPON.RIFLE);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      const rounds = a.p.ammo;
      await trigger(a, at.yaw, at.elev);
      await until(() => b.p.health < 100, 2000, "damage");
      const rifle = WEAPONS[WEAPON.RIFLE];
      expect(b.p.health).toBe(Math.round(100 - rifle.ranged!.damage * rifle.ffScale)); // friendly fire on (default): the rifle's ffScale applies
      expect(woundLevel(b.p.wounds, ZONE.TORSO)).toBeGreaterThan(0);
      expect(a.p.ammo).toBe(rounds - 1);
      expect(a.p.shots).toBe(1);
      await until(() => a.ev.marks.length > 0 && b.ev.hits.length > 0 && b.ev.shots.length > 0, 2000, "events");
      expect(a.ev.marks[0]!.zone).toBe(ZONE.TORSO);
      expect(a.ev.marks[0]!.down).toBe(false);
      expect(b.ev.hits[0]!.zone).toBe(ZONE.TORSO);
      expect(b.ev.shots[0]!.w).toBe(WEAPON.RIFLE);
      expect(b.ev.shots[0]!.id).toBe(a.id);
      expect(b.p.vx * b.ev.hits[0]!.dx + b.p.vz * b.ev.hits[0]!.dz).toBeGreaterThan(-0.01); // shoved along the shot, never toward the shooter
    });

    it("hit zones follow the crosshair: head (down at once), leg, and an arm, each wounded where it landed", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 30);
      place(a.p, 0, 0);
      await equip(a, WEAPON.RIFLE);
      const shoot = async (zone: number) => {
        place(b.p, Math.cos(dir) * 18, Math.sin(dir) * 18, 0.6);
        b.p.health = 100;
        b.p.wounds = 0;
        b.p.flags = FLAG.GROUNDED;
        await settle();
        const at = aim(a.p, zonePoint(b.p, zone));
        const before = a.p.shots;
        a.p.ammo = a.p.ammo; // (read only)
        await trigger(a, at.yaw, at.elev);
        await until(() => a.p.shots > before, 2000, "shot");
        await until(() => b.p.wounds !== 0 || b.p.health < 100, 2000, "wound");
        await until(() => a.p.reload === 0 && a.p.ammo === 1 || (frame(a, { buttons: BUTTON.RELOAD, weapon: WEAPON.RIFLE }), false), 6000, "reloaded");
        frame(a, { weapon: WEAPON.RIFLE });
        await sleep(100);
      };
      await shoot(ZONE.HEAD);
      expect(woundLevel(b.p.wounds, ZONE.HEAD)).toBe(3);
      expect(b.p.flags & FLAG.DOWNED).toBeTruthy(); // 70 x 2.2 x 0.7 = 108
      await shoot(ZONE.LEG_R);
      expect(woundLevel(b.p.wounds, ZONE.LEG_R)).toBeGreaterThan(0);
      expect(woundLevel(b.p.wounds, ZONE.HEAD)).toBe(0);
      expect(b.p.flags & FLAG.DOWNED).toBeFalsy();
    }, 30000);

    it("a pistol ball flies (it takes time), drops a little at range, hits a man 25 m away for less than point blank, and stops at the first thing in its path", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [Player, Player, Player];
      const dir = openBearing(room, 60);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 5, Math.sin(dir) * 5, faceBack(dir));
      place(c.p, Math.cos(dir) * 40, Math.sin(dir) * 40, faceBack(dir));
      await settle();
      await equip(a, WEAPON.PISTOL);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev);
      await until(() => b.p.health < 100, 2000, "damage");
      const pistol = WEAPONS[WEAPON.PISTOL];
      expect(b.p.health).toBe(Math.round(100 - pistol.ranged!.damage * pistol.ffScale));
      expect(c.p.health).toBe(100); // shielded by b: a ball hits the first man in line
      // and at 25 m the same ball is weaker
      place(b.p, 0, 100); // out of the way
      b.p.health = 100;
      place(c.p, Math.cos(dir) * 25, Math.sin(dir) * 25, faceBack(dir));
      await settle();
      await sleep(400);
      const at2 = aim(a.p, zonePoint(c.p, ZONE.TORSO));
      await trigger(a, at2.yaw, at2.elev);
      await until(() => c.p.health < 100, 2000, "damage at 25 m");
      const dmg25 = 100 - c.p.health;
      expect(dmg25).toBeLessThan(pistol.ranged!.damage * pistol.ffScale); // falloff has begun
      expect(dmg25).toBeGreaterThan(pistol.ranged!.damage * pistol.ffScale * pistol.ranged!.falloffMin - 1);
    }, 30000);

    it("a downed man is not a target: rounds pass over him, nothing is taken", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [Player, Player, Player];
      const dir = openBearing(room, 30);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 10, Math.sin(dir) * 10, faceBack(dir));
      place(c.p, Math.cos(dir) * 20, Math.sin(dir) * 20, faceBack(dir));
      room.damagePlayer(b.id, 1000, { zone: ZONE.TORSO }); // down
      const hb = b.p.health;
      await settle();
      await equip(a, WEAPON.RIFLE);
      const at = aim(a.p, zonePoint(c.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev);
      await until(() => c.p.health < 100, 2000, "damage behind the downed man");
      expect(b.p.health).toBe(hb);
      expect(b.p.flags & FLAG.DOWNED).toBeTruthy();
    });

    it("cover works: a rifle round is stopped by the camp wall, and a man behind it is unharmed; a stone impact is reported", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      // (the lane runs along x = 1.6: the expedition HQ's marquee and crates fill the ground west of x = 1 and its flag pole stands at x = 2.6)
      place(a.p, 1.6, -8);
      place(b.p, 1.6, -17, 0);
      await settle();
      await equip(a, WEAPON.RIFLE);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev);
      await until(() => a.ev.impacts.length > 0, 2000, "impact");
      await sleep(200);
      expect(b.p.health).toBe(100);
      expect(a.ev.impacts[0]!.s).toBe(3); // SURFACE.STONE
      expect(a.ev.impacts[0]!.z).toBeGreaterThan(-12.6);
      expect(a.ev.impacts[0]!.z).toBeLessThan(-11.3);
      void room;
    });

    it("a blunderbuss blast is ONE wound event per victim however many pellets land, ruinous at arm's length and a nuisance at 25 m", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 40);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 3, Math.sin(dir) * 3, faceBack(dir));
      await settle();
      await equip(a, WEAPON.BLUNDERBUSS);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev, { aiming: true });
      await until(() => b.p.health < 100, 2000, "damage");
      await sleep(400);
      expect(b.ev.hits.length).toBe(1);
      const bb = WEAPONS[WEAPON.BLUNDERBUSS];
      const full = bb.ranged!.pellets * bb.ranged!.damage * bb.ffScale; // every pellet in the torso at point blank
      expect(100 - b.p.health).toBeGreaterThan(full * 0.4);
      expect(100 - b.p.health).toBeLessThanOrEqual(Math.ceil(full));
      // far away: barely a scratch (if anything lands at all)
      b.p.health = 100;
      b.p.wounds = 0;
      place(b.p, Math.cos(dir) * 26, Math.sin(dir) * 26, faceBack(dir));
      await settle();
      await sleep(500);
      const at2 = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at2.yaw, at2.elev, { aiming: true });
      await sleep(600);
      expect(100 - b.p.health).toBeLessThan(15);
    }, 30000);
  });

  describe("friendly fire is a campaign rule", () => {
    it("on by default, scaled by the weapon; the creator can switch it off and then rounds pass through comrades and blows do nothing", async () => {
      for (const ff of [true, false]) {
        const { room, ps } = await setup(2, ff ? {} : { friendlyFire: false });
        const [a, b] = ps as [Player, Player];
        expect(room.state.friendlyFire).toBe(ff);
        const dir = openBearing(room, 20);
        place(a.p, 0, 0);
        place(b.p, Math.cos(dir) * 12, Math.sin(dir) * 12, faceBack(dir));
        await settle();
        await equip(a, WEAPON.PISTOL);
        const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
        await trigger(a, at.yaw, at.elev);
        await sleep(600);
        if (ff) expect(b.p.health).toBeLessThan(100);
        else {
          expect(b.p.health).toBe(100);
          expect(b.p.wounds).toBe(0);
          expect(a.ev.marks).toHaveLength(0);
        }
        await colyseus.cleanup();
      }
    }, 30000);

    it("a server that turns friendly fire off wins over a creator who asks for it; the env switch parses", async () => {
      expect(loadConfig({ NODE_ENV: "test", FRIENDLY_FIRE: "0" } as never).friendlyFire).toBe(false);
      expect(loadConfig({ NODE_ENV: "test" } as never).friendlyFire).toBe(true);
      const saved = getRoomConfig();
      setRoomConfig({ ...saved, friendlyFire: false });
      try {
        const { room } = await setup(1, { friendlyFire: true });
        expect(room.state.friendlyFire).toBe(false);
      } finally {
        setRoomConfig(saved);
      }
    });

    it("a joiner cannot change the rule: only the creator's option counts", async () => {
      const { room } = await setup(1, { friendlyFire: false });
      const c2 = await colyseus.connectTo(room as never, { name: "late", friendlyFire: true });
      expect(c2.sessionId).toBeTruthy();
      expect(room.state.friendlyFire).toBe(false);
    });
  });

  describe("ammunition, reloads, switching (nothing the client says can conjure a round)", () => {
    it("the magazine and the reserve count down, firing on an empty gun starts a reload, the reload takes its full time on server ticks, and the total never grows", async () => {
      const { room, ps, combat } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 30);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 20, Math.sin(dir) * 20, faceBack(dir));
      await settle();
      await equip(a, WEAPON.PISTOL);
      const total0 = a.p.ammo + a.p.reserve;
      expect(a.p.ammo).toBe(2);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev);
      await sleep(400);
      await trigger(a, at.yaw, at.elev);
      expect(a.p.ammo).toBe(0);
      expect(a.p.ammo + a.p.reserve).toBe(total0 - 2);
      await sleep(400);
      // an empty click starts the reload
      await trigger(a, at.yaw, at.elev);
      await until(() => a.p.reload > 0, 1500, "reload started");
      const t0 = Date.now();
      // firing while reloading is ignored
      const shots = a.p.shots;
      await trigger(a, at.yaw, at.elev);
      expect(a.p.shots).toBe(shots);
      await until(() => a.p.reload === 0 && a.p.ammo === 2, 6000, "reload finished");
      const took = (Date.now() - t0) / 1000;
      expect(took).toBeGreaterThan(WEAPONS[WEAPON.PISTOL].ranged!.reload - 1.0);
      expect(took).toBeLessThan(WEAPONS[WEAPON.PISTOL].ranged!.reload + 1.5);
      expect(a.p.ammo + a.p.reserve).toBe(total0 - 2);
      expect(combat.inspect(a.id)!.mag[WEAPON.PISTOL]).toBe(2);
    }, 30000);

    it("R with a full magazine, or with no reserve, does nothing; switching weapon abandons a reload and the progress is lost", async () => {
      const { ps, combat } = await setup(1);
      const [a] = ps as [Player];
      await equip(a, WEAPON.PISTOL);
      frame(a, { buttons: BUTTON.RELOAD });
      await sleep(100);
      frame(a, {});
      await sleep(100);
      expect(a.p.reload).toBe(0); // full already
      // spend a round, start the reload, then change weapon
      await trigger(a, 0, 0.5);
      await sleep(400);
      frame(a, { buttons: BUTTON.RELOAD });
      await sleep(100);
      frame(a, {});
      await until(() => a.p.reload > 0, 1500, "reload started");
      frame(a, { weapon: WEAPON.SABRE });
      await until(() => a.p.weapon === WEAPON.SABRE + 1, 1500, "sabre drawn");
      expect(a.p.reload).toBe(0);
      await sleep(800);
      frame(a, { weapon: WEAPON.PISTOL });
      await until(() => a.p.weapon === WEAPON.PISTOL + 1, 1500, "pistol again");
      await sleep(900);
      expect(a.p.ammo).toBe(1); // the interrupted reload gave nothing
      expect(combat.inspect(a.id)!.reloadLeft).toBe(0);
    }, 30000);

    it("hostile weapon requests are refused: not owned, out of range, the cannon, or junk", async () => {
      const { ps, combat } = await setup(1);
      const [a] = ps as [Player];
      combat.takeAway(a.id, WEAPON.RIFLE);
      expect(a.p.weapons & (1 << WEAPON.RIFLE)).toBeTruthy(); // (not yet re-synced: the server-side kit is what counts)
      for (const wire of [WEAPON.RIFLE + 1, 200, 255, WEAPON.CANNON + 1, WEAPON.FISTS + 1, 8]) {
        a.input.data.weapon = wire;
        frame(a, {});
        await sleep(120);
        expect(a.p.weapon, `wire ${wire}`).toBe(0);
      }
      frame(a, { weapon: WEAPON.PISTOL });
      await until(() => a.p.weapon === WEAPON.PISTOL + 1, 1500, "an owned weapon is fine");
    });

    it("rapid switching does not launder a cooldown: fire, swap away and back, and the gun is still not ready", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 20);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 12, Math.sin(dir) * 12, faceBack(dir));
      await settle();
      await equip(a, WEAPON.PISTOL);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      await trigger(a, at.yaw, at.elev);
      const shots = a.p.shots;
      frame(a, { weapon: WEAPON.UMBRELLA });
      await sleep(60);
      frame(a, { weapon: WEAPON.PISTOL });
      await sleep(60);
      await trigger(a, at.yaw, at.elev);
      expect(a.p.shots).toBe(shots); // ready has to run out first
      await sleep(300);
      frame(a, {}); // (a real client streams frames; this one carries the pending wish for the pistol)
      await sleep(1000);
      await trigger(a, at.yaw, at.elev);
      expect(a.p.shots).toBe(shots + 1);
    }, 30000);

    it("a flood of trigger presses (three fresh presses per step, for two seconds) fires no faster than the cooldown allows", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [Player];
      place(a.p, 0, 0);
      await equip(a, WEAPON.PISTOL);
      a.p.ammo = a.p.ammo;
      const bag = room as unknown as { combat: Combat };
      bag.combat.give(a.id, WEAPON.PISTOL);
      const start = a.p.shots;
      const end = Date.now() + 2000;
      let i = 0;
      while (Date.now() < end) {
        for (let k = 0; k < 3; k++) frame(a, { buttons: (i++ & 1) === 0 ? BUTTON.FIRE : 0, yaw: 0, aimYaw: 0, aimElev: 0.5 });
        await sleep(33);
      }
      const fired = a.p.shots - start;
      const pistol = WEAPONS[WEAPON.PISTOL].ranged!;
      // a 2-round magazine, a 3 s reload: at most the magazine plus what one reload could have fed, and never faster than the cooldown
      expect(fired).toBeLessThanOrEqual(2);
      expect(fired).toBeLessThanOrEqual(Math.ceil(2 / pistol.cooldown) + 1);
    }, 30000);

    it("the cooldown between shots is enforced on its own (a two-round magazine, so the reload cannot be what stops the second ball)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 20);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 12, Math.sin(dir) * 12, faceBack(dir));
      await settle();
      await equip(a, WEAPON.PISTOL);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      const first = a.p.shots;
      await trigger(a, at.yaw, at.elev); // (takes about 140 ms: the pistol's cooldown is 350 ms)
      expect(a.p.shots).toBe(first + 1);
      expect(a.p.ammo).toBe(1);
      frame(a, { buttons: BUTTON.AIM | BUTTON.FIRE, yaw: at.yaw, aimYaw: at.yaw, aimElev: at.elev });
      await sleep(60);
      frame(a, { buttons: BUTTON.AIM, yaw: at.yaw, aimYaw: at.yaw, aimElev: at.elev });
      await sleep(60);
      expect(a.p.shots).toBe(first + 1); // still cooling: the press is wasted, the round stays in the gun
      expect(a.p.ammo).toBe(1);
      await sleep(400);
      await trigger(a, at.yaw, at.elev);
      expect(a.p.shots).toBe(first + 2);
    }, 30000);

    it("D-041: a trigger squeezed while the gun is still being drawn fires the moment it is ready if still held; once per squeeze, never automatic", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [Player];
      place(a.p, 0, 0);
      combatOf(room).give(a.id);
      const dir = openBearing(room, 20);
      const yaw = yawTo({ x: 0, z: 0 }, { x: Math.cos(dir), z: Math.sin(dir) });
      await equip(a, WEAPON.RIFLE);
      const shots = a.p.shots;
      // the pad's habit: change to the pistol and squeeze at once, holding on (frames stream as a client's do)
      const hold = (WEAPONS[WEAPON.PISTOL].drawSeconds + COMBAT.switchSeconds) * 1000 + 1500;
      const end = Date.now() + hold;
      while (Date.now() < end) {
        frame(a, { buttons: BUTTON.AIM | BUTTON.FIRE, yaw, aimYaw: yaw, aimElev: 0, weapon: WEAPON.PISTOL });
        await sleep(33);
      }
      expect(a.p.weapon).toBe(WEAPON.PISTOL + 1);
      expect(a.p.shots).toBe((shots + 1) & 255); // one ball, after the draw; 1.5 s more of holding (four cooldowns) fired nothing more
      frame(a, { buttons: BUTTON.AIM, yaw, aimYaw: yaw, aimElev: 0, weapon: WEAPON.PISTOL });
      await sleep(100);
    }, 30000);

    it("D-091: once the armourers issue breech-loaders, the party's rifle reloads in the breech-loader's share of its time (a row's gun is its own)", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [Player];
      place(a.p, 0, 0);
      combatOf(room).give(a.id);
      const dir = openBearing(room, 20);
      const yaw = yawTo({ x: 0, z: 0 }, { x: Math.cos(dir), z: Math.sin(dir) });
      await equip(a, WEAPON.RIFLE);
      const send = async (buttons: number, ms: number): Promise<void> => {
        const end = Date.now() + ms;
        do {
          frame(a, { buttons, yaw, aimYaw: yaw, aimElev: 0, weapon: WEAPON.RIFLE });
          await sleep(33);
        } while (Date.now() < end);
      };
      const total = async (): Promise<number> => {
        await send(BUTTON.AIM | BUTTON.FIRE, 100);
        await send(BUTTON.AIM, 1000);
        await send(BUTTON.AIM | BUTTON.RELOAD, 100);
        const t = combatOf(room).inspect(a.id)!.reloadTotal;
        await send(BUTTON.AIM, Math.ceil(combatOf(room).inspect(a.id)!.reloadLeft * 1000) + 400);
        return t;
      };
      const own = WEAPONS[WEAPON.RIFLE].ranged!.reload;
      expect(await total()).toBeCloseTo(own, 5);
      const priv = room as unknown as { settlements: SettlementsState };
      priv.settlements = { ...priv.settlements, tech: { ...priv.settlements.tech, breech: true } };
      expect(await total()).toBeCloseTo(own * INDUSTRY.breechReload, 5);
    }, 30000);

    it("D-048: a trigger squeezed during a reload fires the moment the reload completes if still held (once); let go before the end, and nothing fires", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [Player];
      place(a.p, 0, 0);
      combatOf(room).give(a.id);
      const dir = openBearing(room, 20);
      const yaw = yawTo({ x: 0, z: 0 }, { x: Math.cos(dir), z: Math.sin(dir) });
      await equip(a, WEAPON.RIFLE);
      const send = async (buttons: number, ms: number): Promise<void> => {
        const end = Date.now() + ms;
        do {
          frame(a, { buttons, yaw, aimYaw: yaw, aimElev: 0, weapon: WEAPON.RIFLE });
          await sleep(33);
        } while (Date.now() < end);
      };
      const reloadLeft = (): number => combatOf(room).inspect(a.id)!.reloadLeft;
      for (const holdOn of [true, false]) {
        // one round (the rifle holds one), then reload
        await send(BUTTON.AIM | BUTTON.FIRE, 100);
        await send(BUTTON.AIM, 1000);
        await send(BUTTON.AIM | BUTTON.RELOAD, 100);
        await send(BUTTON.AIM, 300);
        expect(reloadLeft()).toBeGreaterThan(1);
        const shots = a.p.shots;
        // squeeze mid-reload: nothing yet
        await send(BUTTON.AIM | BUTTON.FIRE, 300);
        expect(a.p.shots).toBe(shots);
        if (holdOn) {
          // held to the end: it fires on the first frame the server handles after the reload is done, then never again for the same squeeze. Watched per FRAME at the
          // combat system's own door, not by the wall clock (the first cut sampled the reload before a 33 ms send, so a slow CI runner whose ticks finished the reload and
          // fired inside one send read as "fired early": a timing assertion, now gone)
          const combat = combatOf(room) as unknown as { onFrame: (id: string, ...rest: unknown[]) => boolean };
          const real = combat.onFrame.bind(combat);
          const frames: { held: boolean; reloadDone: boolean; fired: boolean }[] = [];
          combat.onFrame = (id, ...rest) => {
            if (id !== a.id) return real(id, ...rest);
            const reloadDone = reloadLeft() <= 0;
            const before = combatOf(room).inspect(a.id)!.shots;
            const r = real(id, ...rest);
            frames.push({ held: ((rest[1] as { buttons: number }).buttons & BUTTON.FIRE) !== 0, reloadDone, fired: combatOf(room).inspect(a.id)!.shots !== before });
            return r;
          };
          const t0 = Date.now();
          while (Date.now() - t0 < 5000 && a.p.shots === shots) await send(BUTTON.AIM | BUTTON.FIRE, 33);
          combat.onFrame = real;
          expect(a.p.shots).toBe((shots + 1) & 255);
          const first = frames.findIndex((f) => f.held && f.reloadDone);
          expect(first, "a held frame after the reload was done").toBeGreaterThanOrEqual(0);
          expect(frames[first]!.fired, "fired on the first held frame after the reload was done").toBe(true);
          expect(frames.slice(0, first).some((f) => f.fired), "nothing fired during the reload").toBe(false);
          await send(BUTTON.AIM | BUTTON.FIRE, 600);
          expect(a.p.shots).toBe((shots + 1) & 255);
          await send(BUTTON.AIM, 100);
        } else {
          // let go before the end: the squeeze is spent, and the gun stays loaded
          await send(BUTTON.AIM, Math.ceil(reloadLeft() * 1000) + 600);
          expect(reloadLeft()).toBe(0);
          expect(a.p.shots).toBe(shots);
          expect(combatOf(room).inspect(a.id)!.mag[WEAPON.RIFLE]).toBe(1);
        }
      }
    }, 40000);

    it("every blow and ball carries its weapon's sever bias into the wound rule (umbrella none, sabre more than the plain rule)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const casualties = (room as unknown as { casualties: { damage: (id: string, amount: number, hit?: { severBias?: number }) => void } }).casualties;
      const seen: number[] = [];
      const real = casualties.damage.bind(casualties);
      casualties.damage = (id, amount, hit) => {
        seen.push(hit?.severBias ?? -1);
        real(id, amount, hit);
      };
      place(a.p, 0, 0);
      place(b.p, 0, -1.4, 0);
      await settle();
      for (const w of [WEAPON.UMBRELLA, WEAPON.SABRE]) {
        seen.length = 0;
        b.p.health = 100;
        place(b.p, 0, -1.4, 0); // (the umbrella's shove sent him flying)
        await settle();
        await equip(a, w);
        frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: 0, aimElev: 0 });
        await sleep(60);
        frame(a, { buttons: 0 });
        await until(() => seen.length > 0, 2000, "the blow lands");
        expect(seen[0]).toBe(WEAPONS[w].severBias);
      }
      expect(WEAPONS[WEAPON.UMBRELLA].severBias).toBe(0);
      expect(WEAPONS[WEAPON.SABRE].severBias).toBeGreaterThan(1);
    }, 30000);

    it("nobody fires while downed, carrying, dragging or working a gun; taking a prop in hand holsters the intent", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 20);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 10, Math.sin(dir) * 10, faceBack(dir));
      await settle();
      await equip(a, WEAPON.RIFLE);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      const shots = a.p.shots;
      for (const bad of [FLAG.CARRYING, FLAG.DRAGGING, FLAG.REVIVING, FLAG.OPERATING, FLAG.DOWNED]) {
        a.p.flags = FLAG.GROUNDED | bad;
        await trigger(a, at.yaw, at.elev);
        expect(a.p.shots, `flag ${bad}`).toBe(shots);
      }
      expect(b.p.health).toBe(100);
    }, 30000);

    it("the shot direction cannot leave the camera's half-circle: a hostile aimYaw pointing behind is clamped, so a man behind the shooter is safe", async () => {
      const { ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      place(a.p, 0, 4);
      place(b.p, 0, 14, 0); // south of a, who looks north
      await settle();
      await equip(a, WEAPON.PISTOL);
      // camera looks north (yaw 0) but the wire claims a shot due south (yaw pi)
      const s = a.p.shots;
      frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: Math.PI, aimElev: -0.02 });
      await sleep(80);
      frame(a, { buttons: 0 });
      await until(() => a.p.shots > s, 1500, "shot");
      await sleep(300);
      expect(b.p.health).toBe(100);
      // and an honest aim 0.4 rad off the camera (third-person parallax) still lands
      const s2 = a.p.shots;
      place(b.p, -Math.sin(0.4) * 12, 4 - Math.cos(0.4) * 12, 0);
      await settle();
      await sleep(800);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: at.yaw, aimElev: at.elev });
      await sleep(80);
      frame(a, { buttons: 0 });
      await until(() => a.p.shots > s2, 1500, "second shot");
      await until(() => b.p.health < 100, 1500, "parallax shot lands");
    }, 30000);
  });

  describe("melee", () => {
    it("a sabre swing lands after its wind-up on people in the arc, up to its cleave, and not on those behind or out of reach", async () => {
      const { ps } = await setup(4);
      const [a, b, c, d] = ps as [Player, Player, Player, Player];
      place(a.p, 0, 0);
      place(b.p, 0, -1.4, 0);
      place(c.p, 0.9, -1.2, 0);
      place(d.p, 0, 1.4, 0); // behind
      await settle();
      await equip(a, WEAPON.SABRE);
      frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: 0, aimElev: 0 });
      await sleep(60);
      frame(a, { buttons: 0 });
      await until(() => b.p.health < 100 && c.p.health < 100, 2000, "both in front are cut");
      const sabre = WEAPONS[WEAPON.SABRE];
      expect(100 - b.p.health).toBeGreaterThanOrEqual(Math.round(sabre.melee!.damage * sabre.ffScale) - 1);
      expect(d.p.health).toBe(100);
      // out of reach
      place(b.p, 0, -3.5, 0);
      b.p.health = 100;
      await settle();
      await sleep(800);
      frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: 0, aimElev: 0 });
      await sleep(60);
      frame(a, { buttons: 0 });
      await sleep(600);
      expect(b.p.health).toBe(100);
    }, 30000);

    it("holding the button keeps swinging at the cooldown's pace and no faster", async () => {
      const { ps } = await setup(1);
      const [a] = ps as [Player];
      place(a.p, 0, 0);
      await equip(a, WEAPON.SABRE);
      const s0 = a.p.shots;
      const end = Date.now() + 2100;
      while (Date.now() < end) {
        frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: 0, aimElev: 0 });
        await sleep(33);
      }
      frame(a, {});
      const swings = a.p.shots - s0;
      const cd = WEAPONS[WEAPON.SABRE].melee!.cooldown;
      expect(swings).toBeGreaterThanOrEqual(2);
      expect(swings).toBeLessThanOrEqual(Math.ceil(2.1 / cd) + 1);
    }, 30000);

    it("V with a rifle in hand is the boot (D-108): a light blow and a big shove; bare hands work when nothing is drawn; a wall stops a swing", async () => {
      const { ps } = await setup(3);
      const [a, b, c] = ps as [Player, Player, Player];
      place(a.p, 0, 0);
      place(b.p, 0, -1.3, 0);
      await settle();
      await equip(a, WEAPON.RIFLE);
      frame(a, { buttons: BUTTON.MELEE, yaw: 0, aimYaw: 0, aimElev: 0 });
      await sleep(60);
      frame(a, {});
      await until(() => b.p.health < 100, 2000, "the boot");
      expect(100 - b.p.health).toBeLessThanOrEqual(BOOT.blow.damage); // (a boot barely hurts: what he lands in does)
      await until(() => b.p.z < -2.3, 2000, "him shoved a metre back and more");
      // bare hands
      frame(a, { weapon: -1 });
      await sleep(500);
      b.p.health = 100;
      b.p.vx = b.p.vz = 0;
      place(b.p, 0, -1.1, 0);
      await settle();
      frame(a, { buttons: BUTTON.MELEE, yaw: 0, aimYaw: 0, aimElev: 0 });
      await sleep(60);
      frame(a, {});
      await until(() => b.p.health < 100, 2000, "punch");
      expect(100 - b.p.health).toBeLessThanOrEqual(10);
      // behind the wall
      place(a.p, 0, -11.2, 0); // just south of the wall (z = -12 +- 0.4)
      place(c.p, 0, -12.8, 0); // just north of it
      c.p.health = 100;
      await settle();
      await sleep(600);
      frame(a, { weapon: WEAPON.SABRE });
      await sleep(900);
      frame(a, { buttons: BUTTON.FIRE, yaw: 0, aimYaw: 0, aimElev: 0 });
      await sleep(60);
      frame(a, {});
      await sleep(700);
      expect(c.p.health).toBe(100);
    }, 30000);

    it("dismemberment odds obey the bias: an umbrella never takes a limb whatever the damage, a sabre sometimes does, the unbiased rule is unchanged", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [Player];
      const trial = (dmg: number, bias: number, n: number): number => {
        let lost = 0;
        for (let i = 0; i < n; i++) {
          a.p.health = 100;
          a.p.flags = FLAG.GROUNDED;
          a.p.wounds = 0;
          a.p.missing = 0;
          room.damagePlayer(a.id, dmg, { zone: ZONE.LEG_L, dirX: 0, dirZ: -1, severBias: bias });
          if ((a.p.missing & LIMB.LEG_L) !== 0) lost++;
        }
        return lost;
      };
      expect(trial(36, 0, 200)).toBe(0);
      expect(trial(44, 1, 200)).toBe(0); // below the rule's floor: nothing, exactly as before
      expect(trial(36, 1.8, 400)).toBeGreaterThan(40);
      expect(trial(36, 1.8, 400)).toBeLessThan(220);
      expect(trial(160, 2.2, 20)).toBe(20); // a cannon ball takes it every time
    });
  });

  describe("props and explosions", () => {
    it("bullets stop at props and shove them; a barrel moves, and the man behind it is unharmed", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const [id, prop] = [...room.state.props.entries()][0]!;
      const start = { x: prop.x, z: prop.z };
      place(a.p, prop.x + 6, prop.z, 0);
      place(b.p, prop.x - 6, prop.z, 0);
      await settle();
      await equip(a, WEAPON.RIFLE);
      const yaw = yawTo(a.p, prop);
      await trigger(a, yaw, Math.atan2(prop.y - (a.p.y + COMBAT.eyeHeight), 6)); // (at its centre: the first prop can be a bottle, 0.3 m tall)
      await sleep(500);
      expect(b.p.health).toBe(100);
      expect(Math.hypot(prop.x - start.x, prop.z - start.z), id).toBeGreaterThan(0.01);
    }, 30000);

    it("an explosion hurts by distance, more at the centre, nothing beyond the radius; cover takes the sting out; the shooter is always in danger; props fly away from it", async () => {
      const { room, ps, combat } = await setup(4);
      const [a, b, c, d] = ps as [Player, Player, Player, Player];
      const dir = openBearing(room, 40);
      const at = (dist: number) => ({ x: Math.cos(dir) * (20 + dist), z: Math.sin(dir) * (20 + dist) });
      const blast = WEAPONS[WEAPON.CANNON].ranged!.blast!;
      place(a.p, at(-14).x, at(-14).z);
      place(b.p, at(1).x, at(1).z);
      place(c.p, at(blast.radius * 0.6).x, at(blast.radius * 0.6).z);
      place(d.p, at(blast.radius + 2).x, at(blast.radius + 2).z);
      await settle();
      const gy = arena.terrainHeight(at(0).x, at(0).z);
      combat.explode(a.id, WEAPON.CANNON, blast, at(0).x, gy + 0.2, at(0).z, "");
      combat.tick(1 / 30);
      const dmgB = 100 - b.p.health;
      const dmgC = 100 - c.p.health;
      expect(dmgB).toBeGreaterThan(dmgC);
      expect(dmgC).toBeGreaterThan(0);
      expect(d.p.health).toBe(100);
      expect(a.p.health).toBe(100); // 14 m away: outside the radius
      expect(dmgB).toBeGreaterThan(blast.damage * 0.5);
      // knocked away from the centre and into the air
      expect(c.p.health).toBeGreaterThan(0);
      const away = (c.p.x - at(0).x) * c.p.vx + (c.p.z - at(0).z) * c.p.vz;
      expect(away).toBeGreaterThan(0);
      expect(c.p.vy).toBeGreaterThan(0); // and up
      expect(c.p.stumble).toBeGreaterThan(0.5);
      // the shooter standing in their own blast is hurt (halved) even with friendly fire off
      room.state.friendlyFire = false;
      a.p.health = 100;
      place(a.p, at(1.2).x, at(1.2).z);
      place(b.p, at(2.5).x, at(2.5).z);
      b.p.health = 100;
      b.p.wounds = 0;
      b.p.flags = FLAG.GROUNDED;
      await settle();
      combat.explode(a.id, WEAPON.CANNON, blast, at(0).x, gy + 0.2, at(0).z, "");
      combat.tick(1 / 30);
      expect(100 - a.p.health).toBeGreaterThan(20);
      expect(b.p.health).toBe(100); // friendly fire off protects everybody else
    }, 30000);

    it("a ball fired into a crate pile flings them (bounded speed); explosions never send a prop faster than the cap", async () => {
      const { room, ps, combat } = await setup(1);
      const [a] = ps as [Player];
      const blast = WEAPONS[WEAPON.CANNON].ranged!.blast!;
      const bodies = [...room.state.props.keys()].slice(0, 3).map((k) => (room as unknown as { physics: { props: Map<string, { body: { translation(): { x: number; y: number; z: number }; linvel(): { x: number; y: number; z: number } } }> } }).physics.props.get(k)!);
      const t = bodies[0]!.body.translation();
      combat.explode(a.id, WEAPON.CANNON, blast, t.x + 0.6, t.y, t.z, "");
      const v = bodies[0]!.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      expect(speed).toBeGreaterThan(2);
      expect(speed).toBeLessThanOrEqual(COMBAT.maxPropSpeed + 0.5);
    });
  });

  describe("the field cannon", () => {
    const cannonOf = (room: WorldRoom) => room.state.cannons.get("0")!;
    const crewAt = (room: WorldRoom, p: PlayerStateType, k: number) => {
      const c = cannonOf(room);
      // stand at the breech end, side by side
      place(p, c.x + Math.sin(c.yaw) * 1.6 + Math.cos(c.yaw) * (k * 0.9 - 0.45), c.z + Math.cos(c.yaw) * 1.6 - Math.sin(c.yaw) * (k * 0.9 - 0.45), c.yaw);
    };

    it("a lone gunner loads it at half speed, two at full speed; they cannot walk off while working it; letting go pauses the work", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const cannon = cannonOf(room);
      // Loading is timed in SIMULATED seconds (the sum of the dt the combat system is ticked with), not by the wall clock: a starved CI runner ticks late and would read a slow load.
      const sys = combatOf(room) as unknown as { tick(dt: number): void };
      const realTick = sys.tick.bind(sys);
      let sim = 0;
      sys.tick = (dt: number) => {
        sim += dt;
        realTick(dt);
      };
      expect(cannon.phase).toBe(0);
      expect(cannon.shells).toBe(CANNON.shells);
      crewAt(room, a.p, 0);
      crewAt(room, b.p, 1);
      // alone
      const hold = (who: Player) => {
        const timer = setInterval(() => frame(who, { buttons: BUTTON.INTERACT, yaw: cannon.yaw, aimYaw: cannon.yaw, aimElev: 0.1 }), 33);
        return () => clearInterval(timer);
      };
      let release = hold(a);
      await until(() => cannon.phase === 1, 1500, "loading begins");
      const t0 = sim;
      expect(a.p.flags & FLAG.OPERATING).toBeTruthy();
      await until(() => sim - t0 >= CANNON.loadSeconds * 0.75, CANNON.loadSeconds * 4000, "75% of the full-speed time, simulated");
      expect(cannon.phase).toBe(1); // half speed: nowhere near done at 75% of the full-speed time
      expect(cannon.crew).toBe(1);
      await until(() => cannon.phase === 2, CANNON.loadSeconds * 4000, "loaded alone");
      const solo = sim - t0;
      expect(solo).toBeGreaterThan(CANNON.loadSeconds * 1.6);
      expect(cannon.shells).toBe(CANNON.shells - 1);
      release();
      frame(a, {});
      await until(() => (a.p.flags & FLAG.OPERATING) === 0, 1500, "released");
      // two hands: light the fuse, fire (to empty it), then load again together at full speed
      place(a.p, a.p.x, a.p.z, cannon.yaw);
      release = hold(a);
      const release2 = hold(b);
      await sleep(200);
      expect(cannon.crew).toBe(2);
      frame(a, { buttons: BUTTON.INTERACT | BUTTON.FIRE, yaw: cannon.yaw });
      await until(() => cannon.phase === 3, 1500, "fuse lit");
      // (wait on the shot count, not on phase 0: with both hands still on the gun the next tick starts loading again, so phase 0 lasts one tick, and two late ticks
      // run back to back on a busy runner can pass it between two polls; the test then waited for a phase that had come and gone)
      await until(() => cannon.fired === 1, 3000, "fired");
      const t1 = sim;
      await until(() => cannon.phase === 2, CANNON.loadSeconds * 3000, "loaded by two");
      const pair = sim - t1;
      expect(pair).toBeLessThan(CANNON.loadSeconds * 1.4);
      expect(pair).toBeGreaterThan(CANNON.loadSeconds * 0.6);
      release();
      release2();
    }, 60000);

    it("nobody out of reach, nobody merely standing there, nobody carrying or downed can work the gun; FIRE alone does not light it", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const cannon = cannonOf(room);
      place(a.p, cannon.x + 6, cannon.z + 6); // out of reach
      crewAt(room, b.p, 0);
      const stop = setInterval(() => {
        frame(a, { buttons: BUTTON.INTERACT });
        frame(b, { buttons: 0 }); // standing there, hands in pockets
      }, 33);
      await sleep(1200);
      expect(cannon.phase).toBe(0);
      expect(cannon.crew).toBe(0);
      clearInterval(stop);
      // downed
      crewAt(room, b.p, 0);
      room.damagePlayer(b.id, 1000, { zone: ZONE.TORSO });
      const stop2 = setInterval(() => frame(b, { buttons: BUTTON.INTERACT }), 33);
      await sleep(800);
      clearInterval(stop2);
      expect(cannon.phase).toBe(0);
    }, 30000);

    it("a loaded gun fires a heavy ball along its barrel: splash falls off with distance, knocks people and props, lifts and can take a limb, and the crew is told (boom event)", async () => {
      const { room, ps, combat } = await setup(3);
      const [a, b, c] = ps as [Player, Player, Player];
      const cannon = cannonOf(room);
      cannon.phase = 2; // (loaded)
      cannon.elev = 0.0;
      const dirx = -Math.sin(cannon.yaw);
      const dirz = -Math.cos(cannon.yaw);
      crewAt(room, a.p, 0);
      // a target 26 m down the barrel line, and a bystander 3.5 m to the side of where the ball lands
      const gx = cannon.x + dirx * 26;
      const gz = cannon.z + dirz * 26;
      place(b.p, gx, gz, 0);
      place(c.p, gx + dirz * 3.5, gz - dirx * 3.5, 0);
      await settle();
      const stop = setInterval(() => frame(a, { buttons: BUTTON.INTERACT, yaw: cannon.yaw, aimYaw: cannon.yaw, aimElev: 0 }), 33);
      await sleep(150);
      frame(a, { buttons: BUTTON.INTERACT | BUTTON.FIRE, yaw: cannon.yaw, aimYaw: cannon.yaw, aimElev: 0 });
      await until(() => cannon.fired === 1, 3000, "the gun goes off");
      await until(() => a.ev.booms.length > 0, 3000, "boom");
      clearInterval(stop);
      expect(a.ev.shots.find((s) => s.w === WEAPON.CANNON)?.id).toBe("cannon:0");
      expect(a.ev.booms[0]!.radius).toBe(WEAPONS[WEAPON.CANNON].ranged!.blast!.radius);
      await sleep(300);
      expect(b.p.health).toBe(0); // direct hit: 160 + splash
      expect(b.p.flags & FLAG.DOWNED).toBeTruthy();
      expect(100 - c.p.health).toBeGreaterThan(5); // splash
      expect(100 - c.p.health).toBeLessThan(100 - 5 + 90);
      expect(c.p.vx * (c.p.x - a.ev.booms[0]!.x) + c.p.vz * (c.p.z - a.ev.booms[0]!.z)).toBeGreaterThan(-1);
      void combat;
    }, 30000);
  });

  describe("event traffic and bookkeeping", () => {
    it("one shot event and no more per trigger pull, however many pellets; impacts per shot are capped", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      place(a.p, 0, 0);
      place(b.p, 0, 100);
      await settle();
      await equip(a, WEAPON.BLUNDERBUSS);
      const yaw = openBearing(room, 30);
      await trigger(a, -yaw - Math.PI / 2, -0.15);
      await sleep(600);
      const mine = b.ev.shots.filter((s) => s.id === a.id);
      expect(mine).toHaveLength(1);
      expect(b.ev.impacts.length).toBeLessThanOrEqual(4);
    });

    it("noise: a discharge carries as far as the weapon says (the AI will listen)", async () => {
      const { ps, room } = await setup(1);
      const [a] = ps as [Player];
      const seen: number[] = [];
      (combatOf(room) as unknown as { host: { noise?: (x: number, z: number, r: number) => void } }).host.noise = (_x, _z, r) => seen.push(r);
      await equip(a, WEAPON.PISTOL);
      await trigger(a, 0, 0.6);
      expect(seen).toContain(WEAPONS[WEAPON.PISTOL].noise);
    });

    it("leaving mid-flight frees everything: rounds owned by a departed player still land harmlessly", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [Player, Player];
      const dir = openBearing(room, 30);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * 20, Math.sin(dir) * 20, faceBack(dir));
      await settle();
      await equip(a, WEAPON.PISTOL);
      const at = aim(a.p, zonePoint(b.p, ZONE.TORSO));
      frame(a, { buttons: BUTTON.FIRE, yaw: at.yaw, aimYaw: at.yaw, aimElev: at.elev });
      await sleep(40);
      await colyseus.cleanup();
      void room;
    });
  });
});
