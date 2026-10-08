import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Color, Scene, Vector3, type HemisphereLight } from "three";
import { PALETTE, REGION_IDS, createRegionWorld, highmarkLevel, kessarLevel, saltmarketLevel, vesperLevel, villageLevel, type RegionId } from "@cb/shared";
import { PRESETS } from "../../render/Stage.ts";
import { createRegionView, type RegionView } from "./regionView.ts";
import { InteriorFill, type RoofSet } from "./rooms.ts";
import { roomFill } from "./toon.ts";

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

describe("a room the viewer stands in is lit, and only that room (Vesper's and the Saltmarket's interiors read as near-black in the stills: D-038 follow-up; Highmark's hall and Hollowmere's at night)", () => {
  const settle = (view: RegionView, from: number): number => {
    let t = from;
    for (let i = 0; i < 40; i++) view.update(t += 0.1);
    return t;
  };
  // the shader's own test of a world point against the fill's box (toon.ts ROOM_BODY), on the CPU
  const inBox = (x: number, y: number, z: number): boolean => {
    const a = roomFill.uRoomA.value, b = roomFill.uRoomB.value;
    const dx = x - a.x, dz = z - a.y;
    return Math.abs(dx * a.z + dz * a.w) < b.x && Math.abs(-dx * a.w + dz * a.z) < b.y && y > b.z && y < b.w;
  };
  // the fill's sky colour per region (a palette colour, not a literal). Kessar has none: its one room, the toll booth, is open to the sky and reads under its own lamp at night
  const SKY: Partial<Record<RegionId, number>> = { vesper: PALETTE.vesper.companyCream, saltmarket: PALETTE.saltmarket.salt, highmark: PALETTE.highmark.chalk, hollowmere: PALETTE.world.vlPlaster };
  for (const id of REGION_IDS) {
    const sky = SKY[id];
    it(`${id}: ${sky === undefined ? "no fill" : "a warm fill in the region's own palette is off outside a room, comes up inside every room over its floor and nowhere outside its walls, and goes out again"}`, () => {
      const view = viewOf(id);
      const world = createRegionWorld(id, 7);
      // (no light for the whole region: a hemisphere light lit the gorge like day at night when the viewer stepped into a room)
      let hemis = 0;
      view.root.traverse((o) => void ((o as HemisphereLight).isHemisphereLight && hemis++));
      expect(hemis).toBe(0);
      let t = settle(view, 0);
      expect(roomFill.uRoomK.value, "outside: nothing").toBe(0);
      expect(LEVELS[id].rooms.length).toBeGreaterThan(0);
      for (const room of LEVELS[id].rooms) {
        view.setViewer!(room.x, room.z);
        t = settle(view, t);
        if (sky === undefined) {
          expect(roomFill.uRoomK.value, `${room.id}: no fill`).toBe(0);
          continue;
        }
        expect(roomFill.uRoomK.value, `${room.id}: inside, readable`).toBeGreaterThan(0.8);
        expect(roomFill.uRoomSky.value.getHex()).toBe(new Color(sky).getHex());
        const b = LEVELS[id].buildings.find((q) => q.id === room.id)!;
        const floorY = world.terrainHeight(room.x, room.z) + b.floor;
        const c = Math.cos(room.yaw), sn = Math.sin(room.yaw);
        // (a point at local (lx, lz) of the rect, as `roomAt` reads one)
        const at = (lx: number, lz: number): [number, number] => [room.x + lx * c - lz * sn, room.z + lx * sn + lz * c];
        for (const [lx, lz] of [[0, 0], [room.hx - 0.05, room.hz - 0.05], [-(room.hx - 0.05), room.hz - 0.05]] as const) {
          const [x, z] = at(lx, lz);
          expect(inBox(x, floorY + 0.01, z), `${room.id}: the floor at ${lx.toFixed(1)},${lz.toFixed(1)} is lit`).toBe(true);
          expect(inBox(x, floorY + 1.5, z), `${room.id}: the room at head height is lit`).toBe(true);
        }
        // the inner face of a wall is lit; its outer face (a wall's thickness out) and the ground beyond are not
        const [ix, iz] = at(room.hx, 0);
        expect(inBox(ix, floorY + 1, iz), `${room.id}: the inner face of the wall`).toBe(true);
        for (const out of [0.25, 1.5, 4]) {
          const [ox, oz] = at(room.hx + out, 0);
          expect(inBox(ox, floorY + 1, oz), `${room.id}: ${out} m outside its wall`).toBe(false);
          const [px, pz] = at(0, room.hz + out);
          expect(inBox(px, floorY + 1, pz), `${room.id}: ${out} m outside its side wall`).toBe(false);
        }
        view.setViewer!(0, 1000);
        t = settle(view, t);
        expect(roomFill.uRoomK.value, `${room.id}: outside again`).toBe(0);
      }
      view.dispose();
      expect(roomFill.uRoomK.value, "a disposed view leaves no fill burning").toBe(0);
    }, 60_000);
  }

  it("InteriorFill eases (never snaps), reaches its peak, and a long frame cannot jump it", () => {
    const f = new InteriorFill(0xffffff, 0x808080, 2);
    const room = { id: "r", x: 3, z: 4, hx: 2, hz: 1.5, yaw: 0.5 };
    f.update(0);
    expect(f.strength).toBe(0);
    f.setRoom(room, 0, 3);
    f.update(0.016);
    const first = f.strength;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5); // (one 16 ms frame: a fraction of the way)
    expect(roomFill.uRoomK.value).toBe(first);
    f.update(5); // a 5 s hitch is clamped to a quarter second
    expect(f.strength).toBeGreaterThan(first);
    expect(f.strength).toBeLessThan(2);
    for (let t = 5; t < 8; t += 0.05) f.update(t);
    expect(f.strength).toBe(2);
    expect(f.amount).toBe(1);
    f.setRoom(undefined);
    f.update(8.016);
    expect(roomFill.uRoomA.value.x, "the box is kept while the fill eases out").toBe(3);
    for (let t = 8; t < 11; t += 0.05) f.update(t);
    expect(f.strength).toBe(0);
    expect(roomFill.uRoomK.value).toBe(0);
  });
});
