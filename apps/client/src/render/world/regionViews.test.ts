import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { SALTMARKET_VIEW_BUDGET, VESPER_VIEW_BUDGET, createDayState, createRegionWorld, dayState, regionIsLive, regionLanding, type RegionId } from "@cb/shared";
import { PRESETS } from "../Stage.ts";
import { createRegionView } from "./regionView.ts";
import { SaltmarketView } from "./saltmarket/SaltmarketView.ts";
import { VesperView } from "./vesper/VesperView.ts";

/**
 * D-037 contract through the region factory (packages C3 and D4 may ADD blocks here, never delete a test): Vesper and the Saltmarket build through `createRegionView` into their own view classes, the surface is
 * the one every region has, every preset stays inside its region's `*_VIEW_BUDGET` (meshes and triangles, counted in Node), `dispose` leaves the scene empty, and a LIVE region has real scenery (a stub is empty).
 */
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
const CASES: { id: RegionId; klass: new (...a: never[]) => unknown; budget: typeof VESPER_VIEW_BUDGET }[] = [
  { id: "vesper", klass: VesperView as never, budget: VESPER_VIEW_BUDGET },
  { id: "saltmarket", klass: SaltmarketView as never, budget: SALTMARKET_VIEW_BUDGET },
];

describe("the later regions' views through the factory (D-037)", () => {
  for (const { id, klass, budget } of CASES) {
    const world = createRegionWorld(id, 7);
    for (const name of ["test", "low", "medium", "high"] as const) {
      it(`${id} ${name}: builds through createRegionView, stays inside its budget, runs a day and a walker, and disposes to an empty scene`, () => {
        const scene = new Scene();
        const view = createRegionView(id, scene, world, PRESETS[name], sun, 7);
        expect(view).toBeInstanceOf(klass);
        expect(view.root.name).toBe("world");
        expect(view.stats.meshes).toBeLessThanOrEqual(budget.meshes[name]);
        expect(view.stats.triangles).toBeLessThan(budget.triangles[name]);
        if (regionIsLive(id)) expect(view.stats.meshes).toBeGreaterThan(8);
        const L = regionLanding(id);
        view.update(1.5, { x: L.x, y: 0, z: L.z }, 40);
        view.applyDay(dayState(13, createDayState()));
        view.applyDay(dayState(18.6, createDayState()));
        view.setPushers([{ x: L.x, z: L.z }], 1);
        view.dispose();
        expect(scene.children.length).toBe(0);
      });
    }
  }
});
