import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BODY_SHAPES,
  BUTTON,
  COMBAT,
  FLAG,
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
  wrapAngle,
  yawToWire,
  type BodyPose,
  type PlayerStateType,
  type WeaponId,
} from "@cb/shared";
import { AIM, aimSolve, crosshairDistance } from "../../../client/src/input/aim.ts";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * Third-person aim against a REAL room (D-038, package I). The client solves the shot from the SERVER's eye through the point the crosshair is on (aim.ts: `crosshairDistance` + `aimSolve`) and
 * sends it as `aimYaw` / `aimElev` beside the camera's own yaw. This proves, with a shoulder camera 0.95 m off the head's line and 3.2 m behind it, that
 *  - the solved shot hits a body under the crosshair at 5, 15 and 30 m (the old way, the camera's own direction, lands a shoulder-width to the side and misses),
 *  - the solved yaw is always inside the server's slack of the camera's yaw (so the server never has to know the solver exists),
 *  - an assist-nudged aim (a pad's soft pull, at most `AIM.assist.maxPull`) is taken as sent, and anything past the slack is clamped by the server, not trusted.
 */

const PORT = 2606; // one port per integration test file
const SEED = 77;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arena = createArena(SEED);

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
interface Player {
  id: string;
  p: PlayerStateType;
  input: Input;
}
interface PC {
  mags: number[];
  reserve: number[];
  aimYaw: number;
  aimElev: number;
  ready: number;
}
const pcOf = (room: WorldRoom, id: string): PC => (room as unknown as { combat: { pcs: Map<string, PC> } }).combat.pcs.get(id)!;

function openBearing(room: WorldRoom, len: number): number {
  const out = newWorldHit();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let ok = !rayWorld(arena, 0, 1.2, 0, dx, 0, dz, len + 6, out) && !rayWorld(arena, 0, 0.4, 0, dx, 0, dz, len + 6, out);
    // the shoulder camera (3.2 m behind, 0.95 m to the side) must see down the line too, or its crosshair ray meets the clutter before the man
    for (const side of [0.95, -0.95]) {
      const cx = -dx * 3.2 - dz * side;
      const cz = -dz * 3.2 + dx * side;
      // the level line, and the crosshair's own ray, which slants down to a chest at any distance out to `len` (a low crate or a table can meet it short of the man)
      for (const [ty, reach] of [[1.85, len], [1.1, 5], [1.1, 15], [1.1, len]] as const) {
        const tx = dx * reach - cx;
        const tz = dz * reach - cz;
        const l = Math.hypot(tx, ty - 1.85, tz);
        ok = ok && !rayWorld(arena, cx, 1.85, cz, tx / l, (ty - 1.85) / l, tz / l, l, out);
      }
    }
    room.state.props.forEach((pr) => {
      const along = pr.x * dx + pr.z * dz;
      const off = Math.abs(-pr.x * dz + pr.z * dx);
      if (along > -1 && along < len + 6 && off < 1.4) ok = false; // (props are physics bodies: the camera ray does not meet them, but a bullet does)
    });
    if (ok) return a;
  }
  throw new Error("no open bearing in this arena");
}

function zonePoint(t: { x: number; y: number; z: number; facing: number }, zone: number): { x: number; y: number; z: number } {
  const [cx, cy, cz] = BODY_SHAPES[zone]!;
  const c = Math.cos(t.facing);
  const s = Math.sin(t.facing);
  return { x: t.x + cx * c + cz * s, y: t.y + cy, z: t.z - cx * s + cz * c };
}

describe("third-person aim solve against a real room", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
    const ps: Player[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
      c.onMessage("hit", () => undefined);
      c.onMessage("shot", () => undefined);
      c.onMessage("impact", () => undefined);
      c.onMessage("boom", () => undefined);
      c.onMessage("hitmark", () => undefined);
      c.onMessage("sever", () => undefined);
      c.onMessage("notice", () => undefined);
      ps.push({ id: c.sessionId, p: room.state.players.get(c.sessionId)!, input });
    }
    await sleep(150);
    return { room, a: ps[0]!, b: ps[1]! };
  }
  const place = (p: PlayerStateType, x: number, z: number, facing = 0) => {
    p.x = x;
    p.z = z;
    p.y = arena.terrainHeight(x, z);
    p.facing = facing;
    p.vx = p.vz = 0;
    p.flags = FLAG.GROUNDED;
  };
  const frame = (who: Player, o: { buttons?: number; yaw: number; aimYaw: number; aimElev: number; weapon?: WeaponId | -1 }) => {
    const d = who.input.data;
    d.moveF = 0;
    d.moveR = 0;
    d.buttons = o.buttons ?? 0;
    d.yaw = yawToWire(o.yaw);
    d.aimYaw = yawToWire(o.aimYaw);
    d.aimElev = elevToWire(o.aimElev);
    if (o.weapon !== undefined) d.weapon = weaponToWire(o.weapon);
    who.input.send();
  };
  const until = async (cond: () => boolean, ms = 4000, what = "condition") => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };
  const rifle = async (room: WorldRoom, a: Player) => {
    frame(a, { yaw: 0, aimYaw: 0, aimElev: 0, weapon: WEAPON.RIFLE });
    await until(() => a.p.weapon === WEAPON.RIFLE + 1, 2000, "rifle in hand");
    await sleep(WEAPONS[WEAPON.RIFLE].drawSeconds * 1000 + 450);
    void room;
  };

  /** The camera as the client builds it: behind the head, a shoulder out, looking parallel to the aim, with the crosshair on `target`. Returns what the client would send. */
  function shoulderShot(a: Player, b: Player, dir: number, zone: number) {
    const head = { x: a.p.x, y: a.p.y + COMBAT.eyeHeight, z: a.p.z };
    const fx = Math.cos(dir);
    const fz = Math.sin(dir);
    const yawF = Math.atan2(-fx, -fz);
    const right = { x: Math.cos(yawF), z: -Math.sin(yawF) };
    const cam = { x: head.x - fx * 3.2 + right.x * AIM.camera.shoulder, y: head.y + 0.3, z: head.z - fz * 3.2 + right.z * AIM.camera.shoulder };
    const t = zonePoint(b.p, zone);
    const l = Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z);
    const camDir = { x: (t.x - cam.x) / l, y: (t.y - cam.y) / l, z: (t.z - cam.z) / l };
    const camYaw = Math.atan2(-camDir.x, -camDir.z);
    const body: BodyPose = { x: b.p.x, y: b.p.y, z: b.p.z, facing: b.p.facing, flags: b.p.flags };
    const hitDist = crosshairDistance(arena, cam, camDir, [body]);
    const sol = aimSolve(head, cam, camDir, hitDist);
    const legacyElev = Math.asin(camDir.y);
    return { camToTarget: l, camYaw, sol: { yaw: sol.yaw, elev: sol.elev, clamped: sol.clamped }, legacy: { yaw: camYaw, elev: legacyElev }, hitDist };
  }

  async function fire(room: WorldRoom, a: Player, b: Player, camYaw: number, aimYaw: number, aimElev: number): Promise<boolean> {
    // a full magazine, ready to fire, a healthy target
    const pc = pcOf(room, a.id);
    pc.mags[WEAPON.RIFLE] = WEAPONS[WEAPON.RIFLE].ranged!.magazine;
    pc.ready = 0;
    b.p.health = 100;
    b.p.wounds = 0;
    b.p.flags = FLAG.GROUNDED;
    const before = a.p.shots;
    frame(a, { buttons: BUTTON.AIM | BUTTON.FIRE, yaw: camYaw, aimYaw, aimElev });
    await sleep(80);
    frame(a, { buttons: BUTTON.AIM, yaw: camYaw, aimYaw, aimElev });
    await until(() => a.p.shots !== before, 2000, "the shot");
    await sleep(250);
    return b.p.health < 100;
  }

  for (const dist of [5, 15, 30]) {
    it(`a body ${dist} m down the crosshair is hit by the solved shot and missed by the camera's own direction; the solve stays inside the slack`, async () => {
      const { room, a, b } = await setup();
      const dir = openBearing(room, 40);
      place(a.p, 0, 0);
      place(b.p, Math.cos(dir) * dist, Math.sin(dir) * dist, Math.atan2(Math.cos(dir), Math.sin(dir)));
      await sleep(350); // the rewind history catches up with the teleport
      await rifle(room, a);
      const s = shoulderShot(a, b, dir, ZONE.TORSO);
      expect(s.hitDist).toBeLessThan(s.camToTarget + 0.5); // the body (not the sky or the far ground) decided the convergence
      expect(s.hitDist).toBeGreaterThan(s.camToTarget - 1.2);
      expect(Math.abs(wrapAngle(s.sol.yaw - s.camYaw))).toBeLessThanOrEqual(COMBAT.aimYawSlack);
      expect(s.sol.clamped).toBe(false);
      expect(await fire(room, a, b, s.camYaw, s.sol.yaw, s.sol.elev), `solved shot at ${dist} m`).toBe(true);
      // the same crosshair the old way (the shot parallel to the camera, a shoulder-width off) lands beside the man
      expect(await fire(room, a, b, s.camYaw, s.legacy.yaw, s.legacy.elev), `legacy shot at ${dist} m`).toBe(false);
    }, 30000);
  }

  it("an assist-nudged aim (a pad's pull, at most AIM.assist.maxPull) is taken as sent; a wild aim is clamped to the slack by the server", async () => {
    const { room, a, b } = await setup();
    const dir = openBearing(room, 40);
    place(a.p, 0, 0);
    place(b.p, Math.cos(dir) * 15, Math.sin(dir) * 15, Math.atan2(Math.cos(dir), Math.sin(dir)));
    await sleep(350);
    await rifle(room, a);
    const s = shoulderShot(a, b, dir, ZONE.TORSO);
    expect(AIM.assist.maxPull).toBeLessThan(COMBAT.aimYawSlack / 4); // a fifth of the slack: well inside
    // a steady hand's aim with the assist's full pull added (toward the target, as the assist pulls): still a hit, and the server holds exactly what was sent (to wire precision)
    const toward = Math.sign(wrapAngle(s.sol.yaw - s.camYaw)) || 1;
    const nudged = s.sol.yaw + 0.02 * toward; // assist pulls TOWARD the chest; a hair past it here still lands inside the body
    const hit = await fire(room, a, b, s.camYaw, nudged, s.sol.elev);
    expect(hit).toBe(true);
    const held = pcOf(room, a.id).aimYaw;
    expect(Math.abs(wrapAngle(held - nudged))).toBeLessThan(0.001);
    // the wire is not trusted: 0.9 rad off the camera is held at the slack
    await fire(room, a, b, s.camYaw, s.camYaw + 0.9, s.sol.elev);
    expect(Math.abs(wrapAngle(pcOf(room, a.id).aimYaw - s.camYaw))).toBeLessThanOrEqual(COMBAT.aimYawSlack + 0.001);
  }, 30000);
});
