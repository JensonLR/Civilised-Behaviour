import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Scene, Vector3, type Object3D } from "three";
import { FIRE, FireGrid, createRegionWorld } from "@cb/shared";
import { FireView } from "./FireView.ts";
import { scorchPlants, SCORCH_PLANTS } from "./world/scorchPlants.ts";

/** D-103: the client draws the server's fire from its two strings: tongues on every burning cell, scorch on burnt ground, plants burnt to stubble, people alight. */

const world = createRegionWorld("highmark", 7);

/** A fire a few seconds old on the server's grid, and its two strings. */
function serverFire(steps: number): { g: FireGrid; burning: string; scorch: string } {
  const g = new FireGrid(world, "highmark", 7);
  let best = -1;
  for (let c = g.w * 5; c < g.cells - g.w * 5 && best < 0; c += 13) if (g.fuelOf(c) > 0.7 && g.fuelOf(c + 1) > 0.5 && g.fuelOf(c + g.w) > 0.5) best = c;
  g.igniteCell(best);
  for (let t = 0; t < steps; t++) g.step(t, { windX: 1, windZ: 0, wind: 0.4, rain: 0, wet: 0 });
  return { g, burning: g.encodeBurning(), scorch: g.encodeBurnt() };
}

const meshes = (scene: Scene): Record<string, InstancedMesh> => {
  const out: Record<string, InstancedMesh> = {};
  scene.traverse((o: Object3D) => {
    if (o instanceof InstancedMesh) out[o.name] = o;
  });
  return out;
};

describe("D-103: the fire as the clients draw it", () => {
  it("three tongues and a glow on every burning cell; the scorch where it burnt; the plants told", () => {
    const scene = new Scene();
    const view = new FireView(scene);
    view.setRegion("highmark", world, 7);
    const { g, burning, scorch } = serverFire(80);
    expect(g.burning).toBeGreaterThan(0);
    expect(g.burntCount).toBeGreaterThan(0);
    let told = 0;
    view.onScorch = () => void told++;
    view.sync(burning, scorch);
    view.update(0.016, 10_000);
    const m = meshes(scene);
    expect(view.burningCells).toBe(g.burning);
    expect(m.fire_outer!.count).toBe(g.burning * 3);
    expect(m.fire_core!.count).toBe(g.burning * 3);
    expect(m.fire_glow!.count).toBe(g.burning);
    expect(m.fire_scorch!.count).toBe(g.burntCount);
    expect(told).toBeGreaterThan(0);
    // the scorch sits on the ground, not under it or in the air
    const at = new Vector3();
    const mat = new Matrix4();
    for (let i = 0; i < m.fire_scorch!.count; i += 7) {
      m.fire_scorch!.getMatrixAt(i, mat);
      at.setFromMatrixPosition(mat);
      expect(at.y - world.terrainHeight(at.x, at.z)).toBeGreaterThan(0);
      expect(at.y - world.terrainHeight(at.x, at.z)).toBeLessThan(0.1);
    }
    // the same strings again change nothing; the fire going out leaves the scorch
    view.sync(burning, scorch);
    expect(m.fire_scorch!.count).toBe(g.burntCount);
    view.sync("", scorch);
    view.update(0.016, 10_016);
    expect(m.fire_outer!.count).toBe(0);
    expect(m.fire_scorch!.count).toBeGreaterThanOrEqual(g.burntCount);
    const near = view.nearest(0, 0);
    expect(near.n).toBe(0);
  });

  it("smoke and embers rise from it and drift, within their pools", () => {
    const scene = new Scene();
    const view = new FireView(scene);
    view.setRegion("highmark", world, 7);
    const { burning } = serverFire(60);
    view.sync(burning, "");
    for (let i = 0; i < 120; i++) view.update(0.05, 20_000 + i * 50);
    const m = meshes(scene);
    expect(m.fire_smoke!.count).toBeGreaterThan(10);
    expect(m.fire_embers!.count).toBeGreaterThan(5);
    expect(m.fire_smoke!.count).toBeLessThanOrEqual(m.fire_smoke!.instanceMatrix.count);
  });

  it("people alight burn with tongues up their bodies, and count for the crackle", () => {
    const scene = new Scene();
    const view = new FireView(scene);
    view.setRegion("highmark", world, 7);
    view.setPeople([{ x: 3, y: world.terrainHeight(3, 4), z: 4, left: 4, seed: 9 }], 1);
    view.update(0.016, 0);
    const m = meshes(scene);
    expect(m.fire_outer!.count).toBe(5);
    expect(view.nearest(3, 4)).toEqual({ d: 0, n: 1 });
  });

  it("a new region forgets the old scorch", () => {
    const scene = new Scene();
    const view = new FireView(scene);
    view.setRegion("highmark", world, 7);
    const { scorch } = serverFire(80);
    view.sync("", scorch);
    expect(meshes(scene).fire_scorch!.count).toBeGreaterThan(0);
    view.setRegion("hollowmere", createRegionWorld("hollowmere", 7), 7);
    expect(meshes(scene).fire_scorch!.count).toBe(0);
    view.dispose();
    expect(Object.keys(meshes(scene))).toEqual([]);
  });
});

describe("D-103: plants on scorched ground burn to stubble", () => {
  it("grass on burnt ground is cut down and darkened, once; rocks are not plants", () => {
    const root = new Group();
    const make = (name: string): InstancedMesh => {
      const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 4);
      mesh.name = name;
      for (let i = 0; i < 4; i++) {
        mesh.setMatrixAt(i, new Matrix4().makeTranslation(i * 10, 0, 0));
        mesh.setColorAt(i, new Color(1, 1, 1));
      }
      root.add(mesh);
      return mesh;
    };
    const grass = make("grass");
    const rock = make("rock");
    expect(SCORCH_PLANTS.has("grass")).toBe(true);
    expect(SCORCH_PLANTS.has("rock")).toBe(false);
    const burnt = (x: number): boolean => x < 15; // (the first two of each row)
    expect(scorchPlants(root, burnt)).toBe(2);
    const mat = new Matrix4();
    grass.getMatrixAt(0, mat);
    const s = new Vector3().setFromMatrixScale(mat);
    expect(s.y).toBeCloseTo(0.2, 5);
    const c = new Color();
    grass.getColorAt(0, c);
    expect(c.r).toBeLessThan(0.3);
    grass.getMatrixAt(3, mat);
    expect(new Vector3().setFromMatrixScale(mat).y).toBeCloseTo(1, 5);
    rock.getMatrixAt(0, mat);
    expect(new Vector3().setFromMatrixScale(mat).y).toBeCloseTo(1, 5);
    // again: nothing new burns twice
    expect(scorchPlants(root, burnt)).toBe(0);
    expect(FIRE.cell).toBe(2);
  });
});
