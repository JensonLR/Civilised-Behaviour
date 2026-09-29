import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { CollisionWorld, createArena, createDayState, dayState } from "@cb/shared";
import { MAX_PUSHERS, pushers, worldTime } from "./toon.ts";
import { PRESETS } from "../Stage.ts";
import { WorldView } from "./WorldView.ts";

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
  for (const name of ["low", "medium", "high"] as const) {
    it(`${name}: the whole world is within its draw-call and triangle budget`, () => {
      const view = new WorldView(new Scene(), createArena(7), PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`${name} ${JSON.stringify(view.stats)}\n`);
      // Budget (docs/PERFORMANCE.md): was 45 draws / 280k tris before the environment upgrade added water, ruin, camp life,
      // ambient life and a dozen kinds of ground cover, each ONE instanced draw (+ one hull where it carries ink). Main pass only.
      expect(view.stats.meshes).toBeLessThanOrEqual(name === "low" ? 34 : 60);
      expect(view.stats.triangles).toBeLessThan(name === "low" ? 150_000 : name === "medium" ? 300_000 : 380_000);
      expect(view.stats.meshes).toBeGreaterThan(12);
      view.update(1.5); // animates without throwing or allocating scene objects
      view.dispose();
    });
  }

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
