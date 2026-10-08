import { BufferAttribute, BufferGeometry, Color, Mesh, type Material, type Object3D } from "three";
import { PALETTE, hash3 } from "@cb/shared";
import { blend, type Kit } from "./kit.ts";
import { clothBasicMaterial, windowLight } from "./toon.ts";

const C = PALETTE.camp;

/** A window pane in world space: its centre, the way it faces (outward, unit), its size, and whether someone is home to light it at night. */
export interface LitPane {
  x: number; y: number; z: number;
  nx: number; nz: number;
  w: number; h: number;
  lit: boolean;
}

/** About this many windows burn at night; the rest are dark (somebody is out, or saving oil). */
export const LIT_SHARE = 0.72;
/** How far proud of the frame a pane sits (metres): never coplanar with what it is set in. */
const PROUD = 0.012;

/**
 * D-089: a pane where a structure draws a window, collected through the kit that drew it (`k`'s base is the building's): `x, y, z` in the building's frame, the pane facing
 * along local `side` z (+1 / -1). Whether it is lit is a hash of where it is (`seed`), so the same windows burn every night.
 */
export function pane(out: LitPane[], k: Kit, x: number, y: number, z: number, side: 1 | -1, w: number, h: number, seed: number): void {
  const a = k.worldPoint(x, y, z + side * PROUD);
  const b = k.worldPoint(x, y, z + side * (1 + PROUD));
  const nx = b[0] - a[0], nz = b[2] - a[2];
  const l = Math.hypot(nx, nz) || 1;
  const lit = hash3(seed >>> 0, Math.round(a[0] * 10), Math.round(a[2] * 10)) / 4294967296 < LIT_SHARE;
  out.push({ x: a[0], y: a[1], z: a[2], nx: nx / l, nz: nz / l, w, h, lit });
}

const tmp = new Color();

/**
 * The panes as one geometry for the lantern-glass material (`clothBasicMaterial`): a quad each, facing out. A lit pane is warm (brighter at its middle) with `aLit = 1`, so the
 * night level (`windowLight`) burns it at night and dims it to dark glass by day; an unlit one is dark glass with `aLit = 0`. `aSway` is 0 (windows do not move in the wind).
 */
export function paneGeometry(panes: readonly LitPane[]): BufferGeometry | undefined {
  if (panes.length === 0) return undefined;
  const pos = new Float32Array(panes.length * 18);
  const col = new Float32Array(panes.length * 18);
  panes.forEach((p, i) => {
    // the pane's right-hand direction as seen from outside (so the quad winds counter-clockwise towards the viewer: its face is the outward one), and its corners
    const rx = p.nz, rz = -p.nx;
    const hw = p.w / 2, hh = p.h / 2;
    const corner = (s: number, t: number): [number, number, number] => [p.x + rx * hw * s, p.y + hh * t, p.z + rz * hw * s];
    const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)];
    quad.forEach((v, j) => {
      pos.set(v, i * 18 + j * 3);
      // (a lit pane is brighter at the middle, where the lamp is)
      if (p.lit) blend(tmp, C.glowLantern, C.flameCore, v[1] > p.y ? 0.25 : 0.55);
      else tmp.setHex(C.windowDark);
      col.set([tmp.r, tmp.g, tmp.b], i * 18 + j * 3);
    });
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.setAttribute("aLit", new BufferAttribute(new Float32Array(panes.length * 6).map((_, v) => (panes[Math.floor(v / 6)]!.lit ? 1 : 0)), 1));
  g.setAttribute("aSway", new BufferAttribute(new Float32Array(panes.length * 6), 1));
  g.computeVertexNormals();
  return g;
}

/** The night level a region's lamps are at (0 by day, 1 lit), as the windows burn: never quite black by day (the glass still reads as glass). */
export function setWindowNight(lamp: number): void {
  const t = Math.min(1, Math.max(0, (lamp - 0.1) / 0.6));
  windowLight.value = 0.04 + 0.96 * t * t * (3 - 2 * t);
}

/** The panes as a mesh under `root` ("windows"), its geometry and material handed to `track` for disposal; nothing when there are none. A region view calls this once. */
export function addWindows(root: Object3D, panes: readonly LitPane[], track: <T extends { dispose(): void }>(x: T) => T): Mesh | undefined {
  const g = paneGeometry(panes);
  if (!g) return undefined;
  const m = new Mesh(track(g), track(clothBasicMaterial() as Material));
  m.name = "windows";
  root.add(m);
  return m;
}
