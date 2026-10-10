import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { FireGrid, MOUNT_PHASE, ROOM_WORLD, createRegionWorld, decodeBurning, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Mounts } from "../systems/Mounts.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-103: fire through a real room. The grass catches, the state carries it, a player standing in it is set alight and hurt, and sailing home leaves it behind.
 * D-110: a horse grazing beside the grass when it catches bolts from it. Port 2647.
 */
const PORT = 2647;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A spot in Highmark's savannah with fuel round it, and the spot four metres "behind" it that the debug command lights in front of a player facing 0. */
function savannah(): { x: number; z: number } {
  const world = createRegionWorld("highmark", 9);
  const g = new FireGrid(world, "highmark", 9);
  for (let c = g.w * 10; c < g.cells - g.w * 10; c += 17) {
    const x = g.centreX(c);
    const z = g.centreZ(c);
    let ok = Math.hypot(x, z) < 110;
    for (let dz = -6; dz <= 2 && ok; dz += 2) for (let dx = -2; dx <= 2 && ok; dx += 2) if (g.fuelOf(g.cellAt(x + dx, z + dz)) < 0.3) ok = false;
    if (ok) return { x, z };
  }
  throw new Error("no savannah");
}

describe("fire in a real room (D-103)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  };

  it("the grass catches, the state carries the fire, and a player standing in it burns", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "highmark" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved", "cry", "bark", "gazette"]) c.onMessage(t, () => undefined);
    await sleep(300);
    const at = savannah();
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    // stand at the spot facing 0 (-Z): the debug fire lights the grass 4 m ahead, at z - 4
    c.send("debug", { cmd: `tp:${at.x}:${at.z}:0` });
    await sleep(200);
    let lit = "";
    c.onMessage("notice", (m: { text: string }) => void (lit = m.text));
    c.send("debug", { cmd: "fire" });
    await until(() => room.state.fire.length > 0, 3000, "the fire on the state");
    await until(() => lit !== "", 2000, "the notice of where");
    const [fx, fz] = /at (-?\d+), (-?\d+)/.exec(lit)!.slice(1).map(Number) as [number, number];
    let cells = 0;
    decodeBurning(room.state.fire, 1e6, () => cells++);
    expect(cells).toBeGreaterThan(0);
    // walk into it: stand where it was lit
    c.send("debug", { cmd: `tp:${fx}:${fz}:0` });
    await until(() => me.burn > 0, 4000, "Ada alight");
    const hp = me.health;
    await until(() => me.health < hp, 3000, "the fire hurting her");
    // the scorch follows as cells burn out
    await until(() => room.state.scorch.length > 0, 15000, "scorched ground on the state");
  }, 30_000);

  it("a horse grazing beside the grass when it catches bolts away from the flames (D-110)", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "highmark" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved", "cry", "bark", "gazette", "notice"]) c.onMessage(t, () => undefined);
    await sleep(300);
    const at = savannah();
    const mounts = (room as unknown as { mounts: Mounts }).mounts;
    const id = mounts.spawnHorse({ x: at.x + 2, z: at.z - 4, yaw: 0 }, { coat: 1 });
    const horse = room.state.mounts.get(id)!;
    c.send("debug", { cmd: `tp:${at.x}:${at.z}:0` });
    await sleep(200);
    expect(horse.phase).toBe(MOUNT_PHASE.loose);
    c.send("debug", { cmd: "fire" });
    await until(() => horse.phase === MOUNT_PHASE.bolting, 4000, "the horse bolting");
    expect(mounts.stats.firePanics).toBeGreaterThan(0);
    const d0 = Math.hypot(horse.x - at.x, horse.z - (at.z - 4));
    await until(() => Math.hypot(horse.x - at.x, horse.z - (at.z - 4)) > d0 + 8, 6000, "the horse well away from the fire");
  }, 30_000);
});
