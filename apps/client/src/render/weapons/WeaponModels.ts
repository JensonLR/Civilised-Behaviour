import { BufferGeometry, Group, Mesh, MeshToonMaterial, Object3D } from "three";
import { PALETTE, WEAPON } from "@cb/shared";
import { PartBuilder, addOutlineNormals, outlineMaterial, sharedToonRamp, WEAPON_ANCHORS } from "@cb/procedural/three";

/**
 * Held weapons, built procedurally from the same primitives, vertex colours, toon ramp and ink outline as the characters (PartBuilder).
 * Model space (the contract with the animator's `WEAPON_ANCHORS`): the origin is the RIGHT hand's grip, -Z points down the barrel or blade, +Y is up.
 * One merged geometry per weapon is shared by every wielder; a wielder gets a Group of two meshes (the toned model and its inked hull) and, for
 * muzzle-loaders, a ramrod that slides out of the barrel while it reloads. Colours are the palette's `weapons` group only.
 */

const W = PALETTE.weapons;
const LEATHER = PALETTE.material.leather;

type V3 = readonly [number, number, number];

/** A cylinder laid along Z from z0 (back, +Z) to z1 (front, -Z): rBack at the back end, rFront at the front. */
function lay(b: PartBuilder, z0: number, z1: number, rBack: number, rFront: number, color: number, y = 0, x = 0): void {
  const back = Math.max(z0, z1);
  const front = Math.min(z0, z1);
  b.cylinder(rBack, rFront, back - front, color, [x, y, (back + front) / 2], [Math.PI / 2, 0, 0]);
}

/** A ring (band) round a barrel at z. */
function band(b: PartBuilder, z: number, r: number, w: number, color: number, y = 0, x = 0): void {
  lay(b, z + w / 2, z - w / 2, r, r, color, y, x);
}

function pistol(b: PartBuilder): void {
  // walnut grip, raked back, with a brass butt cap
  b.box(0.042, 0.135, 0.058, W.walnut, [0, -0.078, 0.04], [-0.32, 0, 0]);
  b.sphere(0.036, W.brass, [0, -0.15, 0.078], [1, 0.7, 1]);
  // fore-stock under the barrel and the ramrod pipe
  b.box(0.038, 0.034, 0.2, W.walnut, [0, -0.026, -0.12]);
  lay(b, 0.0, -0.3, 0.007, 0.007, W.steelDark, -0.05);
  // the barrel, blued, with a brass muzzle ring and a front sight
  lay(b, -0.02, -0.365, 0.02, 0.0155, W.barrel, 0.016);
  band(b, -0.35, 0.021, 0.02, W.brass, 0.016);
  b.box(0.006, 0.012, 0.01, W.steel, [0, 0.043, -0.355]);
  // the lock: plate, cock (hammer), frizzen and pan
  b.box(0.012, 0.055, 0.1, W.brassDark, [0.026, 0.02, -0.005]);
  b.box(0.012, 0.055, 0.1, W.brassDark, [-0.026, 0.02, -0.005]);
  b.box(0.012, 0.06, 0.018, W.steelDark, [0.03, 0.062, 0.02], [0.4, 0, 0]);
  b.box(0.028, 0.032, 0.012, W.steel, [0, 0.055, -0.058], [-0.2, 0, 0]);
  b.box(0.032, 0.014, 0.03, W.brass, [0, 0.038, -0.04]);
  // trigger guard
  b.torus(0.028, 0.004, W.brass, [0, -0.028, 0.0], [0, Math.PI / 2, 0], [1, 1, 1], Math.PI);
}

function rifleLike(b: PartBuilder, o: { muzzle: number; forestock: number; long: boolean; brassBarrel: boolean; flare: boolean; vm?: boolean }): void {
  const barrelCol = o.brassBarrel ? W.bronze : W.barrel;
  const bandCol = o.brassBarrel ? W.bronzeDark : W.brass;
  // stock: the butt (raked), the wrist, the fore-end. The viewmodel's stops behind the wrist: a shooter's eye never sees the butt plate, and a butt that
  // ended in front of the lens would be a wall of brass
  if (o.vm) {
    b.box(0.05, 0.115, 0.15, W.walnut, [0, -0.05, 0.055], [0.05, 0, 0]);
  } else {
    b.box(0.05, 0.115, 0.3, W.walnut, [0, -0.05, 0.13], [0.09, 0, 0]);
    b.box(0.052, 0.12, 0.014, W.brass, [0, -0.052, 0.283], [0.09, 0, 0]); // butt plate
  }
  b.box(0.046, 0.075, 0.12, W.walnutLight, [0, -0.028, -0.03]);
  b.box(0.042, 0.052, o.forestock, W.walnut, [0, -0.034, -0.09 - o.forestock / 2]);
  // barrel (or barrels), atop the fore-end
  if (o.flare) {
    // the blunderbuss: two barrels side by side, each belling out to a flared mouth
    for (const x of [-0.018, 0.018]) {
      lay(b, -0.02, o.muzzle + 0.1, 0.022, 0.019, barrelCol, 0.02, x);
      b.cylinder(0.05, 0.02, 0.15, barrelCol, [x * 1.5, 0.02, o.muzzle + 0.075], [Math.PI / 2, 0, 0]);
      b.torus(0.05, 0.006, bandCol, [x * 1.5, 0.02, o.muzzle], [0, 0, 0], [1, 1, 1]);
    }
    band(b, -0.2, 0.05, 0.02, bandCol, 0.02);
  } else {
    lay(b, -0.02, o.muzzle, 0.0185, 0.0145, barrelCol, 0.022);
    for (const z of o.long ? [-0.34, -0.56, -0.78] : [-0.28, -0.46]) band(b, z, 0.0215, 0.022, bandCol, 0.022);
    b.box(0.006, 0.016, 0.01, W.steel, [0, 0.05, o.muzzle + 0.015]); // front sight
    b.box(0.03, 0.012, 0.03, W.steelDark, [0, 0.052, -0.14]); // rear sight
    b.box(0.036, 0.012, 0.024, bandCol, [0, -0.006, o.muzzle - 0.01]); // nose cap
  }
  // the lock (percussion: plate, hammer, nipple) and the trigger guard
  for (const s of [1, -1]) b.box(0.012, 0.06, 0.13, W.steel, [0.028 * s, 0.006, -0.01]);
  b.box(0.012, 0.062, 0.024, W.steelDark, [0.036, 0.048, 0.05], [0.5, 0, 0]);
  b.cone(0.007, 0.02, W.brass, [0.03, 0.045, -0.05]); // the percussion nipple, beside the sight line and under the hammer
  b.torus(0.04, 0.005, W.brass, [0, -0.074, 0.02], [0, Math.PI / 2, 0], [1, 1, 1], Math.PI);
  b.box(0.008, 0.028, 0.006, W.steelDark, [0, -0.052, 0.03]); // trigger
  // ramrod pipe under the barrel (the rod itself is a separate mesh so it can slide)
  lay(b, -0.06, o.muzzle + 0.03, 0.006, 0.006, W.steelDark, -0.006);
}

function sabre(b: PartBuilder): void {
  // grip: leather-wrapped, with a brass pommel cap and a knuckle guard sweeping to the cross guard
  b.cylinder(0.014, 0.012, 0.13, LEATHER, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  b.sphere(0.02, W.brass, [0, 0, 0.09]);
  b.cone(0.012, 0.03, W.brass, [0, 0.014, 0.1], [-Math.PI / 2 - 0.5, 0, 0]);
  b.torus(0.05, 0.005, W.brass, [0, 0.0, 0.0], [0, Math.PI / 2, 0], [1, 1.6, 1], Math.PI);
  b.box(0.11, 0.014, 0.012, W.brass, [0, 0, -0.056]); // cross guard
  b.sphere(0.011, W.brass, [0.055, 0, -0.056]);
  b.sphere(0.011, W.brass, [-0.055, 0, -0.056]);
  // the blade: a shallow curve falling away toward the tip, one smooth swept form (a darker spine along the back)
  const spine: V3[] = [];
  const back: V3[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const drop = 0.075 * t * t;
    spine.push([0, -drop, -0.06 - t * 0.94]);
    const half = 0.019 * (1 - 0.6 * t * t) * (t > 0.92 ? (1 - t) / 0.08 : 1) + 0.0015;
    back.push([0, -drop + half * 0.72, -0.06 - t * 0.94]);
  }
  const half = (t: number): number => 0.019 * (1 - 0.6 * t * t) * (t > 0.92 ? Math.max(0.05, (1 - t) / 0.08) : 1);
  b.sweep(spine, (t) => ({ rx: 0.0034, rz: half(t), pow: 2.6 }), W.steel, { side: [1, 0, 0], segments: 6, caps: true });
  b.sweep(back, (t) => ({ rx: 0.0042, rz: half(t) * 0.16, pow: 2.4 }), W.steelDark, { side: [1, 0, 0], segments: 5, caps: true });
}

function umbrella(b: PartBuilder): void {
  // a furled walking umbrella: crook handle at the grip, a tight indigo canopy, a strap, a brass ferrule
  b.torus(0.032, 0.011, W.walnut, [0, 0.03, 0.05], [0, Math.PI / 2, 0], [1, 1, 1], Math.PI * 1.15);
  lay(b, 0.05, -0.1, 0.011, 0.011, W.walnut, 0);
  lay(b, -0.08, -0.68, 0.03, 0.006, W.umbrella, 0);
  lay(b, -0.08, -0.5, 0.034, 0.022, W.umbrella, 0);
  for (const z of [-0.14, -0.24, -0.34, -0.44]) lay(b, z + 0.006, z - 0.006, 0.036 - (-z - 0.14) * 0.05, 0.036 - (-z - 0.14) * 0.05, W.umbrellaRib, 0);
  band(b, -0.2, 0.034, 0.028, LEATHER, 0);
  b.sphere(0.011, W.brass, [0, 0, -0.08]);
  lay(b, -0.66, -0.92, 0.006, 0.004, W.steelDark, 0);
  b.cone(0.005, 0.03, W.brass, [0, 0, -0.935], [-Math.PI / 2, 0, 0]);
}

const BUILD: Record<number, (b: PartBuilder, vm: boolean) => void> = {
  [WEAPON.PISTOL]: pistol,
  [WEAPON.RIFLE]: (b, vm) => rifleLike(b, { muzzle: -1.0, forestock: 0.5, long: true, brassBarrel: false, flare: false, vm }),
  [WEAPON.BLUNDERBUSS]: (b, vm) => rifleLike(b, { muzzle: -0.66, forestock: 0.28, long: false, brassBarrel: true, flare: true, vm }),
  [WEAPON.SABRE]: sabre,
  [WEAPON.UMBRELLA]: umbrella,
};

// keyed by weapon id, +100 for the first-person variant (same model, seen from behind: the butt is trimmed)
const geometries = new Map<number, BufferGeometry>();
let material: MeshToonMaterial | undefined;

function geometryFor(id: number, vm = false): BufferGeometry | undefined {
  const key = vm ? id + 100 : id;
  const hit = geometries.get(key);
  if (hit) return hit;
  const make = BUILD[id];
  if (!make) return undefined;
  const b = new PartBuilder();
  make(b, vm);
  const geo = b.build();
  if (!geo) return undefined;
  addOutlineNormals(geo); // the inked hull reads the same geometry (its own `onormal`): guns are thin, so the hull filters of the characters are not used
  geometries.set(key, geo);
  return geo;
}

const toon = (): MeshToonMaterial => (material ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }));

/** A weapon in a wielder's hands: the model, its ink, the muzzle marker and the ramrod. */
export class WeaponModel {
  readonly group = new Group();
  /** Where the round leaves (weapon space marker; read its matrixWorld). */
  readonly muzzle = new Object3D();
  private readonly rod: Mesh | undefined;
  private hull: Mesh | undefined;
  private readonly geo: BufferGeometry | undefined;
  private readonly rodBase: number;

  /** `firstPerson` builds the variant the viewmodel shows (the shooter's own view of a long gun has no butt plate). */
  constructor(readonly id: number, outline: boolean, firstPerson = false) {
    const geo = geometryFor(id, firstPerson);
    this.geo = geo;
    this.group.name = `weapon_${id}`;
    const a = WEAPON_ANCHORS[id];
    if (geo) {
      const m = new Mesh(geo, toon());
      m.castShadow = true;
      m.name = "weapon";
      this.group.add(m);
      this.setOutline(outline);
    }
    if (a) this.muzzle.position.set(a.muzzle[0], a.muzzle[1], a.muzzle[2]);
    this.group.add(this.muzzle);
    this.rodBase = a && a.rod > 0 ? a.muzzle[2] : 0;
    if (a && a.rod > 0) {
      const b = new PartBuilder();
      lay(b, 0, -a.rod, 0.0055, 0.0055, W.steel);
      b.sphere(0.011, W.steelDark, [0, 0, 0.004]);
      const g = b.build();
      if (g) {
        this.rod = new Mesh(g, toon());
        this.rod.castShadow = true;
        this.rod.visible = false;
        this.group.add(this.rod);
      }
    }
    this.group.visible = false;
  }

  /** Ink line on or off (the graphics preset changes it live). The hull is made the first time it is wanted. */
  setOutline(on: boolean): void {
    if (on && !this.hull && this.geo) {
      this.hull = new Mesh(this.geo, outlineMaterial());
      this.hull.name = "weapon_ink";
      this.hull.castShadow = false;
      this.group.add(this.hull);
    }
    if (this.hull) this.hull.visible = on;
  }

  /** Slides the ramrod out of the barrel (metres drawn; 0 = seated, hidden). The rod sits in the pipe under the barrel. */
  setRod(out: number): void {
    if (!this.rod) return;
    this.rod.visible = out > 0.01;
    // seated it spans the barrel; drawn it stands proud of the muzzle: tail at the muzzle end plus `out`
    this.rod.position.set(0, -0.006, this.rodBase + 0.03 - out * 0.15);
    this.rod.rotation.x = -out * 0.9;
  }

  dispose(): void {
    // geometry and materials are shared by every wielder and live for the page
    this.group.removeFromParent();
  }
}

/** Frees the shared geometry (tests; the game keeps it for the page's life). */
export function disposeWeaponModels(): void {
  for (const g of geometries.values()) g.dispose();
  geometries.clear();
  material?.dispose();
  material = undefined;
}

/** Triangle count of a weapon model, for the performance notes. */
export function weaponTriangles(id: number): number {
  const g = geometryFor(id);
  return g ? (g.index ? g.index.count : g.attributes.position!.count) / 3 : 0;
}
