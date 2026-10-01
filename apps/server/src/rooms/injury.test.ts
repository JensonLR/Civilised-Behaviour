import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, CASUALTY, FLAG, INJURY, INTERACT, LIMB, MOVEMENT, MoveInput, PROP_DEFS, ROOM_WORLD, ZONE, woundLevel, yawToWire, type PropKindId } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2579; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number }; send(): void };

/** Server-side effects of injuries: hostile input frames, carry/throw rules, field dressing, and limbs surviving revive/rout. */
describe("injuries in play (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ROUT_SECONDS: "1.5" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(n = 1) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 2024 })) as unknown as WorldRoom;
    const ps = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const notices: string[] = [];
      c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
      ps.push({ c, input, notices, id: c.sessionId, p: room.state.players.get(c.sessionId)! });
    }
    await sleep(150);
    return { room, ps };
  }
  type P = Awaited<ReturnType<typeof setup>>["ps"][number];
  // Private members are reachable in tests via bracket access (typed, unlike `as any`).
  const cas = (room: WorldRoom) => room["casualties"];

  /** Records every prop the server ever picked up (the per-tick "can still hold it" check would otherwise mask a missing pickup gate). */
  const watchHolds = (room: WorldRoom) => {
    const holds: string[] = [];
    const physics = room["physics"];
    const hold = physics.hold.bind(physics);
    physics.hold = (id, sid) => {
      holds.push(id);
      return hold(id, sid);
    };
    return holds;
  };

  const propWith = (room: WorldRoom, heavy: boolean) => {
    // (D-038: props now come in clusters of three, so the one a test stands beside must have no neighbour within 2.5 m, or "the nearest" is another prop than the one named)
    const all = [...room.state.props.entries()];
    const alone = ([k, p]: (typeof all)[number]): boolean => all.every(([k2, q]) => k2 === k || !PROP_DEFS[q.kind as PropKindId].carryable || Math.hypot(q.x - p.x, q.z - p.z) > 2.5);
    const found = all.find((e) => (PROP_DEFS[e[1].kind as PropKindId].mass > INJURY.lightPropMass) === heavy && PROP_DEFS[e[1].kind as PropKindId].carryable && alone(e));
    expect(found, heavy ? "seed has a crate or barrel" : "seed has a bottle or chair").toBeDefined();
    return found!;
  };

  const standNear = (a: P, prop: { x: number; y: number; z: number }) => {
    a.p.x = prop.x;
    a.p.z = prop.z + 1.2;
    a.p.y = prop.y - 0.3;
    a.p.facing = 0;
    a.p.vx = a.p.vz = 0;
  };
  /** Puts `b` 1 m south of `a` (so `b` faces north/-Z toward `a`), at rest. */
  const placeNear = (a: P, b: P) => {
    b.p.x = a.p.x;
    b.p.z = a.p.z + 1.0;
    b.p.y = a.p.y;
    b.p.facing = 0;
    b.p.vx = b.p.vz = 0;
  };

  /** Streams crafted frames at ~30 Hz. `perStep` > 1 floods. Restores an all-zero frame afterwards. */
  const stream = async (who: P, ms: number, f: { buttons?: number; moveF?: number; yaw?: number; perStep?: number; sample?: () => void }) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (let k = 0; k < (f.perStep ?? 1); k++) {
        who.input.data.buttons = f.buttons ?? 0;
        who.input.data.moveF = Math.round((f.moveF ?? 0) * 127);
        who.input.data.moveR = 0;
        who.input.data.yaw = f.yaw ?? 0;
        who.input.send();
      }
      await sleep(33);
      f.sample?.();
    }
    who.input.data.buttons = 0;
    who.input.data.moveF = 0;
    who.input.send();
  };
  const press = async (who: P, buttons: number) => {
    await stream(who, 120, { buttons });
    await sleep(120);
  };

  /** Runs a player east across open ground (north is the stone wall) with the given buttons; returns the peak horizontal speed and airtime evidence. */
  const runEast = async (who: P, buttons: number) => {
    who.p.x = 0;
    who.p.z = 0;
    who.p.vx = who.p.vz = who.p.vy = 0;
    let peakSpeed = 0;
    let peakVy = 0;
    await stream(who, 1200, {
      buttons,
      moveF: 1,
      yaw: yawToWire(-Math.PI / 2),
      sample: () => {
        peakSpeed = Math.max(peakSpeed, Math.hypot(who.p.vx, who.p.vz));
        peakVy = Math.max(peakVy, who.p.vy);
      },
    });
    return { peakSpeed, peakVy };
  };

  describe("hostile input: the client cannot buy abilities its body lacks", () => {
    const SPRINT_JUMP = BUTTON.SPRINT | BUTTON.JUMP;

    it("control: a healthy body sprints and jumps on the same frames", async () => {
      const { ps } = await setup();
      const r = await runEast(ps[0]!, SPRINT_JUMP);
      expect(r.peakSpeed).toBeGreaterThan(MOVEMENT.sprintSpeed * 0.85);
      expect(r.peakVy).toBeGreaterThan(MOVEMENT.jumpSpeed * 0.5);
    });

    it("sprint + jump frames from a one-legged body: hobble speed, no sprint, no jump", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.LEG_R);
      expect(a.p.flags & FLAG.PEG_LEG).toBeFalsy();
      const r = await runEast(a, SPRINT_JUMP);
      expect(r.peakSpeed).toBeLessThan(MOVEMENT.runSpeed * INJURY.leg.lost + 0.15);
      expect(r.peakVy).toBeLessThan(0.5);
    });

    it("a grievous leg wound forbids sprint and jump the same way", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      room.damagePlayer(a.id, 44, { zone: ZONE.LEG_L }); // grievous, not severed
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(3);
      const r = await runEast(a, SPRINT_JUMP);
      expect(r.peakSpeed).toBeLessThan(MOVEMENT.runSpeed * INJURY.leg.grievous + 0.15);
      expect(r.peakVy).toBeLessThan(0.5);
    });

    it("flooding sprint frames does not help either (the input budget still applies to a hobbled body)", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.LEG_L);
      a.p.x = a.p.z = 0;
      let peak = 0;
      await stream(a, 1200, { buttons: SPRINT_JUMP, moveF: 1, yaw: yawToWire(-Math.PI / 2), perStep: 3, sample: () => (peak = Math.max(peak, Math.hypot(a.p.vx, a.p.vz))) });
      expect(peak).toBeLessThan(MOVEMENT.runSpeed * INJURY.leg.lost + 0.15);
    });

    it("garbage button bits (0xffff) from an armless, one-legged body change nothing about what it can do", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.ARM_L);
      cas(room).sever(a.id, LIMB.ARM_R);
      cas(room).sever(a.id, LIMB.LEG_R);
      const [, crate] = propWith(room, true);
      const holds = watchHolds(room);
      standNear(a, crate);
      await sleep(100);
      await stream(a, 600, { buttons: 0xffff, moveF: 0 });
      expect(holds).toEqual([]);
      expect(crate.holder).toBeFalsy();
      expect(a.p.flags & FLAG.CARRYING).toBeFalsy();
    });

    it("fake carry: an armless body pressing INTERACT never gets the prop, heavy or light, and is told why", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.ARM_L);
      cas(room).sever(a.id, LIMB.ARM_R);
      const holds = watchHolds(room);
      for (const heavy of [true, false]) {
        const [, prop] = propWith(room, heavy);
        standNear(a, prop);
        await sleep(100);
        await press(a, BUTTON.INTERACT);
        await press(a, BUTTON.INTERACT | BUTTON.THROW);
        expect(prop.holder, heavy ? "crate" : "bottle").toBeFalsy();
        expect(a.p.flags & FLAG.CARRYING).toBeFalsy();
      }
      expect(holds).toEqual([]); // refused at the gate, not merely dropped a tick later
      expect(a.notices.some((t) => /no arms/.test(t))).toBe(true);
      expect(a.notices.length).toBeLessThanOrEqual(2); // rate limited: it is a courtesy, not a channel
    });

    it("one arm lost: light props only", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.ARM_R);
      const [, heavy] = propWith(room, true);
      const holds = watchHolds(room);
      standNear(a, heavy);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(holds).toEqual([]);
      expect(heavy.holder).toBeFalsy();
      expect(a.notices.some((t) => /no state to carry/.test(t))).toBe(true);
      const [, light] = propWith(room, false);
      standNear(a, light);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(light.holder).toBe(a.id);
      expect(a.p.flags & FLAG.CARRYING).toBeTruthy();
    });

    it("a grievous arm wound also limits a carrier to light props; a gash does not", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      const [, heavy] = propWith(room, true);
      room.damagePlayer(a.id, 30, { zone: ZONE.ARM_L }); // gash
      expect(woundLevel(a.p.wounds, ZONE.ARM_L)).toBe(2);
      standNear(a, heavy);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(heavy.holder).toBe(a.id);
      await press(a, BUTTON.INTERACT); // put it down again
      room.damagePlayer(a.id, 30, { zone: ZONE.ARM_R });
      room.damagePlayer(a.id, 44, { zone: ZONE.ARM_L }); // now grievous
      const holds = watchHolds(room);
      standNear(a, heavy);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(holds).toEqual([]);
      expect(heavy.holder).toBeFalsy();
    });

    it("losing an arm mid-carry drops a heavy prop, but a light one is kept", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      const [, crate] = propWith(room, true);
      standNear(a, crate);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(crate.holder).toBe(a.id);
      cas(room).sever(a.id, LIMB.ARM_L);
      await sleep(150);
      expect(crate.holder).toBeFalsy();
      expect(a.p.flags & FLAG.CARRYING).toBeFalsy();
      expect(a.notices.some((t) => /slips from your grasp/.test(t))).toBe(true);

      const [, bottle] = propWith(room, false);
      standNear(a, bottle);
      await sleep(100);
      await press(a, BUTTON.INTERACT);
      expect(bottle.holder).toBe(a.id);
      cas(room).sever(a.id, LIMB.ARM_R); // now armless: nothing at all
      await sleep(150);
      expect(bottle.holder).toBeFalsy();
    });

    it("throws are weaker with a lost arm (server-side strength from the shared rule)", async () => {
      const measure = async (missing: number) => {
        const { room, ps } = await setup();
        const [a] = ps as [P];
        if (missing) cas(room).sever(a.id, missing as never);
        const [id, prop] = propWith(room, false);
        standNear(a, prop);
        await sleep(100);
        await press(a, BUTTON.INTERACT);
        expect(prop.holder).toBe(a.id);
        a.p.facing = 0;
        let peak = 0;
        const body = room["physics"].props.get(id)!.body;
        a.input.data.buttons = BUTTON.THROW;
        a.input.send();
        for (let i = 0; i < 12; i++) {
          await sleep(10);
          const v = body.linvel();
          peak = Math.max(peak, Math.hypot(v.x, v.z));
        }
        await colyseus.cleanup();
        return peak;
      };
      const healthy = await measure(0);
      const oneArm = await measure(LIMB.ARM_L);
      expect(healthy).toBeGreaterThan(INTERACT.throwSpeed * 0.8);
      expect(oneArm).toBeLessThan(healthy * 0.75);
      expect(oneArm).toBeGreaterThan(INTERACT.throwSpeed * 0.3);
    });
  });

  describe("wooden leg", () => {
    it("the server raises the peg flag only where a leg is missing on the fitted side, and the hobble softens without vanishing", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      a.c.send("debug", { cmd: "peg:2" }); // fit a right wooden leg (campaign history is server-owned)
      await sleep(100);
      expect(a.p.flags & FLAG.PEG_LEG).toBeFalsy(); // nothing missing yet
      cas(room).sever(a.id, LIMB.LEG_L); // wrong side
      expect(a.p.flags & FLAG.PEG_LEG).toBeFalsy();
      const bare = await runEast(a, BUTTON.SPRINT | BUTTON.JUMP);
      cas(room).sever(a.id, LIMB.LEG_R);
      expect(a.p.flags & FLAG.PEG_LEG).toBeTruthy();
      cas(room).restoreLimbs(a.id);
      expect(a.p.flags & FLAG.PEG_LEG).toBeFalsy(); // debug regrowth clears it again
      a.p.wounds = 0; // (regrowth leaves the old stump wounds behind; start the comparison clean)
      cas(room).sever(a.id, LIMB.LEG_R);
      expect(a.p.flags & FLAG.PEG_LEG).toBeTruthy();
      const peg = await runEast(a, BUTTON.SPRINT | BUTTON.JUMP);
      expect(peg.peakSpeed).toBeGreaterThan(bare.peakSpeed + 0.4);
      expect(peg.peakSpeed).toBeLessThan(MOVEMENT.runSpeed * INJURY.leg.peg + 0.2);
      expect(peg.peakSpeed).toBeLessThan(MOVEMENT.runSpeed);
    });

    it("a client cannot grant itself a wooden leg (look history is server-owned)", async () => {
      const { room, ps } = await setup();
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.LEG_L);
      a.c.send("setLook", { look: "" });
      await sleep(100);
      expect(a.p.flags & FLAG.PEG_LEG).toBeFalsy();
    });
  });

  describe("limbs survive recovery", () => {
    it("revive patches wounds to a dressing but never regrows a lost limb", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      cas(room).sever(a.id, LIMB.LEG_L);
      cas(room).sever(a.id, LIMB.ARM_R);
      room.damagePlayer(a.id, 1000, { zone: ZONE.TORSO });
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
      placeNear(a, b);
      await sleep(80);
      await stream(b, (CASUALTY.reviveSeconds + 0.8) * 1000, { buttons: BUTTON.INTERACT });
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
      expect(a.p.missing).toBe(LIMB.LEG_L | LIMB.ARM_R);
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(2); // capped to a dressed stump
      // Still hobbled and one-handed after standing up.
      const r = await runEast(a, BUTTON.SPRINT | BUTTON.JUMP);
      expect(r.peakSpeed).toBeLessThan(MOVEMENT.runSpeed * INJURY.leg.lost + 0.15);
    });

    it("a rout gets everyone up again, still missing what they lost", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [P];
      cas(room).sever(a.id, LIMB.LEG_R);
      room.damagePlayer(a.id, 1000, { zone: ZONE.TORSO });
      await sleep(2200); // ROUT_SECONDS 1.5
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
      expect(a.p.missing).toBe(LIMB.LEG_R);
    });
  });

  describe("field dressing", () => {
    const wound = (room: WorldRoom, a: P, zone = ZONE.LEG_L) => room.damagePlayer(a.id, 44, { zone }); // grievous, never severs

    it("a comrade holding INTERACT dresses a standing player's worst wound by exactly one level", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      wound(room, a);
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(3);
      placeNear(a, b);
      await sleep(80);
      let sawProgress = 0;
      await stream(b, (CASUALTY.dressSeconds + 0.6) * 1000, { buttons: BUTTON.INTERACT, sample: () => (sawProgress = Math.max(sawProgress, a.p.reviveProgress)) });
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(2); // one level, though the button stayed down longer
      expect(sawProgress).toBeGreaterThan(30);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
      expect(a.p.reviver).toBe("");
      expect(a.p.health).toBe(56); // dressing is not healing
    });

    it("is capped: repeat dressings stop at a scratch, and a stump stays a stump", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      wound(room, a);
      cas(room).sever(a.id, LIMB.ARM_L);
      placeNear(a, b);
      await sleep(80);
      const dress = () => stream(b, (CASUALTY.dressSeconds + 0.5) * 1000, { buttons: BUTTON.INTERACT });
      for (let i = 0; i < 4; i++) await dress(); // one more than the three it takes
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(1); // a scratch remains: literal on purpose, not the tuning constant
      expect(woundLevel(a.p.wounds, ZONE.ARM_L)).toBe(2); // a dressed stump
      expect(a.p.missing & LIMB.ARM_L).toBeTruthy();
      const before = a.p.wounds;
      await dress();
      expect(a.p.wounds).toBe(before);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy(); // nothing left to do: no kneeling
    });

    it("needs a continuous hold in reach: an early release, distance, or self-dressing does nothing", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      wound(room, a);
      const start = a.p.wounds;
      placeNear(a, b);
      await sleep(80);
      await stream(b, 900, { buttons: BUTTON.INTERACT }); // released at ~45%
      await sleep(100);
      expect(a.p.wounds).toBe(start);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
      expect(a.p.reviveProgress).toBe(0);
      // too far
      b.p.z = a.p.z + 6;
      await sleep(80);
      await stream(b, 2600, { buttons: BUTTON.INTERACT });
      expect(a.p.wounds).toBe(start);
      // a lone wounded player cannot dress themself
      await stream(a, 2600, { buttons: BUTTON.INTERACT });
      expect(a.p.wounds).toBe(start);
      expect(a.p.flags & FLAG.REVIVING).toBeFalsy();
    });

    it("flooding INTERACT frames does not speed a dressing up (the timer runs on server ticks)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      wound(room, a);
      const start = a.p.wounds;
      placeNear(a, b);
      await sleep(80);
      await stream(b, 1100, { buttons: BUTTON.INTERACT, perStep: 4 }); // 4x frames for ~55% of the hold
      await sleep(60);
      expect(a.p.wounds).toBe(start);
    });

    it("a downed comrade is revived, not dressed; a bandaged-up scratch is left alone", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 12, { zone: ZONE.TORSO }); // a scratch: below the dressing floor
      expect(woundLevel(a.p.wounds, ZONE.TORSO)).toBe(1);
      placeNear(a, b);
      await sleep(80);
      await press(b, BUTTON.INTERACT);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
    });

    it("a maimed player who cannot lift the crate beside a wounded comrade dresses them instead; a healthy one lifts the crate", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      const [, crate] = propWith(room, true);
      wound(room, a);
      cas(room).sever(b.id, LIMB.ARM_L);
      standNear(b, crate);
      a.p.x = crate.x + 0.5;
      a.p.z = crate.z + 1.2;
      a.p.y = b.p.y;
      a.p.vx = a.p.vz = 0;
      await sleep(80);
      await stream(b, (CASUALTY.dressSeconds + 0.5) * 1000, { buttons: BUTTON.INTERACT });
      expect(crate.holder).toBeFalsy();
      expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(2);
    });

    it("the prop wins when a healthy player has both in reach (a press is instant, a dressing is a hold)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      const [, crate] = propWith(room, true);
      wound(room, a);
      standNear(b, crate);
      a.p.x = crate.x + 0.5;
      a.p.z = crate.z + 1.2;
      a.p.y = b.p.y;
      a.p.vx = a.p.vz = 0;
      await sleep(80);
      await press(b, BUTTON.INTERACT);
      expect(crate.holder).toBe(b.id);
    });
  });
});
