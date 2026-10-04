import { Box3, Group, Mesh, type BufferGeometry } from "three";
import { WEAPON } from "@cb/shared";
import { outlineMaterial, type CharacterRig } from "@cb/procedural/three";
import type { WeaponLod } from "./gunParts.ts";
import { WeaponModel, stowGeometry, toon, weaponGeometry } from "./WeaponModels.ts";

/**
 * The other two places a weapon is seen besides the hands: STOWED on a body (a pistol in its holster on the right hip, a sabre in its scabbard on the left,
 * a long gun slung across the back, an umbrella hooked through the belt) and DROPPED in the world (lying on its side where a body fell). Both reuse the model the
 * hands use, so the five weapons are drawn from one set of geometry in all four contexts (world, held, viewmodel, holstered).
 */

/** The torso measures a mount needs (a `CharacterRig.proportions` has all of them). */
export interface BodyMeasures {
  legUpper: number;
  legLower: number;
  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;
  hipWidth: number;
  shoulderHalfWidth: number;
}

/** A place in the TORSO's frame (the origin is the waist, +Y up, the front is -Z): a position and an Euler XYZ rotation. */
export interface MountPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export const newMountPose = (): MountPose => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });

/** Which weapons hang where (the order of a loadout is the order of the slots when two share one). */
export type Slot = "hipR" | "hipL" | "back";
export const SLOT_OF: Record<number, Slot> = {
  [WEAPON.PISTOL]: "hipR",
  [WEAPON.SABRE]: "hipL",
  [WEAPON.UMBRELLA]: "hipL",
  [WEAPON.RIFLE]: "back",
  [WEAPON.BLUNDERBUSS]: "back",
};

/** How far a hanging blade tilts back from the vertical (radians): at least `base`, more on short legs so its tip clears the ground (the tilt is capped: a sabre too long for its owner trails). */
function hangBack(P: BodyMeasures, length: number, base: number): number {
  const need = Math.acos(Math.min(1, (P.legUpper + P.legLower + 0.1) / length));
  return Math.min(1.05, Math.max(base, need));
}

/**
 * Where a stowed weapon's model goes. The model's origin is the grip, -Z is down the barrel. Pistol: muzzle down, grip back, on the right hip. Sabre: blade down
 * and a little back, hilt up, on the left hip. Umbrella: ferrule down beside the sabre's place. Long guns: barrel up over the right shoulder, the butt low
 * on the back, standing clear of the back by the stock's own depth, leaning toward the shoulder it hangs from.
 */
export function holsterPose(id: number, P: BodyMeasures, out: MountPose = newMountPose()): MountPose {
  // (clear of the coat's skirt and behind the hanging hand: the hips are drawn from the side and from behind as much as from the front)
  const side = Math.max(P.torsoWidth, P.hipWidth) * 0.5 + 0.1;
  out.x = out.y = out.z = out.rx = out.ry = out.rz = 0;
  switch (id) {
    case WEAPON.PISTOL:
      out.x = side;
      out.y = 0.12;
      out.z = 0.12;
      out.rx = -Math.PI / 2 + 0.12;
      out.rz = -0.08;
      break;
    case WEAPON.SABRE:
      out.x = -side;
      out.y = 0.14;
      out.z = 0.12;
      out.rx = -Math.PI / 2 - hangBack(P, 1.0, 0.28);
      out.rz = 0.1;
      break;
    case WEAPON.UMBRELLA:
      out.x = -side - 0.03;
      out.y = 0.12;
      out.z = 0.16;
      out.rx = -Math.PI / 2 - hangBack(P, 0.95, 0.2);
      out.rz = 0.05;
      break;
    case WEAPON.RIFLE:
    case WEAPON.BLUNDERBUSS:
      // (a real sling's diagonal: butt at the left hip, muzzle out past the right shoulder. At 18 degrees off the spine the muzzle rose straight behind the head, through any
      // hat with a brim and out of the crown of a shako; at ~38 degrees it clears a brim and stays inside the silhouette's shoulder line)
      out.x = -P.shoulderHalfWidth * 0.2;
      out.y = P.torsoHeight * 0.12;
      out.z = P.torsoDepth * 0.5 + 0.13;
      // (the lean is `ry`: with Euler XYZ the model turns about Z first, which is its own barrel, so the old `rz` lean only rolled the gun about itself and it always hung
      // straight up the spine. Ry before Rx tips the barrel across the back: negative leans the muzzle toward +X, the right shoulder)
      out.rx = Math.PI / 2 - 0.1;
      out.ry = -0.66;
      out.rz = -0.32;
      break;
    default:
      break;
  }
  return out;
}

/** How a dropped weapon lies: a roll about its own barrel axis, a pitch about the crosswise axis so a long tip rests on the ground, and the lift that puts its lowest point on it. */
export interface RestTilt {
  roll: number;
  pitch: number;
  lift: number;
}

const REST: Record<number, { roll: number; pitch: number }> = {
  [WEAPON.PISTOL]: { roll: Math.PI / 2, pitch: 0 },
  [WEAPON.RIFLE]: { roll: Math.PI / 2, pitch: -0.012 },
  [WEAPON.BLUNDERBUSS]: { roll: Math.PI / 2, pitch: -0.02 },
  [WEAPON.SABRE]: { roll: Math.PI / 2, pitch: -0.105 },
  [WEAPON.UMBRELLA]: { roll: Math.PI / 2, pitch: -0.03 },
};

const restCache = new Map<number, RestTilt>();

/** The roll, pitch and lift of a weapon lying on the ground (the lowest vertex of the model, after the tilt, rests on y = 0). */
export function restTilt(id: number): RestTilt {
  const hit = restCache.get(id);
  if (hit) return hit;
  const base = REST[id] ?? { roll: Math.PI / 2, pitch: 0 };
  const g = weaponGeometry(id);
  let lift = 0.03;
  if (g) {
    // R = Rx(pitch) * Rz(roll), the order a Group with rotation (pitch, 0, roll) applies; only the height of a vertex matters
    const pos = g.attributes.position!;
    let low = Infinity;
    const cr = Math.cos(base.roll);
    const sr = Math.sin(base.roll);
    const cp = Math.cos(base.pitch);
    const sp = Math.sin(base.pitch);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getX(i) * sr + pos.getY(i) * cr; // (Rz)
      const y2 = y * cp - pos.getZ(i) * sp; // (then Rx)
      if (y2 < low) low = y2;
    }
    lift = -low;
  }
  const out = { roll: base.roll, pitch: base.pitch, lift };
  restCache.set(id, out);
  return out;
}

/** A weapon lying where it was dropped: place it at a point on the ground with a heading. One per dropped weapon; the geometry is shared. */
export class WorldWeapon {
  readonly group = new Group();
  readonly model: WeaponModel;

  constructor(readonly id: number, outline: boolean, lod: WeaponLod = 0) {
    this.model = new WeaponModel(id, outline, false, lod);
    const t = restTilt(id);
    this.model.group.visible = true;
    this.model.group.rotation.set(t.pitch, 0, t.roll);
    this.model.group.position.set(0, t.lift, 0);
    this.model.setRod(0);
    this.group.name = `dropped_${id}`;
    this.group.add(this.model.group);
  }

  /** Puts it on the ground at (x, y, z) pointing along `yaw` (radians about the vertical). */
  place(x: number, y: number, z: number, yaw: number): this {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    return this;
  }

  setOutline(on: boolean): void {
    this.model.setOutline(on);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.model.dispose();
  }
}

/** One stowed weapon: the model and, where it has one, its holster or scabbard. */
class Stowed {
  readonly group = new Group();
  readonly model: WeaponModel;
  private readonly cover: Mesh | undefined;
  private coverHull: Mesh | undefined;
  private readonly coverGeo: BufferGeometry | undefined;

  constructor(readonly id: number, outline: boolean, lod: WeaponLod) {
    this.model = new WeaponModel(id, outline, false, lod);
    this.model.group.visible = true;
    this.group.add(this.model.group);
    this.coverGeo = stowGeometry(id, lod);
    if (this.coverGeo) {
      this.cover = new Mesh(this.coverGeo, toon());
      this.cover.castShadow = true;
      this.group.add(this.cover);
    }
    this.setOutline(outline);
    this.group.visible = false;
  }

  setOutline(on: boolean): void {
    this.model.setOutline(on);
    if (on && !this.coverHull && this.coverGeo) {
      this.coverHull = new Mesh(this.coverGeo, outlineMaterial());
      this.coverHull.castShadow = false;
      this.group.add(this.coverHull);
    }
    if (this.coverHull) this.coverHull.visible = on;
  }
}

/**
 * The stowed weapons of one body, parented to its torso: `show` is told which weapons the character carries and which one is in the hands (that one is
 * not drawn here). Models are made on first use and shared geometry-wise; a far body shows the far level of detail.
 */
export class Holsters {
  private readonly by = new Map<number, Stowed>();
  private readonly pose = newMountPose();
  private lod: WeaponLod = 0;
  private placed = "";

  constructor(
    private readonly rig: CharacterRig,
    private outline: boolean,
  ) {}

  setOutline(on: boolean): void {
    this.outline = on;
    for (const s of this.by.values()) s.setOutline(on);
  }

  /** Switches the level of detail the stowed weapons are drawn at (follows the body's crowd level). */
  setLod(lod: WeaponLod): void {
    if (lod === this.lod) return;
    this.lod = lod;
    for (const s of this.by.values()) s.group.removeFromParent();
    this.by.clear();
    this.placed = "";
  }

  /** `carried`: weapon ids on the body; `drawn`: the one in the hands (-1 for none). `hidden`: hands are busy or the body is down, so nothing hangs on it (it is on the ground, or carried). */
  show(carried: readonly number[], drawn: number, hidden = false): void {
    const key = `${carried.join(",")}|${drawn}|${hidden ? 1 : 0}|${this.lod}`;
    if (key === this.placed) return;
    this.placed = key;
    const taken = new Set<Slot>();
    for (const s of this.by.values()) s.group.visible = false;
    if (hidden) return;
    const P = this.rig.proportions;
    for (const id of carried) {
      if (id === drawn) continue;
      const slot = SLOT_OF[id];
      if (!slot || taken.has(slot)) continue; // (one thing to a slot: a sabre has the left hip, the umbrella waits)
      taken.add(slot);
      let s = this.by.get(id);
      if (!s) {
        s = new Stowed(id, this.outline, this.lod);
        this.rig.joints.torso.add(s.group);
        this.by.set(id, s);
      }
      const m = holsterPose(id, P, this.pose);
      s.group.position.set(m.x, m.y, m.z);
      s.group.rotation.set(m.rx, m.ry, m.rz);
      s.group.visible = true;
    }
  }

  /** Bounds of what is shown, in the torso's frame (for tests and for the fit audit to keep clear of the body). */
  bounds(out: Box3): Box3 {
    out.makeEmpty();
    this.rig.root.updateMatrixWorld(true);
    for (const s of this.by.values()) if (s.group.visible) out.union(new Box3().setFromObject(s.group));
    return out;
  }

  dispose(): void {
    for (const s of this.by.values()) s.group.removeFromParent();
    this.by.clear();
  }
}
