import { BufferGeometry, Group, Mesh, MeshToonMaterial } from "three";
import { PALETTE } from "@cb/shared";
import { BLANKET_DYES } from "../horse.ts";
import { outlineMaterial, sharedToonRamp } from "./outline.ts";
import { PartBuilder } from "./parts.ts";

/**
 * The expedition wagon: a one-axle cart (the server trails it with `trailStep`, shared/mount.ts). Frame: -Z is forward (toward the horse), +X right, origin on the axle at ground
 * level, like the horse's. Numbers mirror `WAGON` in shared/mount.ts (a test pins them): the deck is 0.8 m up, four crate bays on it, two body bays on the roof rack at 1.7 m, the
 * tongue ends 2.6 m ahead of the axle at the hitch. Hooped wheels turn with the distance travelled (`roll`). Cargo crates are drawn per bay for the CONVOY wagon's abstract cargo
 * (`setCargo(n)` fills bays 0..n-1); crates a player loads are real props the server holds at the bays, drawn by the prop views.
 * Vertex colours from palette entries only, toon ramp, ink hull; two wheel meshes, one body mesh, up to four crates sharing one geometry.
 */

export interface WagonRig {
  root: Group;
  /** Rotate each by `roll(distance)`; they are children of `root`. */
  wheelL: Group;
  wheelR: Group;
  readonly meshCount: number;
  readonly triangles: number;
  /** Draw the first `n` (0..4) bays' crates. */
  setCargo(n: number): void;
  /** Turns the wheels to match a total distance travelled (m). */
  roll(distance: number): void;
  setOutline(on: boolean): void;
  dispose(): void;
}

export interface WagonBuildOptions {
  /** Index into the cloth dyes: the side panels and the trim (the Society's wagon and the Syndicate's wear different livery). */
  coat?: number;
  /** Crates shown to begin with. */
  cargo?: number;
  outline?: boolean;
}

/** Wheel radius (m): `WAGON.wheelRadius`. */
const WHEEL_R = 0.55;
const AXLE_Y = 0.55;
/** Frame numbers shared with shared/mount.ts WAGON (a test compares them). */
export const WAGON_FRAME = { deck: 0.8, rack: 1.7, hitchZ: -2.6, wheelRadius: WHEEL_R, bayY: 1.1, bays: [[-0.42, -0.55], [0.42, -0.55], [-0.42, 0.55], [0.42, 0.55]] as const } as const;

let material: MeshToonMaterial | undefined;
const wagonMaterial = (): MeshToonMaterial => (material ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }));

function buildBed(trim: number): BufferGeometry | undefined {
  const b = new PartBuilder();
  const wood = PALETTE.camp.cartWood;
  const dark = PALETTE.camp.strap;
  // deck, boards and posts
  b.box(1.78, 0.07, 2.75, wood, [0, 0.765, 0.2]);
  for (const s of [-1, 1]) {
    b.box(0.05, 0.34, 2.75, trim, [s * 0.885, 0.97, 0.2]); // side boards, in the livery
    b.box(0.07, 0.07, 2.75, dark, [s * 0.885, 1.16, 0.2]);
  }
  b.box(1.78, 0.34, 0.05, wood, [0, 0.97, -1.175]); // front board
  b.box(1.78, 0.2, 0.05, wood, [0, 0.9, 1.575]); // tailboard
  // four posts carry the roof rack
  const px = 0.885;
  for (const sx of [-1, 1]) for (const sz of [-1.12, 1.52]) b.box(0.07, 0.95, 0.07, dark, [sx * px, 1.2, sz]);
  for (const sx of [-1, 1]) b.box(0.06, 0.06, 2.75, dark, [sx * px, 1.69, 0.2]);
  for (let i = 0; i < 6; i++) b.box(1.82, 0.04, 0.07, wood, [0, 1.7, -1.0 + i * 0.5]);
  for (const sx of [-0.42, 0.42]) b.box(0.05, 0.03, 2.7, dark, [sx, 1.73, 0.2]); // the lashing rails the casualties are strapped to
  // axle and its brackets
  b.cylinder(0.05, 0.05, 2.0, dark, [0, AXLE_Y, 0], [0, 0, Math.PI / 2]);
  b.box(0.12, 0.2, 0.28, dark, [0, 0.68, 0]);
  // tongue and singletree
  const hitch = WAGON_FRAME.hitchZ;
  b.box(0.1, 0.08, 1.5, wood, [0, 0.74, (hitch - 1.175) / 2 + 0.05]);
  b.box(0.06, 0.06, 0.06, dark, [0, 0.74, hitch]);
  b.box(0.7, 0.06, 0.06, dark, [0, 0.74, hitch], [0, 0, 0]);
  for (const s of [-1, 1]) b.sphere(0.04, PALETTE.weapons.brass, [s * 0.35, 0.74, hitch]);
  // a rear prop, for when the horse is away
  b.box(0.06, 0.34, 0.06, wood, [0, 0.58, 1.55], [0.3, 0, 0]);
  // a lantern, because the Society does not travel in the dark: it is only inconvenienced by it
  b.box(0.12, 0.16, 0.12, PALETTE.weapons.brass, [-0.9, 1.5, -1.12]);
  // the tilt, furled: the canvas cover rolled tight and lashed along each side of the rack, lying ON the side rail (top 1.72), clear of the two body bays (x = +-0.42).
  // It comes down over the rack in a downpour; the Society has never yet been seen to unroll it.
  const canvas = PALETTE.camp.canvas;
  for (const s of [-1, 1]) {
    b.cylinder(0.085, 0.085, 2.62, canvas, [s * 0.86, 1.805, 0.2], [Math.PI / 2, 0, 0]);
    b.box(0.012, 0.02, 2.62, PALETTE.camp.canvasShade, [s * (0.86 + 0.08), 1.79, 0.2]); // the roll's outer edge, a fold of shade along it
    for (let i = 0; i < 4; i++) b.torus(0.093, 0.012, dark, [s * 0.86, 1.805, -0.85 + i * 0.68]); // lashings (a torus lies round Z: round the roll)
  }
  // a water cask in an iron cradle on the near side, ahead of the wheel, hung from the side board's top rail
  b.cylinder(0.14, 0.14, 0.38, wood, [-1.05, 0.98, -0.85], [Math.PI / 2, 0, 0]);
  for (const dz of [-0.13, 0.13]) {
    b.torus(0.145, 0.012, dark, [-1.05, 0.98, -0.85 + dz]); // hoops
    b.box(0.2, 0.03, 0.03, dark, [-0.97, 1.14, -0.85 + dz]); // the cradle's straps over the rail
  }
  return b.build();
}

function buildWheel(rim: number, trim: number): BufferGeometry | undefined {
  const b = new PartBuilder();
  const wood = PALETTE.camp.cartWood;
  // the wheel lies in the YZ plane (axis X): torus default is XY, so turn it a quarter about Y
  b.torus(WHEEL_R - 0.03, 0.045, rim, [0, 0, 0], [0, Math.PI / 2, 0]);
  b.torus(WHEEL_R - 0.015, 0.012, trim, [0.0, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1]);
  b.cylinder(0.1, 0.1, 0.16, wood, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(0.045, WHEEL_R - 0.05, 0.05, wood, [0, Math.cos(a) * (WHEEL_R / 2), Math.sin(a) * (WHEEL_R / 2)], [-a, 0, 0]);
  }
  return b.build();
}

function buildCrate(trim: number): BufferGeometry | undefined {
  const b = new PartBuilder();
  const wood = PALETTE.material.wood;
  b.box(0.78, 0.58, 0.78, wood);
  b.box(0.8, 0.06, 0.8, PALETTE.material.cream, [0, 0.0, 0], [0, 0, 0]); // the Society's stencilled band
  b.box(0.82, 0.04, 0.1, trim, [0, 0.27, 0.0]);
  b.box(0.1, 0.04, 0.82, trim, [0, 0.27, 0.0]);
  return b.build();
}

function withHull<T>(hull: boolean, make: () => T): T {
  const prev = PartBuilder.hullMode;
  const prevLod = PartBuilder.lod;
  PartBuilder.hullMode = hull;
  PartBuilder.lod = 0;
  try {
    return make();
  } finally {
    PartBuilder.hullMode = prev;
    PartBuilder.lod = prevLod;
  }
}

export function buildWagon(options: WagonBuildOptions = {}): WagonRig {
  const trim = BLANKET_DYES[(options.coat ?? 0) % BLANKET_DYES.length] ?? BLANKET_DYES[0]!;
  const rim = PALETTE.weapons.steel;
  const mat = wagonMaterial();
  const geos: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  const hulls: Mesh[] = [];
  let outlineOn = options.outline ?? true;
  let triangles = 0;
  const root = new Group();
  root.name = "wagon";
  const mk = (name: string, parent: Group, x = 0, y = 0, z = 0): Group => {
    const g = new Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined): Mesh | undefined => {
    const geo = withHull(false, make);
    if (!geo) return undefined;
    geos.push(geo);
    triangles += (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
    const m = new Mesh(geo, mat);
    m.name = `mesh_${bone}`;
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    const hg = withHull(true, make);
    if (hg) {
      geos.push(hg);
      const h = new Mesh(hg, outlineMaterial());
      h.name = `outline_${bone}`;
      h.visible = outlineOn;
      parent.add(h);
      hulls.push(h);
    }
    return m;
  };
  attach("bed", root, () => buildBed(trim));
  const wheelL = mk("wheelL", root, -0.97, AXLE_Y, 0);
  const wheelR = mk("wheelR", root, 0.97, AXLE_Y, 0);
  attach("wheelL", wheelL, () => buildWheel(rim, trim));
  attach("wheelR", wheelR, () => buildWheel(rim, trim));

  // crates share one geometry (and one hull geometry): four meshes, 8 draws at most
  const crateGeo = withHull(false, () => buildCrate(trim))!;
  const crateHull = withHull(true, () => buildCrate(trim));
  geos.push(crateGeo);
  if (crateHull) geos.push(crateHull);
  const crateTriangles = (crateGeo.index ? crateGeo.index.count : crateGeo.attributes.position!.count) / 3;
  const crates: { m: Mesh; h?: Mesh }[] = [];
  WAGON_FRAME.bays.forEach(([x, z], i) => {
    const m = new Mesh(crateGeo, mat);
    m.name = `crate${i}`;
    m.position.set(x, WAGON_FRAME.bayY, z);
    m.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.04 * (i + 1);
    m.castShadow = true;
    m.visible = false;
    root.add(m);
    let h: Mesh | undefined;
    if (crateHull) {
      h = new Mesh(crateHull, outlineMaterial());
      h.name = `crate${i}_outline`;
      h.position.copy(m.position);
      h.rotation.copy(m.rotation);
      h.visible = false;
      root.add(h);
    }
    crates.push(h ? { m, h } : { m });
  });
  let shown = 0;
  const setCargo = (n: number): void => {
    shown = Math.max(0, Math.min(4, Math.floor(Number.isFinite(n) ? n : 0)));
    crates.forEach((c, i) => {
      c.m.visible = i < shown;
      if (c.h) c.h.visible = i < shown && outlineOn;
    });
  };
  setCargo(options.cargo ?? 0);

  return {
    root,
    wheelL,
    wheelR,
    get meshCount() {
      return meshes.length + (outlineOn ? hulls.length : 0) + shown * (outlineOn ? 2 : 1);
    },
    get triangles() {
      return triangles + shown * crateTriangles;
    },
    setCargo,
    roll(distance) {
      const a = -distance / WHEEL_R;
      wheelL.rotation.x = a;
      wheelR.rotation.x = a;
    },
    setOutline(on) {
      outlineOn = on;
      for (const h of hulls) h.visible = on;
      crates.forEach((c, i) => c.h && (c.h.visible = on && i < shown));
    },
    dispose() {
      root.removeFromParent();
      for (const g of geos) g.dispose();
      geos.length = 0;
    },
  };
}
