import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { applyPeople, decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { NPC, PEOPLE_OF_REGION, ROOM_WORLD, type NpcSpec } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-038: the people we colonise are not the Society in another coat. A native NPC's look is the region's fictional people laid over its seeded character (`spec.people ?? peopleForNpc(role, region)`),
 * the colonial roles (the Syndicate's guards, deserters, the Society's hired hands) stay the caricature, and `look` stays a string on the wire: no schema change. Port 2640 (one per file).
 */
const PORT = 2640;

type Looker = { npcLook(spec: NpcSpec): string };
const spec = (role: number, seed: number, extra: Partial<NpcSpec> = {}): NpcSpec => ({
  id: `t${role}-${seed}`, role, faction: "ward" as never, side: "neutral", group: "g", post: { x: 0, z: 0 }, weapon: 0 as never, lookSeed: seed, name: "T", skill: 0.5, bravery: 0.5, brain: "civil", ...extra,
});

describe("NPC looks name their people (D-038)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const room = async (region: string): Promise<{ r: WorldRoom; look: Looker }> => {
    const r = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, region })) as unknown as WorldRoom;
    return { r, look: r as unknown as Looker };
  };

  it("a Kessar sentry is a Kessarine, drawn exactly as the people overlay says (the client and the server agree)", async () => {
    const { look } = await room("kessar");
    for (const seed of [1, 7, 99, 4242]) {
      expect(look.npcLook(spec(NPC.SENTRY, seed))).toBe(encodeSpec(applyPeople(generateCharacter(seed), "kessarine", seed)));
    }
  }, 20_000);

  it("the Syndicate's guards, deserters and the Society's hired hands stay the colonial caricature", async () => {
    const { look } = await room("kessar");
    for (const role of [NPC.RIVAL_GUARD, NPC.DESERTER, NPC.HIRED_RIFLE, NPC.SURGEON, NPC.FOREMAN]) {
      expect(look.npcLook(spec(role, 31))).toBe(encodeSpec(generateCharacter(31)));
    }
  }, 20_000);

  it("local labour is the region's own people, in every region", async () => {
    for (const region of ["kessar", "highmark", "vesper", "saltmarket"] as const) {
      const { look } = await room(region);
      const people = PEOPLE_OF_REGION[region];
      expect(look.npcLook(spec(NPC.PORTER, 12))).toBe(encodeSpec(applyPeople(generateCharacter(12), people, 12)));
    }
  }, 40_000);

  it("a spec may name its people, which wins over the role's", async () => {
    const { look } = await room("kessar");
    expect(look.npcLook(spec(NPC.DESERTER, 5, { people: "brinefolk" }))).toBe(encodeSpec(applyPeople(generateCharacter(5), "brinefolk", 5)));
  }, 20_000);

  it("the authored patch is still laid over the people, and the result always decodes", async () => {
    const { look } = await room("kessar");
    const l = look.npcLook(spec(NPC.SENTRY, 9, { look: { moustache: 2 } }));
    const d = decodeSpec(l);
    expect(d).toBeDefined();
    expect(d!.moustache).toBe(2);
  }, 20_000);
});
