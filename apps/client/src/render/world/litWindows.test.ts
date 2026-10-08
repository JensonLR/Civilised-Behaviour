import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BufferGeometry, Color, InstancedMesh, Mesh, Raycaster, Scene, Vector3, type Object3D } from "three";
import { PALETTE, createRegionWorld, type RegionId } from "@cb/shared";
import { PRESETS } from "../Stage.ts";
import { createRegionView } from "./regionView.ts";
import { GROUND_MESHES } from "./groundAudit.ts";
import { LIT_SHARE, paneGeometry, setWindowNight, type LitPane } from "./litWindows.ts";
import { windowLight } from "./toon.ts";

/**
 * D-089: the windows of Vesper, Kessar, Highmark and Saltmarket burn at night. Every pane is set in something (its frame or its wall is right behind it, corner to corner:
 * a pane never hangs in the air or overhangs its frame), faces out of its building (the frame is behind it, not in front), and most of it can be seen from outside.
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

interface Pane { c: Vector3; n: Vector3; r: Vector3; up: Vector3; w: number; h: number; lit: boolean }

/** The panes back out of the "windows" mesh a view built (six vertices each): centre, outward normal (from the winding), size, and lit or not. */
function panesOf(m: Mesh): Pane[] {
  const pos = m.geometry.getAttribute("position");
  const lit = m.geometry.getAttribute("aLit");
  const out: Pane[] = [];
  const v = (i: number): Vector3 => new Vector3().fromBufferAttribute(pos, i);
  for (let i = 0; i < pos.count; i += 6) {
    const [a, b, , , c2] = [v(i), v(i + 1), v(i + 2), v(i + 3), v(i + 4)];
    const right = b.clone().sub(a);
    const up = c2.clone().sub(b);
    const n = right.clone().cross(up).normalize();
    out.push({ c: a.clone().add(c2).multiplyScalar(0.5), n, r: right.clone().normalize(), up: up.clone().normalize(), w: right.length(), h: up.length(), lit: lit.getX(i) > 0.5 });
  }
  return out;
}

/** What a pane could be set in or hidden by: the region's solid meshes (not the ground, the ink hulls, the scatter or the windows themselves). */
function solids(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (o as InstancedMesh).isInstancedMesh || o.name === "windows" || o.name.endsWith("_outline") || GROUND_MESHES.has(o.name)) return;
    if (!(m.geometry instanceof BufferGeometry) || !m.geometry.getAttribute("position")) return;
    out.push(m);
  });
  return out;
}

const WINDOWED: readonly RegionId[] = ["saltmarket", "kessar", "highmark", "vesper"];

describe("D-089: lit windows", () => {
  const all: Pane[] = [];
  for (const id of WINDOWED) {
    it(`${id}: every pane is set in its frame, faces out, and can be seen`, () => {
      const world = createRegionWorld(id, 7);
      const view = createRegionView(id, new Scene(), world, PRESETS.medium, sun, 7);
      view.root.updateMatrixWorld(true);
      const win = view.root.getObjectByName("windows") as Mesh | undefined;
      expect(win, `${id} has no windows`).toBeDefined();
      const panes = panesOf(win!);
      expect(panes.length).toBeGreaterThan(0);
      all.push(...panes);
      const hits = solids(view.root);
      const ray = new Raycaster();
      const bad: string[] = [];
      const at = (p: Pane, s: number, t: number): Vector3 => p.c.clone().addScaledVector(p.r, p.w * s).addScaledVector(p.up, p.h * t);
      for (const p of panes) {
        const where = `${p.c.x.toFixed(1)},${p.c.y.toFixed(1)},${p.c.z.toFixed(1)}`;
        expect(Math.abs(p.n.y), `${id} pane at ${where} is not upright`).toBeLessThan(1e-3);
        const samples = [at(p, 0, 0), at(p, -0.45, -0.45), at(p, 0.45, -0.45), at(p, -0.45, 0.45), at(p, 0.45, 0.45)];
        // set in: just behind every sample (against the outward normal) is the frame or the wall it is in
        for (const s of samples) {
          ray.set(s.clone().addScaledVector(p.n, 0.004), p.n.clone().negate());
          ray.far = 0.05;
          if (ray.intersectObjects(hits, false).length === 0) bad.push(`${where}: nothing behind it at ${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)} (hanging, overhanging, or facing in)`);
        }
        // seen: from 1.2 m out, at least three of the five samples are in sight (bars in front of a window are fine; a wall is not)
        let seen = 0;
        for (const s of samples) {
          ray.set(s.clone().addScaledVector(p.n, 1.2), p.n.clone().negate());
          ray.far = 1.2 - 0.002;
          if (ray.intersectObjects(hits, false).length === 0) seen++;
        }
        if (seen < 3) bad.push(`${where}: hidden (${seen} of 5 points in sight)`);
      }
      view.dispose();
      expect(bad, bad.slice(0, 8).join("\n")).toEqual([]);
    }, 120_000);
  }

  it("some burn and some are dark, about the share intended, and the same ones every time", () => {
    const lit = all.filter((p) => p.lit).length;
    expect(all.length).toBeGreaterThan(30);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(all.length);
    expect(Math.abs(lit / all.length - LIT_SHARE)).toBeLessThan(0.2);
    // (a second build lights the same windows: where a pane is decides it)
    const world = createRegionWorld("kessar", 7);
    const twice = [0, 1].map(() => {
      const view = createRegionView("kessar", new Scene(), world, PRESETS.medium, sun, 7);
      const flags = panesOf(view.root.getObjectByName("windows") as Mesh).map((p) => p.lit);
      view.dispose();
      return flags;
    });
    expect(twice[0]).toEqual(twice[1]);
  }, 120_000);

  it("a lit pane is warm with aLit 1, a dark one is dark glass with aLit 0, and nothing sways", () => {
    const panes: LitPane[] = [
      { x: 0, y: 2, z: 0, nx: 0, nz: 1, w: 0.6, h: 1, lit: true },
      { x: 3, y: 2, z: 0, nx: 1, nz: 0, w: 0.6, h: 1, lit: false },
    ];
    const geo = paneGeometry(panes)!;
    expect(geo.getAttribute("position").count).toBe(12);
    const col = geo.getAttribute("color"), aLit = geo.getAttribute("aLit"), sway = geo.getAttribute("aSway");
    for (let i = 0; i < 12; i++) {
      expect(aLit.getX(i)).toBe(i < 6 ? 1 : 0);
      expect(sway.getX(i)).toBe(0);
    }
    expect(col.getX(0)).toBeGreaterThan(col.getZ(0)); // (warm: more red than blue)
    expect(col.getX(6)).toBeCloseTo(new Color(PALETTE.camp.windowDark).r, 5);
    // the winding faces the quad along its normal
    const p = panesOf(new Mesh(geo));
    expect(p[0]!.n.z).toBeCloseTo(1, 5);
    expect(p[1]!.n.x).toBeCloseTo(1, 5);
    expect(paneGeometry([])).toBeUndefined();
  });

  it("burns at night, out by day", () => {
    setWindowNight(0);
    expect(windowLight.value).toBe(0);
    setWindowNight(1);
    expect(windowLight.value).toBeCloseTo(1, 5);
    setWindowNight(0.4);
    expect(windowLight.value).toBeGreaterThan(0);
    expect(windowLight.value).toBeLessThan(1);
  });
});
