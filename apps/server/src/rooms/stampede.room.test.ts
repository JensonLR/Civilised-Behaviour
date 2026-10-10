import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, MoveInput, ROOM_WORLD, WEAPON, decodeHerdRuns, herdAnimalAt, herdPlan, weaponToWire, yawToWire, type HitEvent, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-114 through a real room at Highmark: Ada fires her pistol beside the west herd; the herd runs from the report (the run is on the state, for every client to draw), and
 * Bram, standing beyond the herd, is trampled. Port 2655.
 */
const PORT = 2655;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

describe("the stampede in a real room (D-114)", () => {
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
      await sleep(30);
    }
  };

  it("a shot beside a herd sets it running, on the state; a man beyond it is trampled", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "highmark" })) as unknown as WorldRoom;
    const ada = await colyseus.connectTo(room as never, { name: "Ada" });
    const bram = await colyseus.connectTo(room as never, { name: "Bram" });
    const hits: HitEvent[] = [];
    for (const c of [ada, bram]) {
      for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "bark", "gazette", "shot", "lasso", "hitmark", "yield"]) c.onMessage(t, () => undefined);
    }
    ada.onMessage("hit", (e: HitEvent) => void hits.push(e));
    bram.onMessage("hit", () => undefined);
    await sleep(400);
    // the west herd (herd 2 of the plan: -100, 62), where it grazes now
    const plan = herdPlan(room.state.seed);
    const bornAt = (room as unknown as { bornAt: number }).bornAt;
    const k = 2;
    let first = 0;
    for (let q = 0; q < k; q++) first += plan.herds[q]!.n;
    const a = { x: 0, z: 0, yaw: 0, speed: 0 };
    let cx = 0, cz = 0;
    for (let i = first; i < first + plan.herds[k]!.n; i++) {
      herdAnimalAt(plan, i, (performance.now() - bornAt) / 1000, [], a);
      cx += a.x;
      cz += a.z;
    }
    cx /= plan.herds[k]!.n;
    cz /= plan.herds[k]!.n;
    // Ada 22 m north of it, Bram 14 m south of it (the way it will run)
    ada.send("debug", { cmd: `tp:${cx}:${cz - 22}:0` });
    bram.send("debug", { cmd: `tp:${cx}:${cz + 14}:0` });
    const bramRow = room.state.players.get(bram.sessionId)! as PlayerStateType;
    const me = room.state.players.get(ada.sessionId)! as PlayerStateType;
    const input = ada.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.yaw = d.aimYaw = yawToWire(0); // (facing north: she fires away from the herd)
    for (let i = 0; i < 25; i++) {
      input.send();
      await sleep(40);
    }
    await until(() => me.weapon === weaponToWire(WEAPON.PISTOL), 3000, "the pistol drawn");
    expect(room.state.herds ?? "").toBe("");
    const health0 = bramRow.health;
    d.buttons = BUTTON.FIRE;
    input.send();
    await until(() => (room.state.herds ?? "") !== "", 3000, "the herd running");
    d.buttons = 0;
    input.send();
    const run = decodeHerdRuns(room.state.herds, plan.herds.length)[k]!;
    expect(run).toBeDefined();
    expect(run.fz).toBeGreaterThan(0.8); // (south, away from her)
    await until(() => hits.some((h) => h.id === bram.sessionId && h.trample === true), 8000, "Bram trampled");
    expect(bramRow.health).toBeLessThan(health0);
  }, 40_000);
});
