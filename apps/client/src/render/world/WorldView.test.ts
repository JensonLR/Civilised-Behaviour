import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Scene, Vector3 } from "three";
import { CollisionWorld, applyOutcome, createArena, createDayState, dayState, historyPieces, newCampaign, newSettlements } from "@cb/shared";
import { MAX_PUSHERS, fireLight, pushers, worldTime } from "./toon.ts";
import { PRESETS } from "../Stage.ts";
import { WorldView } from "./WorldView.ts";
import { atmoUniforms } from "./atmosphere.ts";

// The camp's signboard atlas is drawn on a canvas; the unit-test environment has no DOM, so give it a recording stub.
const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })), set: (t, k, v) => ((t[k as string] = v), true) });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();

describe("WorldView budget", () => {
  for (const name of ["test", "low", "medium", "high"] as const) {
    it(`${name}: the whole world is within its draw-call and triangle budget`, () => {
      const view = new WorldView(new Scene(), createArena(7), PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`${name} ${JSON.stringify(view.stats)}\n`);
      // Budget (docs/PERFORMANCE.md): was 45 draws / 280k tris before the environment upgrade added water, ruin, camp life,
      // ambient life and a dozen kinds of ground cover, each ONE instanced draw (+ one hull where it carries ink). Main pass only.
      // (2026-09-30, the settlement: 34 / 60 -> 37 / 66. The village is 2 draws (solid + hull), the crags 2, the canopy shafts 1, the wildlife 2 (the farm animals
      // and the wild ones now share one collapsing mesh per group: 4 draws, as before). Measured: low 36, medium 64, high 64. Everything else that is new rides
      // inside an existing mesh: the HQ marquee, the windmill and the snow range (hills), the lit windows (lantern glass), the dragonflies (butterflies),
      // the swallows (birds).)
      // (2026-10-01, D-035: the finger-posts of the HQ route are 2 draws (the posts and boards, the lettering): 28 / 37 / 66 -> 30 / 39 / 68. HQ's history pieces are 1-2 more
      // when the campaign has any: asserted separately below.)
      // (2026-10-10, D-117: the village's fields and orchard are 3 draws on medium and high (the barley, instanced because it bends with the grass, and one merged solid
      // with its hull for every stook, haycock, scarecrow, ridge, fruit tree, hive and windfall), 2 on low (no hull), 1 on test (no barley): 30 / 39 / 68 -> 31 / 41 / 71.)
      expect(view.stats.meshes).toBeLessThanOrEqual(name === "test" ? 31 : name === "low" ? 41 : 71);
      // (2026-09-30: 150k / 300k / 380k -> 160k / 330k / 440k. The Observatory is now a walk-in ruin of real stone courses with a ribbed copper dome
      // (+8k), the hill tree line has proper lumpy crowns instead of paper hexagons (+~15k medium), the camp cloth is its own mesh, and rain is one
      // pooled quad set (+4k medium, 7k high, vertex-culled when it is dry). See docs/PERFORMANCE.md.)
      // (2026-09-30, the settlement: 160k / 330k / 440k -> 195k / 430k / 540k. Measured: 180k / 420k / 525k. Village 41k + 14k hull, crags 9k, the animals 30k
      // (a collapsed species still counts here, though its triangles are dropped at primitive assembly), a doubled ground detail pass costs shader time not
      // triangles. See docs/PERFORMANCE.md.)
      // (2026-09-30, performance pass: low's trees are built at the coarse level of detail (20-face crown lobes: half the triangles, in the shadow pass too), 195k -> 160k
      // (measured 153k); the test preset (software rasteriser) has no ground cover, tree line or bushes and thinner trees: measured 106k.)
      // (2026-10-10, D-117: the fields and orchard measured +8k low (coarse solid 5.9k, barley 6.9k, less the dressing they cleared), +16k medium and high (barley 15.5k,
      // solid 10.3k + 4k hull): 160k / 430k / 540k -> 170k / 445k / 550k. Measured 163k / 439k / 544k.)
      expect(view.stats.triangles).toBeLessThan(name === "test" ? 115_000 : name === "low" ? 170_000 : name === "medium" ? 445_000 : 550_000);
      expect(view.stats.meshes).toBeGreaterThan(12);
      view.update(1.5); // animates without throwing or allocating scene objects
      view.dispose();
    });
  }

  it("the test preset builds no people, no grass and no ambient life, and keeps the camp, the village and the ruin", () => {
    const scene = new Scene();
    const view = new WorldView(scene, createArena(7), PRESETS.test, sun);
    for (const part of ["grass", "daisies", "ferns", "bush", "hill-rounds", "hill-conifers"]) expect(view.root.getObjectByName(part), part).toBeUndefined();
    for (const part of ["terrain", "hills", "camp", "village", "ruin", "water"]) expect(view.root.getObjectByName(part), part).toBeDefined();
    expect(view.folkView).toBeUndefined();
    view.update(1, { x: 0, y: 0, z: 0 }); // (no villagers to update)
    view.dispose();
  });

  it("outlines follow the preset: none on low, one hull per solid set on medium and high", () => {
    const hulls = (name: "low" | "medium"): number => {
      const scene = new Scene();
      const view = new WorldView(scene, createArena(7), PRESETS[name], sun);
      let n = 0;
      scene.traverse((o) => o.name.endsWith("_outline") && n++);
      view.dispose();
      return n;
    };
    expect(hulls("low")).toBe(0);
    expect(hulls("medium")).toBeGreaterThanOrEqual(6);
  });

  it("an empty world (menu backdrop, showcase) is just ground, skirt, hills and their tree line", () => {
    const view = new WorldView(new Scene(), new CollisionWorld({ height: () => 0 }, [], 100), PRESETS.medium, sun);
    expect(view.stats.meshes).toBe(5);
    view.dispose();
  });

  it("dispose removes everything it added", () => {
    const scene = new Scene();
    new WorldView(scene, createArena(3), PRESETS.high, sun).dispose();
    expect(scene.children.length).toBe(0);
  });

  it("walkers bend the grass: up to four pushers, written in place (no allocation), extras cleared", () => {
    const view = new WorldView(new Scene(), createArena(7), PRESETS.medium, sun);
    const objects = pushers.value.slice();
    view.setPushers([{ x: 1, z: 2 }, { x: -3, z: 4 }]);
    expect(pushers.value.map((v) => v.w)).toEqual([1, 1, 0, 0]);
    expect([pushers.value[0]!.x, pushers.value[0]!.y, pushers.value[1]!.x, pushers.value[1]!.y]).toEqual([1, 2, -3, 4]);
    view.setPushers([{ x: 9, z: 9 }], 0);
    expect(pushers.value.every((v) => v.w === 0)).toBe(true);
    view.setPushers(Array.from({ length: 9 }, (_, i) => ({ x: i, z: i })));
    expect(pushers.value.filter((v) => v.w > 0).length).toBe(MAX_PUSHERS);
    expect(pushers.value.every((v, i) => v === objects[i])).toBe(true); // same Vector4 objects: nothing was allocated
    view.setPushers([], 0);
    view.dispose();
  });

  it("lights every hour of the day without throwing, and the campfire glows stronger at dusk than at noon", () => {
    const view = new WorldView(new Scene(), createArena(7), PRESETS.medium, sun);
    const d = createDayState();
    const glow = (h: number): number => {
      view.applyDay(dayState(h, d));
      view.update(1);
      const s = view.root.getObjectByName("fire-glow") as unknown as { material: { opacity: number } };
      return s.material.opacity;
    };
    for (let h = 0; h < 24; h += 0.5) expect(Number.isFinite(glow(h))).toBe(true);
    expect(glow(19.5)).toBeGreaterThan(glow(13) + 0.2);
    expect(worldTime.value).toBe(1);
    view.dispose();
  });
});

describe("the campfire in the rain", () => {
  it("a downpour beats it down: the flame lower, the glow and the light on the camp dimmer, and it never goes out", () => {
    const view = new WorldView(new Scene(), createArena(7), PRESETS.medium, sun);
    const d = createDayState();
    const look = (rain: number): { h: number; glow: number; light: number } => {
      view.applyDay({ ...dayState(20, d), rain });
      atmoUniforms.uRain.value = rain; // (the Stage sets it from the weather each frame)
      view.update(3.3);
      const flame = view.root.getObjectByName("flame")!;
      const glow = view.root.getObjectByName("fire-glow") as unknown as { material: { opacity: number } };
      return { h: flame.scale.y, glow: glow.material.opacity, light: fireLight.uFireI.value };
    };
    const dry = look(0);
    const wet = look(1);
    expect(wet.h).toBeLessThan(dry.h * 0.8);
    expect(wet.glow).toBeLessThan(dry.glow * 0.8);
    expect(wet.light).toBeLessThan(dry.light * 0.8);
    expect(wet.h).toBeGreaterThan(0.4);
    expect(wet.glow).toBeGreaterThan(0.1);
    atmoUniforms.uRain.value = 0;
    view.dispose();
  });
});

describe("three.js warnings", () => {
  it("building, animating and disposing the world on every preset logs nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const name of ["low", "medium", "high"] as const) {
        const view = new WorldView(new Scene(), createArena(7), PRESETS[name], sun);
        view.update(2);
        view.dispose();
      }
      new WorldView(new Scene(), new CollisionWorld({ height: () => 0 }, [], 100), PRESETS.medium, sun).dispose();
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
      expect(error.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  }, 30_000); // (CPU-bound: the world built at every preset; 2.3 s alone, over 5 s under load. A time limit, not a budget.)

  it("HQ history (D-035) is one merged solid and its ink hull: at most two more draws, and none when the campaign has nothing to show", () => {
    const view = new WorldView(new Scene(), createArena(7), PRESETS.medium, sun);
    const before = view.stats.meshes;
    const camp = newCampaign(3);
    let c = camp;
    for (const r of ["forced", "sabotaged", "seized", "rescued", "paid", "mediated"] as const) c = applyOutcome(c, { scenario: "secure_crossing", resolution: r, toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    const pieces = historyPieces(c, newSettlements());
    expect(pieces.length).toBeGreaterThan(3);
    view.applyHistory(pieces);
    let draws = 0;
    view.root.traverse((o) => {
      if (o.name.startsWith("hq-history") && (o as { isMesh?: boolean }).isMesh) draws++;
    });
    expect(draws).toBeLessThanOrEqual(2);
    expect(draws).toBeGreaterThan(0);
    view.applyHistory([]); // takes everything down and frees it
    let left = 0;
    view.root.traverse((o) => {
      if (o.name.startsWith("hq-history") && (o as { isMesh?: boolean }).isMesh) left++;
    });
    expect(left).toBe(0);
    expect(before).toBeLessThanOrEqual(71);
    view.dispose();
  });
});
