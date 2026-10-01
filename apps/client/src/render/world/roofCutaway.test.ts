import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { REGION_IDS, createRegionWorld, highmarkLevel, kessarLevel, saltmarketLevel, vesperLevel, villageLevel, type RegionId } from "@cb/shared";
import { PRESETS } from "../../render/Stage.ts";
import { createRegionView, type RegionView } from "./regionView.ts";
import type { RoofSet } from "./rooms.ts";

/**
 * THE CUTAWAY (D-038, docs/LEVEL_PLAN.md section 4, rule 7): while the local player is inside a room (`roomAt(rooms, x, z, 0.3)`) the view lifts that building's roof so the third-person camera never sits under a
 * ceiling; every other roof stays, and stepping out puts it back. Each region has one `roof:<id>` group per interior and one roof mesh whose index is rewritten.
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

type Cut = RegionView & { roofs?: RoofSet };
const viewOf = (id: RegionId): Cut => createRegionView(id, new Scene(), createRegionWorld(id, 7), PRESETS.medium, sun, 7) as Cut;

describe("the roof over the room the player is in is lifted, and only that one", () => {
  for (const id of REGION_IDS) {
    it(`${id}: every interior has a roof group; entering a room drops its roof and leaving puts it back`, () => {
      const level = LEVELS[id];
      const view = viewOf(id);
      expect(view.setViewer, `${id} has setViewer`).toBeTypeOf("function");
      const roofs = view.roofs!;
      expect(roofs, `${id} has roofs`).toBeDefined();
      // every room's roof exists as a roof:<id> group, and every roof group belongs to a declared building
      const roomIds = level.rooms.map((r) => r.id);
      for (const r of roomIds) expect(view.root.getObjectByName(`roof:${r}`), `roof:${r}`).toBeDefined();
      for (const rid of roofs.ids) expect(level.buildings.some((b) => b.id === rid), `roof:${rid} is a declared building`).toBe(true);
      const all = roofs.drawnTriangles;
      expect(all).toBeGreaterThan(0);
      // a viewer far from every room: nothing is lifted
      view.setViewer!(0, 1000);
      expect(roofs.hidden).toBeUndefined();
      expect(roofs.drawnTriangles).toBe(all);
      for (const room of level.rooms) {
        view.setViewer!(room.x, room.z);
        expect(roofs.hidden, `${room.id}: standing in it`).toBe(room.id);
        expect(roofs.drawnTriangles, `${room.id}: its roof is dropped`).toBeLessThan(all);
        expect(view.root.getObjectByName(`roof:${room.id}`)!.visible).toBe(false);
        // every other roof is still drawn
        for (const other of roofs.ids) if (other !== room.id) expect(view.root.getObjectByName(`roof:${other}`)!.visible, `${other} stays`).toBe(true);
        view.setViewer!(0, 1000);
        expect(roofs.hidden, `${room.id}: leaving it`).toBeUndefined();
        expect(roofs.drawnTriangles).toBe(all);
        expect(view.root.getObjectByName(`roof:${room.id}`)!.visible).toBe(true);
      }
      view.dispose();
    }, 60_000);
  }

  it("the cutaway uses the same rectangle the audit uses (a point 0.3 m outside the wall still lifts it, 0.5 m outside does not)", () => {
    const view = viewOf("saltmarket");
    const room = saltmarketLevel().rooms[0]!;
    const roofs = view.roofs!;
    const out = (d: number): { x: number; z: number } => ({ x: room.x + Math.cos(room.yaw) * (room.hx + d), z: room.z + Math.sin(room.yaw) * (room.hx + d) });
    view.setViewer!(out(0.25).x, out(0.25).z);
    expect(roofs.hidden).toBe(room.id);
    view.setViewer!(out(0.6).x, out(0.6).z);
    expect(roofs.hidden).toBeUndefined();
    view.dispose();
  });
});
