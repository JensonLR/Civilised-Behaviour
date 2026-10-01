import { expect } from "vitest";
import { FLAG, askingToll, answerParley, leverageOf, newCampaign, npcKey, openParley } from "@cb/shared";
import type { CampaignState, CastApi, CastCount, CastOrder, NpcSide, NpcSpec, ParleyView, PlayerStateType, ScenarioOutcome, ScenarioTemplateId, ScenarioView } from "@cb/shared";
import { Scenario, type ScenarioHost } from "./Scenario.ts";

/**
 * The fake host and fake Cast for the Vesper runner tests (package C3: MineRescue.test.ts, ClaimRace.test.ts). Test-only: no server source is touched. It mirrors the one in Succession.test.ts, plus
 * a record of the blasts the runner asked for, so a test can see the keg go off.
 */

export const DT = 0.25;
export type Row = PlayerStateType & { id: string };
export const row = (id: string, x: number, z: number, o: Partial<PlayerStateType> = {}): Row =>
  ({ id, name: id, x, y: 0, z, facing: 0, flags: FLAG.GROUNDED, health: 100, wounds: 0, missing: 0, weapon: 2, ammo: 5, slot: 0, connected: true, ...o }) as unknown as Row;

export class FakeCast implements CastApi {
  specs: NpcSpec[] = [];
  orders: { group: string; order: CastOrder }[] = [];
  wars: { a: NpcSide; b: NpcSide; on: boolean }[] = [];
  despawned: string[] = [];
  constructor(readonly players: Map<string, Row>) {}
  spawn(specs: readonly NpcSpec[]): number {
    let n = 0;
    for (const sp of specs) {
      if (this.players.has(npcKey(sp.id))) continue;
      this.players.set(npcKey(sp.id), row(npcKey(sp.id), sp.post.x, sp.post.z, { weapon: sp.weapon + 1, ammo: 6, npc: sp.role } as Partial<PlayerStateType>));
      this.specs.push(sp);
      n++;
    }
    return n;
  }
  order(group: string, o: CastOrder): void { this.orders.push({ group, order: o }); }
  setWar(a: NpcSide, b: NpcSide, on: boolean): void { this.wars.push({ a, b, on }); }
  count(group: string): CastCount {
    let alive = 0, down = 0, total = 0;
    for (const sp of this.specs) {
      if (sp.group !== group) continue;
      total++;
      const r = this.players.get(npcKey(sp.id));
      if (!r || (r.flags & FLAG.DOWNED) !== 0) down++;
      else alive++;
    }
    return { alive, routed: 0, down, total };
  }
  row(id: string): PlayerStateType | undefined { return this.players.get(npcKey(id)); }
  defineRoute(): void {}
  noise(): void {}
  despawn(group?: string): void {
    for (const sp of [...this.specs]) {
      if (group !== undefined && sp.group !== group) continue;
      this.players.delete(npcKey(sp.id));
      this.specs.splice(this.specs.indexOf(sp), 1);
    }
    this.despawned.push(group ?? "*");
  }
  tick(): void {}
  setWorld(): void {}
  atWar(): boolean { return false; }
  groupOrders(group: string): string[] { return this.orders.filter((o) => o.group === group).map((o) => o.order.o); }
}

export interface Fake {
  host: ScenarioHost;
  players: Map<string, Row>;
  cast: FakeCast;
  commits: ScenarioOutcome[];
  sent: { sid: string; type: string; msg: any }[];
  views: ScenarioView[];
  consumed: string[];
  blasts: { x: number; z: number; radius: number; owner: string }[];
  props: Map<string, { kind: number; x: number; z: number }>;
  clock: { ms: number };
}

export function fake(campaign: CampaignState = { ...newCampaign(11), purse: 400 }): Fake {
  const players = new Map<string, Row>();
  const cast = new FakeCast(players);
  const f: Fake = { players, cast, commits: [], sent: [], views: [], consumed: [], blasts: [], props: new Map(), clock: { ms: 0 }, host: undefined as never };
  f.host = {
    players: players as unknown as ScenarioHost["players"],
    worldMs: () => f.clock.ms,
    campaign: () => campaign,
    commit: (o) => void f.commits.push(o),
    cast,
    mounts: undefined,
    consumeProp: (id) => void f.consumed.push(id),
    propKind: (id) => f.props.get(id)?.kind,
    propPos: (id) => { const p = f.props.get(id); return p ? { x: p.x, y: 0, z: p.z } : undefined; },
    propsNear: () => [],
    spawnProp: (kind, x, z) => { const id = `prop-${f.props.size + 1}`; f.props.set(id, { kind, x, z }); return id; },
    rebuildBridge: () => {},
    explode: (x, _y, z, radius, owner) => void f.blasts.push({ x, z, radius, owner }),
    publish: (v) => void f.views.push(v),
    send: (sid, type, msg) => void f.sent.push({ sid, type, msg }),
    negotiation: { askingToll, leverageOf, openParley, answerParley },
    seed: 424242,
    groundY: () => 0,
  };
  return f;
}

export const setup = (f: Fake, id: ScenarioTemplateId, ...ps: Row[]): Scenario => {
  for (const p of ps) f.players.set(p.id, p);
  const s = new Scenario(f.host, id);
  s.start();
  return s;
};
export const run = (f: Fake, s: Scenario, seconds: number, dt = DT): void => {
  for (let t = 0; t < seconds; t += dt) {
    f.clock.ms += dt * 1000;
    s.tick(dt);
  }
};
export const me = (f: Fake, id = "p1"): Row => f.players.get(id)!;
export const put = (f: Fake, id: string, x: number, z: number): void => { const r = f.players.get(id)!; r.x = x; r.z = z; };
export const beside = (f: Fake, id: string, npc: string, dx = 0.8): void => { const r = f.players.get(npcKey(npc))!; put(f, id, r.x + dx, r.z); };
export const lastParley = (f: Fake, sid: string): { view?: ParleyView; closed?: boolean; line?: string } | undefined => [...f.sent].reverse().find((m) => m.sid === sid && m.type === "parley")?.msg;
export const labelIndex = (v: ParleyView, re: RegExp): number => v.options.findIndex((o) => re.test(o.label));
export const down = (f: Fake, key: string): void => { const r = f.players.get(key)!; r.flags |= FLAG.DOWNED; r.health = 0; };
export const lastView = (f: Fake): ScenarioView => f.views.at(-1)!;
export const press = (f: Fake, s: Scenario, id = "p1", prop?: string): boolean => s.onInteract(id, me(f, id), prop);
export const npcKeys = (f: Fake): string[] => [...f.players.keys()].filter((k) => k.startsWith("npc:"));
export const notices = (f: Fake): string[] => f.sent.filter((m) => m.type === "notice").map((m) => String(m.msg.text));

/** Talks to `who` and picks the option whose label matches. */
export function pick(f: Fake, s: Scenario, who: string, re: RegExp, sid = "p1"): void {
  beside(f, sid, who);
  expect(press(f, s, sid), `press at ${who}`).toBe(true);
  const v = lastParley(f, sid)!.view!;
  expect(v, `a parley with ${who}`).toBeDefined();
  const i = labelIndex(v, re);
  expect(i, `${re} among ${v.options.map((o) => o.label).join(" | ")}`).toBeGreaterThanOrEqual(0);
  s.onPick(sid, i);
}
