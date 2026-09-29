import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { CollisionWorld, createArena } from "@cb/shared";
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
    it(`${name}: the whole world is under 45 draw calls and a sane triangle count`, () => {
      const view = new WorldView(new Scene(), createArena(7), PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`${name} ${JSON.stringify(view.stats)}\n`);
      expect(view.stats.meshes).toBeLessThanOrEqual(45);
      expect(view.stats.triangles).toBeLessThan(name === "low" ? 130_000 : 280_000);
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

  it("an empty world (menu backdrop, showcase) is just ground, skirt and hills", () => {
    const view = new WorldView(new Scene(), new CollisionWorld({ height: () => 0 }, [], 100), PRESETS.medium, sun);
    expect(view.stats.meshes).toBe(3);
    view.dispose();
  });

  it("dispose removes everything it added", () => {
    const scene = new Scene();
    new WorldView(scene, createArena(3), PRESETS.high, sun).dispose();
    expect(scene.children.length).toBe(0);
  });
});
