import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, COMBAT, HOSTAGE, KESSAR_SITES, MoveInput, ROOM_WORLD, WEAPON, elevToWire, weaponToWire, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-041, found by the bot playtest (apps/server/src/bots/playtest): (1) a rifle emptied at the Ward's sentries, every round into the bridge parapet beside them, never made
 * them look up; a round that passes within NEAR_MISS_M of somebody's chest is now as plain a declaration as a hit. (2) The Orchard's deserters shot a walker at the ford,
 * 29 m out, before the contract's own rules had said a word; they now act on the party only once their camp is up, and the lookout hails a walker before it is. Port 2611.
 */
const PORT = 2611;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

describe("being shot at, and the Orchard's patience (D-041)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function founded(scenario: "secure_crossing" | "hostage_rescue") {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "notice", "parley", "saved"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(300);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    return { room, c, me, input };
  }
  const phase = (room: WorldRoom): string => (JSON.parse(room.state.scenario) as { phase: string }).phase;

  async function fireAlong(input: Input, me: PlayerStateType, yaw: number, elev: number): Promise<void> {
    const d = input.data;
    d.weapon = weaponToWire(WEAPON.RIFLE);
    d.yaw = yawToWire(yaw);
    d.aimYaw = yawToWire(yaw);
    d.aimElev = elevToWire(elev);
    for (let i = 0; i < 40; i++) {
      d.buttons = BUTTON.AIM;
      input.send();
      await sleep(40);
    }
    const shots = me.shots;
    for (let i = 0; i < 20 && me.shots === shots; i++) {
      d.buttons = BUTTON.AIM | BUTTON.FIRE;
      input.send();
      await sleep(40);
      d.buttons = BUTTON.AIM;
      input.send();
      await sleep(40);
    }
    expect(me.shots).not.toBe(shots);
  }

  it("a round that passes a sentry by, into the stone beside him, is a declaration: the Ward fights; a round into the empty sky is not", async () => {
    const { room, c, me, input } = await founded("secure_crossing");
    const s0 = room.state.players.get("npc:sentry-1")!;
    // stand 12 m north of the sentry (on the fort road's open ground, short of the run-the-bar zone), a little to one side, and aim a metre to his side at chest height
    c.send("debug", { cmd: `tp:${s0.x + 1.5}:${s0.z - 12}:0` });
    await sleep(500);
    expect(phase(room)).not.toBe("fighting");
    // into the sky first, well away from anyone
    await fireAlong(input, me, Math.PI / 2, 0.9);
    await sleep(300);
    expect(phase(room)).not.toBe("fighting");
    await sleep(COMBAT.switchSeconds * 1000 + 3000); // the rifle reloads between shots
    input.data.buttons = BUTTON.RELOAD;
    input.send();
    await sleep(4000);
    const s = room.state.players.get("npc:sentry-1")!;
    const dx = s.x - 1.0 - me.x, dz = s.z - me.z;
    const yaw = Math.atan2(-dx, -dz);
    await fireAlong(input, me, yaw, Math.atan2(s.y + 1.2 - (me.y + COMBAT.eyeHeight), Math.hypot(dx, dz)));
    const end = Date.now() + 3000;
    while (Date.now() < end && phase(room) !== "fighting") await sleep(50);
    expect(phase(room)).toBe("fighting");
    expect(room.state.players.get("npc:sentry-1")!.health).toBe(100); // nobody was hit: being shot at was enough
  }, 40_000);

  it("the Orchard's deserters do not shoot a walker at the ford: the camp is not up until the contract says so", async () => {
    const { room, c, me } = await founded("hostage_rescue");
    // in plain view of the lookout, 18 m off (the playtest's walker was shot at 29 m), well outside the 12 m the contract gives his eyes
    const L0 = KESSAR_SITES.hostage.lookout;
    c.send("debug", { cmd: `tp:${L0.x}:${L0.z + 18}:0` });
    await sleep(500);
    const h0 = me.health;
    await sleep(6000);
    expect(me.health).toBe(h0);
    expect(phase(room)).not.toBe("fighting");
    // walk-on part: the lookout's eyes (12 m) HAIL the party (D-041: a party walking up to pay must be able to reach the colour-sergeant); stand there past his
    // patience and the camp is up, and THEN it shoots
    const L = KESSAR_SITES.hostage.lookout;
    c.send("debug", { cmd: `tp:${L.x - 6}:${L.z + 6}:0` });
    const hailed = (): boolean => (JSON.parse(room.state.scenario) as { objectives: { id: string }[] }).objectives.some((o) => o.id === "explain");
    let end = Date.now() + 3000;
    while (Date.now() < end && !hailed()) await sleep(50);
    expect(hailed()).toBe(true);
    expect(phase(room)).not.toBe("fighting");
    end = Date.now() + (HOSTAGE.lookoutChallengeS + 5) * 1000;
    while (Date.now() < end && phase(room) !== "fighting") await sleep(50);
    expect(phase(room)).toBe("fighting");
  }, 60_000);
});
