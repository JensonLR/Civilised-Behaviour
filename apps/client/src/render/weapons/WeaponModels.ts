import { BufferGeometry, Group, Mesh, MeshToonMaterial, Object3D } from "three";
import { addOutlineNormals, outlineMaterial, sharedToonRamp, WEAPON_ANCHORS } from "@cb/procedural/three";
import type { WeaponLod } from "./gunParts.ts";
import { buildHammer, buildRamrod, buildStow, buildWeapon, hammerSpec, type BuiltWeapon } from "./weaponShapes.ts";

/**
 * Held weapons, built procedurally from the same primitives, vertex colours, toon ramp and ink outline as the characters (PartBuilder).
 * Model space (the contract with the animator's `WEAPON_ANCHORS`): the origin is the RIGHT hand's grip, -Z points down the barrel or blade, +Y is up.
 * One merged geometry per weapon is shared by every wielder; a wielder gets a Group of two meshes (the toned model and its inked hull) and, for
 * muzzle-loaders, a ramrod that slides out of the barrel while it reloads. Colours are the palette's `weapons` group only.
 */

const BUILT = new Map<number, BuiltWeapon>();
let material: MeshToonMaterial | undefined;

/** Cache key: weapon id, +100 for the first-person variant (the butt is trimmed), +1000 per level of detail. */
const keyOf = (id: number, vm: boolean, lod: WeaponLod): number => id + (vm ? 100 : 0) + lod * 1000;

function builtFor(id: number, vm = false, lod: WeaponLod = 0): BuiltWeapon | undefined {
  const key = keyOf(id, vm, lod);
  const hit = BUILT.get(key);
  if (hit) return hit;
  const built = buildWeapon(id, { vm, lod });
  if (!built) return undefined;
  addOutlineNormals(built.geometry); // the inked hull reads the same geometry (its own `onormal`): guns are thin, so the hull filters of the characters are not used
  BUILT.set(key, built);
  return built;
}

/** The shared geometry of a weapon at a level of detail (for placement maths: bounds, rest poses). Undefined for ids without a model. */
export function weaponGeometry(id: number, lod: WeaponLod = 0): BufferGeometry | undefined {
  return builtFor(id, false, lod)?.geometry;
}

const STOW = new Map<number, BuiltWeapon | null>();

/** The geometry of what a weapon is stowed in (holster, scabbard), or undefined for the ones that have none. */
export function stowGeometry(id: number, lod: WeaponLod = 0): BufferGeometry | undefined {
  const key = id + lod * 1000;
  let hit = STOW.get(key);
  if (hit === undefined) {
    hit = buildStow(id, lod) ?? null;
    if (hit) addOutlineNormals(hit.geometry);
    STOW.set(key, hit);
  }
  return hit?.geometry;
}

const HAMMERS = new Map<number, BuiltWeapon | null>();

/** The hammer's geometry (in its pivot's frame) for a weapon, or undefined. */
function hammerGeometry(id: number): BufferGeometry | undefined {
  let hit = HAMMERS.get(id);
  if (hit === undefined) {
    hit = buildHammer(id) ?? null;
    if (hit) addOutlineNormals(hit.geometry);
    HAMMERS.set(id, hit);
  }
  return hit?.geometry;
}

export const toon = (): MeshToonMaterial => (material ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }));

/** A weapon in a wielder's hands: the model, its ink, the muzzle marker and the ramrod. */
export class WeaponModel {
  readonly group = new Group();
  /** Where the round leaves (weapon space marker; read its matrixWorld). */
  readonly muzzle = new Object3D();
  private readonly rod: Mesh | undefined;
  private hull: Mesh | undefined;
  private readonly geo: BufferGeometry | undefined;
  private readonly rodBase: number;
  /** The hammer's pivot (a firearm's cock, on its own bone so it can fall on a shot and be cocked at the end of a reload), or undefined. */
  private readonly hammer: Group | undefined;
  private hammerHull: Mesh | undefined;
  private hammerGeo: BufferGeometry | undefined;

  /** `firstPerson` builds the variant the viewmodel shows (the shooter's own view of a long gun has no butt plate); `lod` 0 near, 1 middle, 2 far (fewer sides, no small furniture). */
  constructor(readonly id: number, outline: boolean, firstPerson = false, readonly lod: WeaponLod = 0) {
    const geo = builtFor(id, firstPerson, lod)?.geometry;
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
    const hg = lod === 0 ? hammerGeometry(id) : undefined;
    const hs = hammerSpec(id);
    if (hg && hs) {
      this.hammer = new Group();
      this.hammer.name = "hammer";
      this.hammer.position.set(hs.pivot[0], hs.pivot[1], hs.pivot[2]);
      const hm = new Mesh(hg, toon());
      hm.castShadow = true;
      this.hammer.add(hm);
      this.group.add(this.hammer);
      this.hammerGeo = hg;
    }
    this.setOutline(outline);
    this.rodBase = a && a.rod > 0 ? a.muzzle[2] : 0;
    if (a && a.rod > 0 && lod === 0) {
      const g = buildRamrod(a.rod)?.geometry;
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
    if (this.hammer && this.hammerGeo) {
      if (on && !this.hammerHull) {
        this.hammerHull = new Mesh(this.hammerGeo, outlineMaterial());
        this.hammerHull.castShadow = false;
        this.hammer.add(this.hammerHull);
      }
      if (this.hammerHull) this.hammerHull.visible = on;
    }
  }

  /** The cock: 0 drawn back (ready to fire), 1 fallen on the nipple or the pan (just fired). A no-op for a weapon without one. */
  setHammer(fallen: number): void {
    if (this.hammer) this.hammer.rotation.x = -Math.min(1, Math.max(0, fallen)) * 0.95;
  }

  /** True when this model has a hammer to animate. */
  get hasHammer(): boolean {
    return this.hammer !== undefined;
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
  for (const g of BUILT.values()) g.geometry.dispose();
  BUILT.clear();
  for (const g of STOW.values()) g?.geometry.dispose();
  STOW.clear();
  material?.dispose();
  material = undefined;
}

/** Triangle count of a weapon model at a level of detail, for the performance notes. */
export function weaponTriangles(id: number, lod: WeaponLod = 0): number {
  const g = builtFor(id, false, lod)?.geometry;
  return g ? (g.index ? g.index.count : g.attributes.position!.count) / 3 : 0;
}
