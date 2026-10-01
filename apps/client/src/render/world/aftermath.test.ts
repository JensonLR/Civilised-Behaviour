import { Scene } from "three";
import { describe, expect, it } from "vitest";
import { AUDIT, CHARACTER, CollisionWorld, checkProps, doorApron, insideShape, penetration, type AuditDoor, type AuditProp, type AuditRoute, type Obstacle, type RegionId } from "@cb/shared";
import { DECAL, DecalField } from "../decals/index.ts";
import { ShotFx } from "../weapons/ShotFx.ts";
import { AFTERMATH_MAX, Aftermath, aftermathCount, planAftermath, planExtends, type AftermathCentre, type AftermathInput, type AftermathItem, type AftermathSite, type AftermathTally } from "./aftermath.ts";

/**
 * The aftermath plan: deterministic, monotone in the tally, never inside a solid, clear of door aprons (the level audit's own rules, asked of the audit), honours gore;
 * and its drawing is a handful of instanced meshes.
 */

const flat = { height: (): number => 0 };

/** A hut at the origin with a door on +x (the apron stands in front of it), a long wall, and a walked street along z at x = 12. */
function synthetic(): AftermathSite {
  const T = 0.3;
  const wall = (x: number, z: number, hx: number, hz: number): Obstacle => ({ kind: "box", tag: "house", x, z, hx, hz, yaw: 0, y0: -1, y1: 2.6 });
  const obstacles: Obstacle[] = [
    wall(-3 + T / 2, 0, T / 2, 3),
    wall(0, -3 + T / 2, 3, T / 2),
    wall(0, 3 - T / 2, 3, T / 2),
    wall(3 - T / 2, -2.1, T / 2, 0.9),
    wall(3 - T / 2, 2.1, T / 2, 0.9),
    wall(12, 0, 0.3, 20),
  ];
  const door: AuditDoor = { id: "hut.door", building: "hut", x: 3, z: 0, yaw: 0, width: 1.5, height: 2.3, leads: "interior", room: { x: 0, z: 0, hx: 2.6, hz: 2.6, yaw: 0, lit: true } };
  const street: AuditRoute = { id: "street", class: "street", points: [{ x: 6, z: -15 }, { x: 6, z: 15 }] };
  return { region: "hollowmere", world: new CollisionWorld(flat, obstacles, 80), doors: [door], routes: [street] };
}

const CENTRES: AftermathCentre[] = [
  { x: 5, z: 0, kind: "casualty", w: 2 },
  { x: 8, z: 6, kind: "casualty" },
  { x: 6, z: -6, kind: "blast" },
  { x: 9, z: 3, kind: "blast" },
];
const TALLY: AftermathTally = { dead: 5, downed: 3, blasts: 5, fires: 1 };
const input = (over: Partial<AftermathInput> = {}): AftermathInput => ({ region: "hollowmere", seed: 7, tally: TALLY, centres: CENTRES, gore: "full", site: synthetic(), ...over });

/** The audit's own verdict on a plan's footprints, plus the one rule that would be easy to get wrong: nothing inside a solid. */
function violations(items: readonly AftermathItem[], site: AftermathSite): string[] {
  const out: string[] = [];
  const props: AuditProp[] = items.filter((i) => i.kind !== "smoke").map((i) => ({ id: i.id, x: i.x, z: i.z, r: i.r }));
  for (const f of checkProps(site.region, site.world, props, site.doors, [])) if (f.severity === "error") out.push(`${f.subject}: ${f.kind} ${f.detail}`);
  for (const i of items) {
    if (i.kind === "smoke") continue;
    // (a solid that blocks a body: it rises above a step from where the item stands, as the audit reckons it; a low kerb is something a crow perches on)
    for (const o of site.world.obstacles) if (o.y1 > i.y + CHARACTER.stepHeight && o.y0 < i.y + 1 && insideShape(o, i.x, i.z, i.r * 0.5)) out.push(`${i.id} (${i.x.toFixed(1)}, ${i.z.toFixed(1)}, r ${i.r.toFixed(2)}): inside a solid ${JSON.stringify(o)}`);
    for (const d of site.doors) if (penetration({ kind: "circle", x: i.x, z: i.z, r: i.r, y0: -1e3, y1: 1e3 }, doorApron(d)) > 0) out.push(`${i.id}: in the apron of ${d.id}`);
  }
  return out;
}

describe("the plan", () => {
  it("is deterministic in its inputs, and region and seed change it", () => {
    const a = planAftermath(input());
    const b = planAftermath(input());
    expect(a.length).toBeGreaterThan(8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(planAftermath(input({ seed: 8 })))).not.toBe(JSON.stringify(a));
    expect(JSON.stringify(planAftermath(input({ region: "kessar" })))).not.toBe(JSON.stringify(a));
    for (const i of a) expect(Number.isFinite(i.x + i.y + i.z + i.yaw + i.r + i.v)).toBe(true);
  });

  it("counts follow the tally and the gore setting, and never exceed the caps", () => {
    const kinds = ["crow", "hat", "crater", "scorch", "crate", "smoke"] as const;
    const huge: AftermathTally = { dead: 999, downed: 999, blasts: 999, fires: 99 };
    for (const k of kinds) {
      expect(aftermathCount(k, huge, "full"), k).toBeLessThanOrEqual(AFTERMATH_MAX[k]);
      expect(aftermathCount(k, { dead: 0, downed: 0, blasts: 0 }, "full"), `${k} none`).toBe(0);
    }
    expect(aftermathCount("crow", TALLY, "full")).toBeGreaterThan(aftermathCount("crow", TALLY, "reduced"));
    expect(aftermathCount("crow", TALLY, "off")).toBe(0);
    // wreckage and weather do not depend on blood
    for (const k of ["hat", "crater", "scorch", "crate", "smoke"] as const) expect(aftermathCount(k, TALLY, "off"), k).toBe(aftermathCount(k, TALLY, "full"));
    const plan = planAftermath(input({ gore: "off" }));
    expect(plan.filter((i) => i.kind === "crow")).toHaveLength(0);
    expect(planAftermath(input({ gore: "full" })).filter((i) => i.kind === "crow").length).toBeGreaterThan(0);
  });

  it("MONOTONE: a bigger tally adds items and never moves one already there; a new casualty site takes slots only where it wins", () => {
    let prev = planAftermath(input({ tally: { dead: 0, downed: 0, blasts: 0 } }));
    expect(prev).toHaveLength(0);
    for (let n = 1; n <= 8; n++) {
      const next = planAftermath(input({ tally: { dead: n, downed: Math.floor(n / 2), blasts: n, fires: n % 3 } }));
      expect(planExtends(prev, next), `tally ${n}`).toBe(true);
      expect(next.length, `tally ${n}`).toBeGreaterThanOrEqual(prev.length);
      prev = next;
    }
    const before = planAftermath(input());
    const after = planAftermath(input({ centres: [...CENTRES, { x: 7, z: -3, kind: "casualty" }] }));
    const moved = before.filter((b) => !after.some((a) => a.id === b.id && a.x === b.x && a.z === b.z)).length;
    expect(moved, "only slots the new site wins change").toBeLessThan(before.length * 0.5);
  });

  it("never inside a solid and never in a door's apron: checked by the level audit itself, over seeds and tallies", () => {
    const site = synthetic();
    let total = 0;
    for (const seed of [1, 7, 42, 1337, 90210]) {
      for (const tally of [{ dead: 3, downed: 1, blasts: 2 }, TALLY, { dead: 20, downed: 9, blasts: 12, fires: 4 }]) {
        // centres right up against the hut and its door, to make the rules bite
        const centres: AftermathCentre[] = [{ x: 3.4, z: 0, kind: "casualty", w: 4 }, { x: 4, z: 0.4, kind: "blast" }, ...CENTRES];
        const plan = planAftermath(input({ seed, tally, centres, site }));
        total += plan.length;
        expect(violations(plan, site), `seed ${seed}`).toEqual([]);
      }
    }
    expect(total).toBeGreaterThan(60);
  });

  it("a wrecked crate keeps off the walked routes; light things may lie on them", () => {
    const site = synthetic();
    const centres: AftermathCentre[] = [{ x: 6, z: 0, kind: "blast" }, { x: 6, z: 2, kind: "casualty" }];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const plan = planAftermath(input({ seed, centres, tally: { dead: 8, downed: 0, blasts: 10 } }));
      for (const c of plan.filter((i) => i.kind === "crate")) {
        const half = AUDIT.pathMin.street / 2;
        expect(Math.abs(c.x - 6), `crate ${c.id} seed ${seed}`).toBeGreaterThan(half * 0.6 + c.r - 1e-6);
      }
    }
  });

  it("a slot with no good spot yields nothing rather than a bad one", () => {
    // every point near the centre is inside a solid: nothing can be placed, and nothing is
    const T = 0.3;
    const big: Obstacle[] = [{ kind: "box", tag: "house", x: 0, z: 0, hx: 40, hz: 40, yaw: 0, y0: -1, y1: 3 }];
    void T;
    const site: AftermathSite = { region: "hollowmere", world: new CollisionWorld(flat, big, 120), doors: [], routes: [] };
    const plan = planAftermath(input({ site, centres: [{ x: 0, z: 0, kind: "casualty" }, { x: 1, z: 1, kind: "blast" }] }));
    expect(plan.filter((i) => i.kind !== "smoke")).toHaveLength(0);
    expect(planAftermath(input({ centres: [] }))).toHaveLength(0);
  });

  it("smoke stands on the craters, no more of it than the caps, and fades with the strength it carries", () => {
    const plan = planAftermath(input());
    const smoke = plan.filter((i) => i.kind === "smoke");
    const craters = plan.filter((i) => i.kind === "crater");
    expect(smoke.length).toBeGreaterThan(0);
    expect(smoke.length).toBeLessThanOrEqual(AFTERMATH_MAX.smoke);
    for (const s of smoke) expect(craters.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 1e-6), "smoke on a crater").toBe(true);
    for (const s of smoke) expect(s.smoulder).toBeGreaterThan(0);
  });
});

describe("the real regions", () => {
  // Package L's adapters (the real worlds, doors and routes of the five regions); read by relative path until the integrator exports them
  it("over every region and the audit's seeds the plan breaks none of the audit's prop rules", async () => {
    type Adapter = (seed: number) => { region: RegionId; world: CollisionWorld; doors: AuditDoor[]; routes: AuditRoute[]; points: { x: number; z: number; mustReach: boolean }[]; spawns: { x: number; z: number }[] };
    const mod = (await import("../../../../../packages/shared/src/levelAuditAdapters.ts")) as unknown as { LEVEL_ADAPTERS: Record<RegionId, Adapter> };
    const adapters = mod.LEVEL_ADAPTERS;
    expect(adapters, "package L's adapters (packages/shared/src/levelAuditAdapters.ts) load").toBeDefined();
    let checked = 0;
    for (const region of Object.keys(adapters) as RegionId[]) {
      for (const seed of [1, 7, 42]) {
        const a = adapters[region](seed);
        const centres: AftermathCentre[] = [];
        a.points.filter((p) => p.mustReach).slice(0, 4).forEach((p, i) => centres.push({ x: p.x, z: p.z, kind: i % 2 === 0 ? "casualty" : "blast" }));
        for (const s of a.spawns.slice(0, 2)) centres.push({ x: s.x, z: s.z, kind: "casualty" });
        const site: AftermathSite = { region, world: a.world, doors: a.doors, routes: a.routes };
        const plan = planAftermath({ region, seed, tally: { dead: 9, downed: 4, blasts: 7, fires: 2 }, centres, gore: "full", site });
        expect(plan.length, `${region} ${seed}`).toBeGreaterThan(0);
        expect(violations(plan, site), `${region} seed ${seed}`).toEqual([]);
        checked += plan.length;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("drawing", () => {
  it("a plan is a handful of instanced meshes: crows, hats, helmets, crates and crater rims; the decal field gets the scorch and the craters once", () => {
    const scene = new Scene();
    const decals = new DecalField(scene, () => 0, "medium", 3);
    const shot = new ShotFx(scene, () => 0);
    const view = new Aftermath(scene, shot, decals, true);
    const plan = planAftermath(input());
    view.show(plan, "full");
    expect(view.current).toBe(plan);
    expect(view.drawCalls).toBeLessThanOrEqual(10);
    const scorch = decals.pool.countOf(DECAL.SCORCH);
    expect(scorch).toBe(plan.filter((i) => i.kind === "crater" || i.kind === "scorch").length);
    // showing the same plan again leaves no second set of marks
    view.show(plan, "full");
    expect(decals.pool.countOf(DECAL.SCORCH)).toBe(scorch);
    // a bigger plan adds only the new items' marks
    const more = planAftermath(input({ tally: { dead: 12, downed: 5, blasts: 8, fires: 2 } }));
    view.show(more, "full");
    expect(decals.pool.countOf(DECAL.SCORCH)).toBe(more.filter((i) => i.kind === "crater" || i.kind === "scorch").length);
    // the craters smoulder: puffs appear while the field updates
    for (let t = 0; t < 2.5; t += 1 / 30) {
      view.update(1 / 30);
      shot.update(1 / 30);
    }
    expect(shot.live.puffs).toBeGreaterThan(0);
    view.dispose();
    decals.dispose();
  });
});
