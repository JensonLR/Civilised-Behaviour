import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Group, Scene, Vector3 } from "three";
import { REGION_IDS, createRegionWorld, highmarkLevel, kessarLevel, saltmarketLevel, vesperLevel, villageLevel, type RegionId } from "@cb/shared";
import { PRESETS } from "../../render/Stage.ts";
import { createRegionView, type RegionView } from "./regionView.ts";
import type { DoorMark } from "./rooms.ts";

/**
 * THE DOOR LAW, in the view (D-038, docs/LEVEL_PLAN.md section 4): "every door the view draws is one of the five kinds, declared in the plan, and the collision world agrees with it". The view hangs one `door:<id>`
 * group (userData `{ doorId, leads, leaf }`) on every door its drawing code drew; this counts them against the plan's declared doors: the same ids, none undeclared, none missing, every `sealed` door drawn
 * without a leaf, every `interior` door drawn with one, every passage open.
 */

const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k === "fillText" ? (): void => undefined : k === "measureText" ? (text: string): { width: number } => ({ width: text.length * 14 }) : k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();
const LEVELS = { hollowmere: villageLevel(), kessar: kessarLevel(), highmark: highmarkLevel(), vesper: vesperLevel(), saltmarket: saltmarketLevel() } as const;

const viewOf = (id: RegionId): RegionView & { doorMarks: readonly DoorMark[] } => createRegionView(id, new Scene(), createRegionWorld(id, 7), PRESETS.medium, sun, 7) as RegionView & { doorMarks: readonly DoorMark[] };

describe("the doors a view draws are exactly the doors the plan declares", () => {
  for (const id of REGION_IDS) {
    it(`${id}: one door group per declared door, with the declared kind, none undeclared`, () => {
      const view = viewOf(id);
      const groups: Group[] = [];
      view.root.traverse((o) => {
        if (o.name.startsWith("door:")) groups.push(o as Group);
      });
      const declared = LEVELS[id].doors;
      const drawn = groups.map((o) => o.userData.doorId as string).sort();
      expect(drawn, `${id} door groups`).toEqual(declared.map((d) => d.id).sort());
      for (const d of declared) {
        const grp = groups.find((o) => o.userData.doorId === d.id)!;
        expect(grp.userData.leads, `${d.id} kind`).toBe(d.leads);
        // the group stands on the declared threshold (the drawing and the collision plan agree on where the door is), facing the declared way
        expect(Math.hypot(grp.position.x - d.x, grp.position.z - d.z), `${d.id} position`).toBeLessThan(0.15);
        expect(Math.cos(-grp.rotation.y) * Math.cos(d.yaw) + Math.sin(-grp.rotation.y) * Math.sin(d.yaw), `${d.id} facing`).toBeGreaterThan(0.99);
        expect(grp.userData.width, `${d.id} width`).toBeGreaterThanOrEqual(d.width - 1e-6);
      }
      view.dispose();
    }, 60_000);

    it(`${id}: a sealed door has no leaf, an interior door has one, a passage is open`, () => {
      const view = viewOf(id);
      const groups: Group[] = [];
      view.root.traverse((o) => {
        if (o.name.startsWith("door:")) groups.push(o as Group);
      });
      for (const grp of groups) {
        const leads = grp.userData.leads as string;
        expect(grp.userData.leaf, `${grp.userData.doorId} (${leads})`).toBe(leads === "interior");
      }
      view.dispose();
    }, 60_000);
  }

  it("the declared doors are of the five kinds only (interior, passage, sealed): there is no sixth", () => {
    for (const id of REGION_IDS) for (const d of LEVELS[id].doors) expect(["interior", "passage", "sealed"], `${id} ${d.id}`).toContain(d.leads);
  });

  it("every building of a region is one of the six kinds and every sealed one carries its notice", () => {
    for (const id of REGION_IDS) {
      for (const b of LEVELS[id].buildings) {
        expect(["interior", "passage", "open-front", "sealed", "solid", "tent"], `${id} ${b.id}`).toContain(b.kind);
        if (b.kind === "sealed") expect(b.sign, `${id} ${b.id} needs a notice`).toBeTruthy();
        if (b.kind === "solid" || b.kind === "tent" || b.kind === "open-front") expect(b.door, `${id} ${b.id} has no door`).toBe(0);
      }
    }
  });
});
