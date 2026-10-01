import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { CAMP, HIGHMARK_RESOLUTIONS, NPC_CAP, REGIONS, ROOM_WORLD, TICK_RATE, parseCampaign, reachableRegions, regionLanding, regionSpawn } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-036 integration through a REAL room (the integrator's; the contract file holds the dev-start and gating cases): the chart lists five shores (D-037), a party sails Hollowmere -> Highmark from
 * the map table and is given the Vacant Chair, every Highmark ending is committed by the same pipeline a real one takes and says where it happened, and a saved campaign with a Highmark ending
 * comes back byte for byte from the file store. Port 2600 (2601: the demo's file).
 */
const PORT = 2600;
const TOKEN = "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
type Priv = { world: { terrainHeight(x: number, z: number): number } };

describe("Highmark, region two, through a real room", () => {
  let colyseus: ColyseusTestServer;
  let dir: string;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    dir = mkdtempSync(join(tmpdir(), "cb-ship-"));
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1", CAMPAIGN_STORE: "file", SAVE_DIR: dir, IDENTITY_PEPPER: "integration-pepper-0123456789" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(async () => colyseus.cleanup());

  it("the chart lists five reachable regions, and a party at the map table sails to Highmark: one landfall, the succession offered, the cast inside the cap", async () => {
    expect(reachableRegions()).toEqual(["hollowmere", "kessar", "highmark", "vesper", "saltmarket"]);
    expect(REGIONS.highmark.reachable).toBe(true);
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Skipper" });
    await sleep(150);
    const p = room.state.players.get(c.sessionId)!;
    const w = (room as unknown as Priv).world;
    p.x = CAMP.mapTable.x;
    p.z = CAMP.mapTable.z + 1.2;
    p.y = w.terrainHeight(p.x, p.z);
    c.send("travelPropose" as never, { to: "highmark" } as never);
    await until(() => room.state.travelPhase >= 2 || room.state.region === "highmark", 4000, "the sailing to Highmark to begin");
    await until(() => room.state.region === "highmark" && room.state.travelPhase === 3, 6000 + 1000 * TICK_RATE, "landfall at Highmark");
    c.send("regionReady" as never, { region: "highmark" } as never);
    await until(() => room.state.travelPhase === 0, 5000, "everyone ashore");
    const spawn = regionSpawn("highmark", p.slot, 4);
    expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(0.5);
    const view = JSON.parse(room.state.scenario) as { template: string; title: string };
    expect(view).toMatchObject({ template: "succession_dispute", title: "The Vacant Chair" });
    let npcs = 0;
    room.state.players.forEach((q) => {
      if (q.npc) npcs++;
    });
    expect(npcs).toBeGreaterThan(0);
    expect(npcs).toBeLessThanOrEqual(NPC_CAP);
    expect(room.state.cannons.size).toBe(0); // Hollowmere's field gun does not sail
    // and home again: every ordered pair of reachable regions sails in a room
    p.x = 0; // (the dock: any region's landing station takes the proposal; the landing is where the party stands)
    c.send("travelPropose" as never, { to: "hollowmere" } as never);
    await until(() => room.state.region === "hollowmere", 8000 + 1000 * TICK_RATE, "the sailing home");
  }, 60_000);

  it("D-037: one party sails the whole chart Hollowmere -> Vesper -> Saltmarket -> Highmark -> Kessar -> home; each landfall is within 0.5 m of the spawn, offers its own contract and keeps the cast inside the cap", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9 })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Skipper" });
    await sleep(150);
    const p = room.state.players.get(c.sessionId)!;
    const w = (room as unknown as Priv).world;
    p.x = CAMP.mapTable.x;
    p.z = CAMP.mapTable.z + 1.2;
    p.y = w.terrainHeight(p.x, p.z);
    const offers: Record<string, readonly string[]> = { vesper: ["mine_rescue", "claim_race"], saltmarket: ["smuggling_run", "flooded_market"], highmark: ["succession_dispute"], kessar: ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"] };
    for (const to of ["vesper", "saltmarket", "highmark", "kessar"] as const) {
      c.send("travelPropose" as never, { to } as never);
      await until(() => room.state.region === to && room.state.travelPhase === 3, 8000 + 1000 * TICK_RATE, `landfall at ${to}`);
      c.send("regionReady" as never, { region: to } as never);
      await until(() => room.state.travelPhase === 0, 5000, `everyone ashore at ${to}`);
      const spawn = regionSpawn(to, p.slot, 4);
      expect(Math.hypot(p.x - spawn.x, p.z - spawn.z), to).toBeLessThan(0.5);
      expect(offers[to], to).toContain((JSON.parse(room.state.scenario) as { template: string }).template);
      let npcs = 0;
      room.state.players.forEach((q) => {
        if (q.npc) npcs++;
      });
      expect(npcs, to).toBeLessThanOrEqual(NPC_CAP);
      p.x = regionLanding(to).x; // the dock is the landing: stand on it for the next proposal
      p.z = regionLanding(to).z;
    }
    c.send("travelPropose" as never, { to: "hollowmere" } as never);
    await until(() => room.state.region === "hollowmere", 8000 + 1000 * TICK_RATE, "the sailing home");
  }, 120_000);

  it("each of the five Highmark endings commits once through the real pipeline: the ledger's chair, the history's region, distinct campaign JSON; a forged resolution is ignored", async () => {
    const seen = new Map<string, string>();
    for (const r of HIGHMARK_RESOLUTIONS) {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "highmark" })) as unknown as WorldRoom;
      const c = await colyseus.connectTo(room as never, { name: "Registrar" });
      await sleep(100);
      c.send("debug" as never, { cmd: "outcome:not_a_resolution" } as never);
      await sleep(80);
      expect(room.state.campaignRev).toBe(0);
      c.send("debug" as never, { cmd: `outcome:${r}` } as never);
      await until(() => room.state.campaignRev > 0, 3000, `the ${r} ending`);
      const camp = parseCampaign(room.state.campaign)!;
      expect(camp.history).toHaveLength(1);
      expect(camp.history[0]).toMatchObject({ resolution: r, region: "highmark" });
      expect(camp.sites.succession).not.toBe("open");
      expect(camp.crossing.bridge).toBe("intact"); // the crossing at Kessar is left alone
      seen.set(r, room.state.campaign + room.state.powers);
      await colyseus.cleanup();
    }
    expect(new Set(seen.values()).size).toBe(seen.size);
  }, 60_000);

  it("a Highmark ending is saved and comes back byte for byte from the file store, and the save stays small", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 11, region: "highmark", token: TOKEN })) as unknown as WorldRoom;
    const code = room.state.code;
    const c = await colyseus.connectTo(room as never, { name: "Registrar", token: TOKEN });
    await sleep(100);
    c.send("debug" as never, { cmd: "outcome:regency" } as never);
    await until(() => room.state.campaignRev > 0, 3000, "the regency");
    const saved = { campaign: room.state.campaign, powers: room.state.powers, settlements: room.state.settlements };
    await sleep(300); // (the ledger is on disk within a tick of the commit)
    await c.leave(true);
    await until(() => (room as unknown as { clients: { length: number } }).clients.length === 0, 3000, "the room to empty");
    await sleep(600);
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json") && !f.includes("corrupt"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(join(dir, f)).length).toBeLessThan(8 * 1024);
    const back = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })) as unknown as WorldRoom;
    expect(back.state.code).toBe(code);
    expect({ campaign: back.state.campaign, powers: back.state.powers, settlements: back.state.settlements }).toEqual(saved);
    expect(parseCampaign(back.state.campaign)!.sites.succession).toBe("regency");
    expect(back.state.region).toBe("hollowmere"); // a resumed campaign starts at HQ
  }, 60_000);
});
