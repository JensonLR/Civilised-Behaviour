import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { HISTORY_KEYS, decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2574; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("character look (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const join = async (look?: unknown) => {
    const room = (await colyseus.createRoom(ROOM_WORLD, {})) as unknown as WorldRoom;
    const client = await colyseus.connectTo(room as never, { name: "Sitter", look });
    await sleep(120);
    return { room, client, player: room.state.players.get(client.sessionId)! };
  };

  it("stores a submitted look in canonical form", async () => {
    const spec = generateCharacter(123);
    const { player } = await join(encodeSpec(spec));
    expect(decodeSpec(player.look)).toEqual(spec);
  });

  it("gives players with no look, or garbage, a valid deterministic character", async () => {
    for (const bad of [undefined, "", "nonsense!!", 42, { hat: 3 }, "A".repeat(2000)]) {
      const { player } = await join(bad);
      expect(decodeSpec(player.look)).toBeDefined();
    }
  });

  it("strips campaign history from a fresh join (cannot spawn as a veteran)", async () => {
    const cheat = { ...generateCharacter(5), scars: 31, teeth: 15, eyepatch: 2, burnt: 3, woodenLeg: 2 };
    const { player } = await join(encodeSpec(cheat));
    const stored = decodeSpec(player.look)!;
    for (const k of HISTORY_KEYS) expect(stored[k]).toBe(0);
    expect(stored.height).toBe(cheat.height);
  });

  it("setLook changes appearance but never history; server-owned history survives", async () => {
    const { room, client, player } = await join(encodeSpec(generateCharacter(1)));
    // The campaign (server) marks the character.
    const marked = { ...decodeSpec(player.look)!, scars: 5, eyepatch: 1 };
    player.look = encodeSpec(marked);

    const next = { ...generateCharacter(2), scars: 0, eyepatch: 0, woodenLeg: 2 }; // tries to erase scars, grab a wooden leg
    client.send("setLook", { look: encodeSpec(next) });
    await sleep(150);
    const stored = decodeSpec(player.look)!;
    expect(stored.height).toBe(next.height);
    expect(stored.hat).toBe(next.hat);
    expect(stored.scars).toBe(5);
    expect(stored.eyepatch).toBe(1);
    expect(stored.woodenLeg).toBe(0);
    void room;
  });

  it("rate limits setLook and ignores malformed payloads", async () => {
    const { client, player } = await join(encodeSpec(generateCharacter(1)));
    client.send("setLook", { look: encodeSpec(generateCharacter(2)) });
    await sleep(100);
    const afterFirst = player.look;
    client.send("setLook", { look: encodeSpec(generateCharacter(3)) }); // inside the rate-limit window
    await sleep(100);
    expect(player.look).toBe(afterFirst);

    await sleep(1600);
    client.send("setLook", { look: "garbage" });
    client.send("setLook", { look: 12345 });
    client.send("setLook", null);
    await sleep(150);
    expect(player.look).toBe(afterFirst); // malformed input changes nothing
    client.send("setLook", { look: encodeSpec(generateCharacter(4)) });
    await sleep(150);
    expect(player.look).not.toBe(afterFirst); // and did not consume the rate-limit slot
  });
});
