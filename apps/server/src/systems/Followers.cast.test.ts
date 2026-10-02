import { describe, expect, it } from "vitest";
import {
  BUTTON, FLAG, NPC, WEAPON, CollisionWorld, createCharState, npcKey, stepCharacter, weaponToWire, type MoveCommand, type PlayerStateType,
} from "@cb/shared";
import type { NpcBrain, NpcSpec } from "@cb/shared";
import { followerThink } from "@cb/shared";
import { hirePool } from "@cb/shared";
import { npcThink } from "@cb/shared";
import { Cast } from "./Cast.ts";
import { Followers } from "./Followers.ts";

/** The real Cast driving the real followerThink through the real Followers (a single hand, so the brain can be captured from the BrainFn call). */
const DT = 1 / 30;
const SEED = 41;

function setup(kind: "rifleman" | "porter" | "surgeon") {
  const world = new CollisionWorld({ height: () => 0 }, [], 160);
  const rows = new Map<string, PlayerStateType>();
  const mk = (x: number, z: number, o: Partial<PlayerStateType> = {}): PlayerStateType =>
    ({ ...createCharState(x, z, world), name: "", look: "", title: "", health: 100, reviveProgress: 0, reviver: "", dragger: "", slot: 0, connected: true, weapon: weaponToWire(WEAPON.RIFLE), weapons: 0, ammo: 50, reserve: 12, reload: 0, shots: 0, aim: 0, npc: 0, ...o }) as unknown as PlayerStateType;
  const cmds: (MoveCommand & { key: string })[] = [];
  let ms = 100_000;
  const cast = new Cast({
    players: { forEach: (cb) => rows.forEach((p, id) => { if (!p.npc) cb(p, id); }), get: (id) => rows.get(id) },
    spawnNpc: (spec: NpcSpec) => { rows.set(npcKey(spec.id), mk(spec.post.x, spec.post.z, { npc: spec.role, name: spec.name, weapon: weaponToWire(spec.weapon) })); return true; },
    removeNpc: (key) => { rows.delete(key); },
    stepNpc: (key, cmd) => { const p = rows.get(key); if (!p) return; stepCharacter(p as never, cmd, DT, world); cmds.push({ ...cmd, key }); },
    world: () => world, worldMs: () => ms, seed: SEED, fear: () => 10,
    brains: { garrison: npcThink, follower: followerThink },
  });
  // The Cast exposes no `brainOf` yet (the integrator adds it, see the package summary): reach the record the same way it will.
  const brainOf = (id: string): NpcBrain | undefined => (cast as unknown as { recs: { spec: NpcSpec; brain: NpcBrain }[] }).recs.find((r) => r.spec.id === id)?.brain;
  let party = "";
  const purse = { v: 300 };
  const f = new Followers({
    players: { forEach: (cb) => rows.forEach((p, id) => { if (!p.npc) cb(p, id); }), get: (id) => rows.get(id) },
    cast, brainOf: (id) => brainOf(id), purse: () => purse.v, spend: (n) => { purse.v -= n; }, getParty: () => party, setParty: (j) => { party = j; },
    dress: () => true, revive: () => true, propPos: () => undefined, holdProp: () => false, dropProp: () => {}, notice: () => {}, prepOpen: () => true, atSupply: () => true,
    inBounds: (x, z) => Math.abs(x) < 150 && Math.abs(z) < 150, day: () => 2, nowS: () => ms / 1000, seed: SEED,
  });
  const human = mk(0, 80);
  rows.set("p1", human);
  const cand = hirePool(SEED, 2).find((c) => c.kind === kind) ?? (() => { throw new Error(`no ${kind} in the pool`); })();
  expect(f.onHire("p1", { id: cand.id, on: true })).toBe(true);
  ms += 1000;
  f.landfall({ x: 0, z: 82 });
  const row = rows.get(npcKey(cand.id))!;
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { ms += 1000 * DT; cast.tick(DT); f.tick(DT); } };
  return { world, rows, cast, f, human, row, tick, cmds, id: cand.id, mk, brain: () => brainOf(cand.id)! };
}

const deserter = (z: number): NpcSpec => ({
  id: "deserter-1", role: NPC.DESERTER, faction: "rival", side: "outlaw", group: "camp", post: { x: 0, z }, weapon: WEAPON.PISTOL, lookSeed: 5, name: "Deserter", skill: 40, bravery: 70, brain: "garrison",
});

describe("Followers on the real Cast", () => {
  it("a hired hand falls in behind the human who walks away, and keeps within a few metres", () => {
    const s = setup("rifleman");
    s.tick(30);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      s.human.z -= 3 * DT;
      s.tick();
      if (i > 120) worst = Math.max(worst, Math.hypot(s.row.x - s.human.x, s.row.z - s.human.z));
    }
    expect(s.human.z).toBeLessThan(62);
    expect(worst).toBeLessThan(10);
    expect(s.brain().mode).toBe("follow");
  });

  it("answers a deserter's fire with the garrison brain's rules: it shoots (token granted by the Cast), and a hold order keeps it on its point", () => {
    const s = setup("rifleman");
    s.tick(60);
    expect(s.f.onCommand("p1", { intent: "hold", at: { x: 0, z: 78 } })).toMatch(/^Obeyed/);
    s.cast.spawn([deserter(60)]);
    s.cast.order("camp", { o: "alert" }); // (D-041: outlaws act on the party only once their camp is up)
    s.cmds.length = 0;
    s.tick(300);
    const shots = s.cmds.filter((c) => c.key === npcKey(s.id) && (c.buttons & BUTTON.FIRE) !== 0).length;
    expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(s.row.x - 0, s.row.z - 78)).toBeLessThan(14);
    expect(s.row.flags & FLAG.DOWNED).toBe(0);
  });

  it("a porter never fires, whatever is in front of it", () => {
    const s = setup("porter");
    s.cast.spawn([deserter(60)]);
    s.cast.order("camp", { o: "alert" });
    s.cmds.length = 0;
    s.tick(240);
    expect(s.cmds.filter((c) => c.key === npcKey(s.id) && (c.buttons & BUTTON.FIRE) !== 0)).toHaveLength(0);
    expect(s.cmds.some((c) => c.key === "npc:deserter-1" && (c.buttons & BUTTON.FIRE) !== 0)).toBe(true); // (the deserter really was shooting)
  });
});
