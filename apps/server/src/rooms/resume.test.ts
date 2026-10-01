import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BUTTON, FOUNDATION_CRATES, KESSAR_OUTPOST, MoveInput, NPC, PropKind, ROOM_WORLD, ZONE, parseCampaign, parsePowers, parseSettlements, yawToWire,
  type PlayerStateType,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { metrics } from "../metrics.ts";
import { createPgStore } from "../persistence/pgStore.ts";
import { createPersistence, type PersistenceRuntime } from "../persistence/runtime.ts";
import { DAY_MS, type CampaignStore } from "../persistence/types.ts";
import { getRoomConfig, setRoomConfig } from "../roomConfig.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-035 integration: a campaign survives a restart (the room goes, the store keeps the ledger, a new room by the join code brings it back), through the REAL room, on the file store
 * and on PGlite + Drizzle. Positions, props and NPCs are not saved: a resumed campaign starts at HQ.
 */
const SEED = 4242;
const TOKEN = "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean | Promise<boolean>, ms = 5000, what = "condition") => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

interface Variant { name: string; port: number; setup(): Promise<{ runtime?: PersistenceRuntime; env: Record<string, string>; clock?: { now: number }; done(): Promise<void> }> }

const fileVariant: Variant = {
  name: "file store", port: 2593,
  async setup() {
    const dir = mkdtempSync(join(tmpdir(), "cb-resume-"));
    return { env: { CAMPAIGN_STORE: "file", SAVE_DIR: dir }, done: async () => rmSync(dir, { recursive: true, force: true }) };
  },
};
const pgVariant: Variant = {
  name: "PGlite + Drizzle", port: 2594,
  async setup() {
    const clock = { now: 0 };
    const pg = new PGlite();
    const store = createPgStore(drizzle(pg), { now: () => Date.now() + clock.now });
    await store.migrate();
    const runtime: PersistenceRuntime = { cfg: { kind: "postgres", saveDir: "", databaseUrl: undefined, pepper: "integration-pepper-0123456789", retentionDays: 180 }, store: async () => store as CampaignStore, status: () => ({ kind: "postgres", downgraded: false }), close: async () => undefined };
    return { runtime, env: {}, clock, done: async () => { await pg.close().catch(() => undefined); } };
  },
};

for (const variant of [fileVariant, pgVariant]) {
  describe(`resume: a campaign survives the room (${variant.name})`, () => {
    let colyseus: ColyseusTestServer;
    let teardown: () => Promise<void>;
    let clock: { now: number } | undefined;
    beforeAll(async () => {
      configureLogger("error", { silent: true });
      const s = await variant.setup();
      teardown = s.done;
      clock = s.clock;
      const server = createGameServer(loadConfig({ NODE_ENV: "test", IDENTITY_PEPPER: "integration-pepper-0123456789", ...s.env } as never));
      if (s.runtime) setRoomConfig({ ...getRoomConfig(), persistence: s.runtime });
      await server.listen(variant.port);
      colyseus = new ColyseusTestServer(server);
    }, 60000);
    afterAll(async () => {
      await colyseus.shutdown();
      await teardown();
    });

    async function join(room: WorldRoom, token = TOKEN) {
      const c = await colyseus.connectTo(room as never, { name: "Q", token });
      for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley"]) c.onMessage(t, () => undefined);
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
      const me = room.state.players.get(c.sessionId)!;
      return { c, input, me };
    }
    const place = (room: WorldRoom, p: PlayerStateType, x: number, z: number, facing = 0) => {
      const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
      p.x = x;
      p.z = z;
      p.y = w.terrainHeight(x, z);
      p.facing = facing;
      p.vx = p.vz = 0;
    };
    const press = async (input: Input, buttons: number) => {
      const d = input.data;
      d.moveF = 0;
      d.moveR = 0;
      d.yaw = yawToWire(0);
      d.buttons = buttons;
      input.send();
      await sleep(120);
      d.buttons = 0;
      input.send();
      await sleep(120);
    };
    const json = (room: WorldRoom) => ({ campaign: room.state.campaign, party: room.state.party, powers: room.state.powers, settlements: room.state.settlements });

    it("create, force a crossing, found an outpost by hand, empty the room; a new room by the code brings it all back; strangers and unknown codes get the same error; a live campaign cannot be resumed twice", async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, region: "kessar", token: TOKEN })) as unknown as WorldRoom;
      const code = room.state.code;
      const { c, input, me } = await join(room);
      const powers0 = room.state.powers;

      // an ending: the garrison is put down by the party (the same entry point Combat uses), the ledger and the powers move
      const sentries = [...room.state.players.entries()].filter(([, p]) => p.npc === NPC.SENTRY);
      room.damagePlayer(sentries[0]![0], 10, { zone: ZONE.ARM_R, by: c.sessionId });
      await sleep(100);
      for (const [id] of sentries) room.damagePlayer(id, 1000, { zone: ZONE.TORSO, by: c.sessionId });
      await until(() => room.state.campaignRev > 0, 6000, "the outcome");
      expect(parseCampaign(room.state.campaign)!.history[0]!.resolution).toBe("forced");
      expect(room.state.powers).not.toBe(powers0);

      // the outpost: four crates carried from the landing to the foundation
      const site = KESSAR_OUTPOST.site;
      const crates = [...room.state.props.entries()].filter(([, p]) => p.kind === PropKind.CRATE).slice(0, FOUNDATION_CRATES + 1);
      expect(crates.length).toBeGreaterThanOrEqual(FOUNDATION_CRATES);
      let delivered = 0;
      for (const [id, prop] of crates) {
        if (delivered === FOUNDATION_CRATES) break;
        place(room, me, prop.x, prop.z + 1.2, 0);
        me.y = prop.y - 0.3;
        await press(input, BUTTON.INTERACT);
        await until(() => room.state.props.get(id)?.holder === c.sessionId, 2000, "to pick a crate up");
        place(room, me, site.x + 1, site.z, 0);
        await sleep(150);
        await press(input, BUTTON.INTERACT);
        await until(() => !room.state.props.has(id), 2000, "the crate to be consumed");
        delivered++;
      }
      expect(delivered).toBe(FOUNDATION_CRATES);
      const s = parseSettlements(room.state.settlements)!;
      expect(s.posts.kessar!.stage).toBe("camp");
      expect(room.state.settlementsRev).toBeGreaterThan(0);

      const saved = json(room);
      await c.leave();
      await until(() => room.state.players.size === 0 || true, 500);
      await room.disconnect();
      const rt = getRoomConfig().persistence!;
      const store = await rt.store();
      await until(async () => !!(await store.findByCode(code)), 5000, "the record");
      const rec = (await store.findByCode(code))!;
      expect(rec.sections.campaign).toBe(saved.campaign);
      expect(rec.sections.powers).toBe(saved.powers);
      expect(rec.sections.settlements).toBe(saved.settlements);
      expect(rec.members.length).toBe(1);
      expect(JSON.stringify(rec)).not.toContain(TOKEN); // the raw identity is never stored

      // the same error for a stranger, an unknown code, a bad token, a missing token, a wrong type and an oversized code: tried while the campaign is DORMANT, so nothing but the
      // membership check stands between the stranger and the ledger
      const refuse = async (opts: unknown): Promise<string> => {
        try {
          await colyseus.createRoom(ROOM_WORLD, opts as never);
          return "no error";
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      };
      const errs = [
        await refuse({ resume: code, token: OTHER }), await refuse({ resume: "ZZZZ9", token: TOKEN }), await refuse({ resume: code, token: "nope" }), await refuse({ resume: code }),
        await refuse({ resume: 7, token: TOKEN }), await refuse({ resume: "A".repeat(10_000), token: TOKEN }), await refuse({ resume: {}, token: TOKEN }), await refuse({ resume: [code], token: TOKEN }),
      ];
      expect(new Set(errs).size).toBe(1);
      expect(errs[0]).toContain("No expedition");

      // the resume: byte-identical sections, the same seed and code, back at HQ
      const back = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })) as unknown as WorldRoom;
      expect(json(back)).toEqual(saved);
      expect(back.state.seed).toBe(SEED);
      expect(back.state.code).toBe(code);
      expect(back.state.region).toBe("hollowmere");
      expect(parseSettlements(back.state.settlements)!.posts.kessar!.stage).toBe("camp");
      expect(parsePowers(back.state.powers)).toBeTruthy();
      // a campaign that is already live cannot be resumed a second time (and says the same thing)
      expect(await refuse({ resume: code, token: TOKEN })).toBe(errs[0]);
      // the whole record is small
      expect(Buffer.byteLength(JSON.stringify(rec), "utf8")).toBeLessThan(8 * 1024);
      expect(metrics.rooms).toBeGreaterThanOrEqual(0);
    }, 90000);

    it("a second client with a valid identity joins a saved campaign as a member and may resume it later; a joiner without an identity is not a member", async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED + 1, token: TOKEN })) as unknown as WorldRoom;
      const code = room.state.code;
      const a = await join(room);
      const b = await join(room, OTHER);
      const g = await colyseus.connectTo(room as never, { name: "G" });
      await sleep(200);
      await a.c.leave();
      await b.c.leave();
      await g.leave();
      await room.disconnect();
      const store = await getRoomConfig().persistence!.store();
      await until(async () => ((await store.findByCode(code))?.members.length ?? 0) === 2, 5000, `both members (${JSON.stringify((await store.findByCode(code))?.members)})`);
      const again = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: OTHER })) as unknown as WorldRoom;
      expect(again.state.seed).toBe(SEED + 1);
    }, 60000);

    it("a resume racing another resume or the dying room's last save: exactly one room per campaign, and it starts from the LAST save", async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED + 4, token: TOKEN })) as unknown as WorldRoom;
      const code = room.state.code;
      const a = await join(room);
      (room as unknown as { commitOutcome(o: unknown): void }).commitOutcome({
        scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 10, bridge: "intact", brokePromise: false, seconds: 1,
        tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
      });
      const saved = json(room);
      await a.c.leave();
      void room.disconnect(); // not awaited: the resumes below arrive while the room is still writing its last save
      const tries = await Promise.allSettled([colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN }), colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })]);
      const won = tries.filter((t) => t.status === "fulfilled") as PromiseFulfilledResult<unknown>[];
      expect(won.length).toBe(1);
      expect(json(won[0]!.value as WorldRoom)).toEqual(saved);
    }, 60000);

    it("a section written by a NEWER build is played on fresh values but never saved over (a downgrade must not destroy the newer data)", async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED + 3, token: TOKEN })) as unknown as WorldRoom;
      const code = room.state.code;
      const a = await join(room);
      await a.c.leave();
      await room.disconnect();
      const store = await getRoomConfig().persistence!.store();
      await until(async () => !!(await store.findByCode(code)), 5000, "the record");
      const r0 = (await store.findByCode(code))!;
      const future = '{"v":2,"fromTheFuture":true}';
      expect((await store.save({ ...r0, sections: { ...r0.sections, powers: future }, sectionVersions: { ...r0.sectionVersions, powers: 99 } }, r0.rev)).ok).toBe(true);
      const back = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })) as unknown as WorldRoom;
      expect(parsePowers(back.state.powers)).toBeTruthy(); // played on fresh values
      await join(back);
      (back as unknown as { commitOutcome(o: unknown): void }).commitOutcome({
        scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 10, bridge: "intact", brokePromise: false, seconds: 1,
        tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
      });
      const day = parseCampaign(back.state.campaign)!.day;
      await until(async () => parseCampaign((await store.findByCode(code))!.sections.campaign!)?.day === day, 5000, "the campaign to be saved");
      const rec = (await store.findByCode(code))!;
      expect(rec.sections.powers).toBe(future);
      expect(rec.sectionVersions.powers).toBe(99);
    }, 60000);

    if (variant.name.startsWith("PGlite")) {
      it("absence gives the rival whole idle days (capped) at the first commit and moves nothing else; the campaign day moves by one", async () => {
        const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED + 2, token: TOKEN })) as unknown as WorldRoom;
        const code = room.state.code;
        const a = await join(room);
        await a.c.leave();
        await room.disconnect();
        const store = await getRoomConfig().persistence!.store();
        await until(async () => !!(await store.findByCode(code)), 5000, "the record");
        // save again under a store clock two days and an hour in the past, so `savedAt` is that old, then resume
        clock!.now = -(2 * DAY_MS + 3600_000);
        const r0 = (await store.findByCode(code))!;
        await store.save({ ...r0 }, r0.rev);
        clock!.now = 0;
        const back = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })) as unknown as WorldRoom;
        const p0 = parsePowers(back.state.powers)!;
        const c0 = parseCampaign(back.state.campaign)!;
        expect(p0.rival.day).toBe(1);
        const b = await join(back);
        void b;
        const sentries = [...back.state.players.entries()].filter(([, p]) => p.npc === NPC.SENTRY);
        expect(sentries.length).toBe(0); // HQ has no garrison: end a crossing the dev way instead
        (back as unknown as { commitOutcome(o: unknown): void }).commitOutcome({
          scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 10, bridge: "intact", brokePromise: false, seconds: 1,
          tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
        });
        const p1 = parsePowers(back.state.powers)!;
        const c1 = parseCampaign(back.state.campaign)!;
        expect(c1.day).toBe(c0.day + 1);
        expect(p1.rival.day).toBe(c1.day + 2); // two idle days on top of the day that passed
        // a second commit gives no more idle days
        (back as unknown as { commitOutcome(o: unknown): void }).commitOutcome({
          scenario: "secure_crossing", resolution: "abandoned", toll: 40, paid: 0, bridge: "intact", brokePromise: false, seconds: 1,
          tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
        });
        expect(parseCampaign(back.state.campaign)!.day).toBe(3);
        expect(parsePowers(back.state.powers)!.rival.day).toBe(4); // still two days ahead of the ledger: no more idle days, and it waits for the ledger to catch up
      }, 60000);
    }
  });
}
