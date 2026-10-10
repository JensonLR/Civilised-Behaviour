import { describe, expect, it } from "vitest";
import { FIRE, FLAG, FireGrid, HIGHMARK, PropKind, createRegionWorld, decodeBurning, type PlayerStateType, type PropStateType, type RegionId } from "@cb/shared";
import { Fire, type FireHost } from "./Fire.ts";

/** D-103: the server half of fire. People catch in it, burn, spread it and put themselves out; kegs cook off; NPCs panic; the room gets two strings to replicate. */

const world = createRegionWorld("highmark", 7);
const SEED = 7;

/** A spot in the savannah with fuel all round it (the same search the shared tests use). */
function spot(): { x: number; z: number } {
  const g = new FireGrid(world, "highmark", SEED);
  let best = -1;
  let bestS = 0;
  for (let c = g.w * 3 + 3; c < g.cells - g.w * 3 - 3; c += 13) {
    if (g.fuelOf(c) < 0.5) continue;
    let s = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += g.fuelOf(c + dj * g.w + di);
    if (s > bestS) {
      bestS = s;
      best = c;
    }
  }
  return { x: g.centreX(best), z: g.centreZ(best) };
}
const AT = spot();

/** Dry ground that will not burn (a road, bare earth), within the bounds. */
function bare(): { x: number; z: number } {
  const g = new FireGrid(world, "highmark", SEED);
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  for (let c = 0; c < g.cells; c += 17) {
    const x = g.centreX(c);
    const z = g.centreZ(c);
    if (Math.hypot(x, z) < 100 && g.fuelOf(c) === 0 && (t.waterDepth?.(x, z) ?? 0) === 0) return { x, z };
  }
  throw new Error("no bare ground");
}
const BARE = bare();

type Row = Pick<PlayerStateType, "x" | "y" | "z" | "flags" | "slot" | "npc" | "burn" | "health">;
const row = (x: number, z: number, over: Partial<Row> = {}): Row => ({ x, y: world.terrainHeight(x, z), z, flags: 0, slot: 0, npc: 0, burn: 0, health: 100, ...over });

function rig(): {
  fire: Fire;
  rows: Map<string, Row>;
  props: Map<string, Pick<PropStateType, "kind" | "x" | "y" | "z" | "holder" | "fuse">>;
  log: { damage: Map<string, number>; cooked: string[]; panicked: string[]; scared: number; burning: string; scorch: string };
  run(seconds: number): void;
} {
  const rows = new Map<string, Row>();
  const props = new Map<string, Pick<PropStateType, "kind" | "x" | "y" | "z" | "holder" | "fuse">>();
  const log = { damage: new Map<string, number>(), cooked: [] as string[], panicked: [] as string[], scared: 0, burning: "", scorch: "" };
  let ms = 0;
  const host: FireHost = {
    players: { forEach: (cb) => rows.forEach((r, id) => cb(r as PlayerStateType, id)) },
    props: { forEach: (cb) => props.forEach((p, id) => cb(p as PropStateType, id)) },
    seed: SEED,
    worldMs: () => ms,
    world: () => world,
    region: () => "highmark" as RegionId,
    damage: (id, n) => {
      log.damage.set(id, (log.damage.get(id) ?? 0) + n);
      const r = rows.get(id)!;
      r.health = Math.max(0, r.health - n);
    },
    cookOff: (id) => {
      log.cooked.push(id);
      props.get(id)!.fuse = 30;
    },
    panic: (id) => void log.panicked.push(id),
    scare: () => void log.scared++,
    writeBurning: (s) => void (log.burning = s),
    writeScorch: (s) => void (log.scorch = s),
  };
  const fire = new Fire(host);
  return {
    fire,
    rows,
    props,
    log,
    run(seconds) {
      for (let t = 0; t < seconds * 20; t++) {
        ms += 50;
        fire.tick(0.05);
      }
    },
  };
}

describe("D-103: people and fire", () => {
  it("standing in the flames sets you alight; alight, you lose health and spread it, and it goes out a few seconds after you leave", () => {
    const r = rig();
    r.rows.set("ada", row(AT.x, AT.z));
    expect(r.fire.ignite(AT.x, AT.z, 2)).toBeGreaterThan(0);
    r.run(1.5);
    expect(r.fire.isAlight("ada")).toBe(true);
    expect(r.rows.get("ada")!.burn).toBeGreaterThan(0);
    expect(r.log.damage.get("ada") ?? 0).toBeGreaterThan(3);
    // she runs out of it, onto bare water: put out at once
    const ada = r.rows.get("ada")!;
    ada.x = 0;
    ada.z = HIGHMARK.river.z; // (Highmark's river)
    ada.y = world.terrainHeight(ada.x, ada.z);
    r.run(0.3);
    expect(r.fire.isAlight("ada")).toBe(false);
    expect(ada.burn).toBe(0);
  });

  it("crouching (stop, drop and roll) puts you out sooner than standing", () => {
    const burnFor = (crouch: boolean): number => {
      const r = rig();
      r.rows.set("ada", row(AT.x, AT.z));
      r.fire.ignite(AT.x, AT.z, 2);
      r.run(1);
      expect(r.fire.isAlight("ada")).toBe(true);
      // out of the fire onto ground that will not burn, crouched or not
      const ada = r.rows.get("ada")!;
      ada.x = BARE.x;
      ada.z = BARE.z;
      ada.y = world.terrainHeight(BARE.x, BARE.z);
      ada.flags = crouch ? FLAG.CROUCHING : 0;
      let t = 0;
      while (r.fire.isAlight("ada") && t < 400) {
        r.run(0.05);
        t++;
      }
      return t;
    };
    expect(burnFor(true)).toBeLessThan(burnFor(false) * 0.6);
  });

  it("an NPC alight panics; the downed do not catch; the flames frighten the people near them", () => {
    const r = rig();
    r.rows.set("npc:guard", row(AT.x, AT.z, { npc: 13, slot: 16 }));
    r.rows.set("npc:fallen", row(AT.x, AT.z, { npc: 13, slot: 17, flags: FLAG.DOWNED }));
    r.fire.ignite(AT.x, AT.z, 2);
    r.run(2);
    expect(r.log.panicked).toContain("npc:guard");
    expect(r.log.panicked).not.toContain("npc:fallen");
    expect(r.log.damage.get("npc:fallen")).toBeUndefined();
    expect(r.log.scared).toBeGreaterThan(0);
  });

  it("a keg on burning ground cooks off, and so does one carried by somebody alight", () => {
    const r = rig();
    r.props.set("keg1", { kind: PropKind.BARREL, x: AT.x, y: world.terrainHeight(AT.x, AT.z) + 0.45, z: AT.z, holder: "", fuse: 0 });
    r.props.set("crate", { kind: PropKind.CRATE, x: AT.x, y: world.terrainHeight(AT.x, AT.z) + 0.4, z: AT.z, holder: "", fuse: 0 });
    r.props.set("keg2", { kind: PropKind.BARREL, x: 0, y: 30, z: 0, holder: "bram", fuse: 0 });
    r.rows.set("bram", row(AT.x, AT.z));
    r.fire.ignite(AT.x, AT.z, 2);
    r.run(2);
    expect(r.log.cooked).toContain("keg1");
    expect(r.log.cooked).toContain("keg2");
    expect(r.log.cooked).not.toContain("crate");
  });

  it("writes the burning cells while it burns, empties them when it is out, and keeps the scorch", () => {
    const r = rig();
    r.fire.ignite(AT.x, AT.z, 2);
    r.run(1);
    let n = 0;
    decodeBurning(r.log.burning, 1e6, () => n++);
    expect(n).toBeGreaterThan(0);
    r.run(400);
    expect(r.fire.burning).toBe(0);
    expect(r.log.burning).toBe("");
    expect(r.log.scorch.length).toBeGreaterThan(0);
  });

  it("a new region forgets the fire and puts everybody out", () => {
    const r = rig();
    r.rows.set("ada", row(AT.x, AT.z));
    r.fire.ignite(AT.x, AT.z, 2);
    r.run(1);
    r.fire.reset();
    expect(r.fire.burning).toBe(0);
    expect(r.fire.isAlight("ada")).toBe(false);
    expect(r.rows.get("ada")!.burn).toBe(0);
    expect(r.log.burning).toBe("");
    expect(r.log.scorch).toBe("");
  });

  it("a blast lights the grass within its reach", () => {
    const r = rig();
    expect(r.fire.blast(AT.x, AT.z, 6)).toBeGreaterThan(3);
    expect(r.fire.burningAt(AT.x, AT.z)).toBe(true);
    expect(FIRE.blastIgnite).toBeLessThan(1);
  });
});
