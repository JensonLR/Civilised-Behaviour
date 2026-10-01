import type { BufferGeometry } from "three";
import { PALETTE, WEAPON } from "@cb/shared";
import { PartBuilder, WEAPON_ANCHORS, type V3 } from "@cb/procedural/three";
import { HAND_AT } from "../viewPose.ts";
import { GunBuilder, smoothAt, smoothPath, type HandleAxis, type PartMeta, type WeaponLod } from "./gunParts.ts";

/**
 * The five carried weapons as chunky caricature props. Design rules (tested in weaponGeometry.test.ts):
 *   - nothing that carries the silhouette is thinner than 2.5 cm (a gun reads at 10 m), small furniture is at least 1.2 cm and stays out of the far levels;
 *   - every piece touches the body of the weapon (one connected part graph at every level of detail);
 *   - the handle the right fist wraps round passes through the model's origin along `WEAPON_ANCHORS[id].grip`;
 *   - the muzzle anchor is the barrel's tip, the butt anchor is on the butt, and the model stays inside its envelope.
 * Proportions are the characters': big fists (8 cm), so grips are fat and barrels are thick. Colours are the palette's `weapons` group.
 * Model space: origin = the RIGHT hand's grip, -Z down the barrel or blade, +Y up, +X the wielder's right.
 */

const W = PALETTE.weapons;
const LEATHER = PALETTE.material.leather;

/** One built weapon: the merged geometry, what each primitive is (in merge order) and the handles the fists wrap round. */
export interface BuiltWeapon {
  geometry: BufferGeometry;
  meta: PartMeta[];
  handles: HandleAxis[];
}

/** The model's bounds (weapon space, metres): `[min, max]`. The test keeps every vertex inside, so a stray piece cannot fly off to one side. */
export const WEAPON_ENVELOPE: Record<number, readonly [V3, V3]> = {
  [WEAPON.PISTOL]: [[-0.1, -0.26, -0.42], [0.1, 0.2, 0.16]],
  [WEAPON.RIFLE]: [[-0.1, -0.26, -1.36], [0.1, 0.2, 0.32]],
  [WEAPON.BLUNDERBUSS]: [[-0.12, -0.26, -0.72], [0.12, 0.2, 0.32]],
  [WEAPON.SABRE]: [[-0.11, -0.2, -1.05], [0.11, 0.12, 0.18]],
  [WEAPON.UMBRELLA]: [[-0.1, -0.12, -1.0], [0.1, 0.12, 0.18]],
};

/** Triangle budgets by level of detail (the test fails a model that grows past them). */
export const WEAPON_TRIANGLES: readonly [number, number, number] = [1600, 800, 480];

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The handle every firearm and the pistol share: a swept walnut post along the fist's grip axis, thicker at the heel, with a brass cap. Returns nothing: it registers the handle. */
function gripPost(b: GunBuilder, id: number, s0: number, s1: number, rx: number, rz: number, cap: number, capBack: number, through: V3 = [0, 0, 0]): void {
  const g = unit(WEAPON_ANCHORS[id]!.grip);
  const p = (s: number): V3 => [through[0] + g[0] * s, through[1] + g[1] * s, through[2] + g[2] * s];
  const a = p(s0);
  const e = p(s1);
  b.tube([a, p((s0 * 2 + s1) / 3), p((s0 + s1 * 2) / 3), e], (t) => ({ rx: rx * (1.1 - 0.1 * t), rz: rz * (1.18 - 0.18 * t), pow: 2.4 }), W.walnut, { round: "start" });
  // the brass cap on the heel, swelling a little back (a bird's-head butt reads even when the hand covers the post)
  b.ball(cap, W.brass, [a[0], a[1] - 0.004, a[2] + capBack], [1, 0.82, 1.1]);
  b.handle("R", a, e, Math.min(rx, rz));
}

function pistol(b: GunBuilder, vm: boolean): void {
  // (the viewmodel's fist sits where `HAND_AT` says, a little behind the third person's: the post passes through it)
  gripPost(b, WEAPON.PISTOL, -0.125, 0.05, 0.031, 0.036, 0.046, 0.014, vm ? HAND_AT[WEAPON.PISTOL]! : [0, 0, 0]);
  // the stock: a rounded fore-end under the barrel and a tail behind the lock
  b.tube([[0, -0.006, -0.205], [0, -0.006, -0.08], [0, 0.0, 0.03], [0, 0.004, 0.085]], (t) => ({ rx: 0.029 + 0.003 * t, rz: 0.031 + 0.006 * t, pow: 2.4 }), W.walnut, { round: "both" });
  // the barrel: thick, blued, with brass rings. Its top is the sight line (0.05 above the grip, see `SIGHTS`): nothing stands above it on the centre line
  const y = 0.022;
  b.lay(-0.025, -0.36, 0.028, 0.022, W.barrel, y);
  b.band(-0.345, 0.028, 0.028, W.brass, y);
  b.band(-0.15, 0.028, 0.028, W.brassDark, y);
  // the lock: a brass housing; the cock, the frizzen and the pan stand on the RIGHT of it, as a lock does, which leaves the sight line clear
  b.tube([[0, 0.014, -0.05], [0, 0.014, 0.05]], () => ({ rx: 0.031, rz: 0.021, pow: 2.8 }), W.brassDark, { round: "both" });
  // (the cock stands on its own pivot: `buildHammer`)
  b.box(0.028, 0.05, 0.026, W.steel, [0.04, 0.058, -0.056], [-0.25, 0, 0]);
  b.box(0.042, 0.03, 0.044, W.brass, [0.036, 0.04, -0.04]);
  // the trigger guard (a thick brass hoop) and the trigger
  b.ring(0.04, 0.0125, W.brass, [0, -0.032, -0.04], [0, Math.PI / 2, Math.PI], Math.PI);
  b.box(0.016, 0.036, 0.014, W.steelDark, [0, -0.046, -0.012], [0, 0, 0], true);
  // the sights: two posts either side of the line at the breech, a blade at the muzzle
  for (const x of [-0.017, 0.017]) b.box(0.012, 0.02, 0.02, W.steelDark, [x, 0.056, -0.04], [0, 0, 0], true);
  b.box(0.014, 0.014, 0.014, W.steel, [0, 0.043, -0.35], [0, 0, 0], true);
}

/** The stock a long gun shares: a curved sweep from the butt over the comb to the lock, a fat raked pistol grip, the fore-end and the lock furniture. */
function longGun(b: GunBuilder, o: { id: number; vm: boolean; muzzle: number; forend: number; brass: boolean; bell: boolean; breechY: number }): void {
  const barrelCol = o.brass ? W.bronze : W.barrel;
  const bandCol = o.brass ? W.bronzeDark : W.brass;
  const lockCol = o.brass ? W.brassDark : W.steelDark;
  // the stock: z, centre height, half height, half width. The viewmodel's stops behind the wrist and ends round: a shooter's eye never sees the butt
  const zs = o.vm ? [0.09, 0.05, 0.0, -0.05] : [0.25, 0.19, 0.12, 0.05, -0.05];
  const yc = o.vm ? [-0.05, -0.04, -0.012, 0] : [-0.035, -0.04, -0.025, -0.004, 0];
  const hh = o.vm ? [0.04, 0.042, 0.05, 0.05] : [0.092, 0.078, 0.06, 0.05, 0.05];
  const ww = o.vm ? [0.026, 0.028, 0.03, 0.031] : [0.034, 0.032, 0.03, 0.03, 0.031];
  const sd = o.breechY - 0.03; // (the aimed line of the blunderbuss runs lower than the rifle's: its stock and lock sit lower with it)
  const keys: V3[] = zs.map((z, i) => [0, yc[i]! + (i >= zs.length - 2 ? sd : 0), z]);
  const spine = smoothPath(keys, 9);
  b.tube(spine, (t) => ({ rx: smoothAt(ww, t), rz: smoothAt(hh, t), pow: 2.5 }), W.walnut, o.vm ? { round: "start" } : {});
  if (!o.vm) b.box(0.07, 0.19, 0.026, W.brass, [0, -0.037, 0.262], [0.09, 0, 0]); // the butt plate
  gripPost(b, o.id, -0.105, 0.04, 0.028, 0.032, 0.03, 0.01, o.vm ? HAND_AT[o.id]! : [0, 0, 0]);
  // the fore-end under the barrel
  const fe = o.forend;
  // (the left fist holds it from below, 5 cm under the aimed line: `WEAPON_ANCHORS.left`)
  b.tube([[0, -0.04, -0.04], [0, -0.04, -0.04 - fe / 2], [0, -0.04, -0.04 - fe]], () => ({ rx: 0.031, rz: 0.045, pow: 2.5 }), W.walnutLight, { round: "end" });
  b.box(0.066, 0.092, 0.03, bandCol, [0, -0.039, -0.04 - fe - 0.002]); // the fore-end's tip
  // the barrel. Its top is the aimed line (`SIGHTS` in viewPose.ts: 0.058 for the rifle): nothing stands above it on the centre line but the sights
  const y = o.breechY;
  if (o.bell) {
    // (the blunderbuss has no sights: the top of the barrel, a hair under the eye line, and the bell standing out beyond it)
    b.lay(-0.02, -0.46, 0.03, 0.028, barrelCol, y);
    b.rod([0, y, -0.44], [0, 0.03, o.muzzle], 0.028, 0.074, barrelCol); // the bell
    b.ring(0.072, 0.0125, bandCol, [0, 0.03, o.muzzle], [0, 0, 0]); // the rim
    b.band(-0.2, 0.033, 0.03, bandCol, y);
    b.band(-0.34, 0.032, 0.03, bandCol, y);
  } else {
    b.lay(-0.02, o.muzzle, 0.028, 0.022, barrelCol, y);
    for (const z of [-0.34, -0.58, -0.82]) b.band(z, 0.03, 0.03, bandCol, y);
    for (const x of [-0.017, 0.017]) b.box(0.012, 0.02, 0.02, W.steelDark, [x, y + 0.03, -0.14], [0, 0, 0], true); // the rear sight: two posts, the line runs between
  }
  // the lock: a plate under the barrel's top line (from behind, the barrel and its sights show above it), the cap hammer standing out to the RIGHT
  // of the sight line with its nipple, the trigger guard and the trigger
  b.tube([[0, y - 0.012, -0.07], [0, y - 0.012, 0.05]], () => ({ rx: 0.032, rz: 0.021, pow: 2.8 }), lockCol, { round: "both" });
  b.cone(0.0135, 0.04, W.brass, [0.026, y + 0.018, -0.045]); // the percussion nipple under the hammer
  b.ring(0.045, 0.0125, W.brass, [0, -0.03, -0.05], [0, Math.PI / 2, Math.PI], Math.PI);
  b.box(0.016, 0.036, 0.014, W.steelDark, [0, -0.045, -0.02], [0, 0, 0], true);
}

function rifle(b: GunBuilder, vm: boolean): void {
  const m = -1.0;
  longGun(b, { id: WEAPON.RIFLE, vm, muzzle: m, forend: 0.55, brass: false, bell: false, breechY: 0.03 });
  // the bayonet: a socket over the muzzle, a jog down off the bore, and a spike blade
  b.band(m + 0.05, 0.03, 0.07, W.steelDark, 0.03);
  b.box(0.014, 0.014, 0.014, W.steel, [0, 0.055, m + 0.025], [0, 0, 0], true); // the front sight, on the socket
  b.box(0.028, 0.06, 0.05, W.steelDark, [0, 0.0, m + 0.01]);
  b.tube([[0, -0.012, m - 0.005], [0, -0.012, m - 0.14], [0, -0.012, m - 0.27]], (t) => ({ rx: 0.0135, rz: 0.024 * (1 - 0.7 * t * t) + 0.003, pow: 2 }), W.steel, { round: "end" });
}

function blunderbuss(b: GunBuilder, vm: boolean): void {
  longGun(b, { id: WEAPON.BLUNDERBUSS, vm, muzzle: -0.66, forend: 0.3, brass: true, bell: true, breechY: 0.012 });
}

function sabre(b: GunBuilder): void {
  // grip: a fat leather-wrapped hilt with a brass pommel, a cross guard with knobs and a knuckle bow
  b.lay(0.11, -0.045, 0.027, 0.027, LEATHER);
  b.handle("R", [0, 0, 0.1], [0, 0, -0.04], 0.027);
  b.ball(0.04, W.brass, [0, 0, 0.125]);
  b.box(0.15, 0.03, 0.03, W.brass, [0, 0, -0.06]);
  b.ball(0.024, W.brass, [0.078, 0, -0.06]);
  b.ball(0.024, W.brass, [-0.078, 0, -0.06]);
  b.ring(0.085, 0.0125, W.brass, [0, 0, 0.025], [0, Math.PI / 2, Math.PI], Math.PI);
  // the blade: a shallow curve falling away to the tip, a lens section 2.5 cm thick and 6 cm wide at the root, with a darker spine along the back
  const drop = 0.06;
  const n = 11;
  const spine: V3[] = [];
  const back: V3[] = [];
  const half = (t: number): number => 0.03 * (1 - 0.45 * t * t) * (t > 0.9 ? Math.max(0.06, (1 - t) / 0.1) : 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -drop * t * t;
    spine.push([0, y, -0.07 - t * 0.9]);
    back.push([0, y + half(t) * 0.7, -0.07 - t * 0.9]);
  }
  b.tube(spine, (t) => ({ rx: 0.0125, rz: Math.max(0.006, half(t)), pow: 1.9 }), W.steel);
  b.tube(back, (t) => ({ rx: 0.0125, rz: Math.max(0.0125, half(t) * 0.35), pow: 2.3 }), W.steelDark, { round: "end" });
}

function umbrella(b: GunBuilder): void {
  // a furled walking umbrella: a crook handle, a fat indigo canopy with ribs and a strap, a brass ferrule
  b.lay(0.1, -0.12, 0.022, 0.022, W.walnut);
  b.handle("R", [0, 0, 0.09], [0, 0, -0.1], 0.022);
  b.ring(0.045, 0.0125, W.walnut, [0, 0.045, 0.1], [0, -Math.PI / 2, -Math.PI / 2], Math.PI * 1.2);
  b.lay(-0.1, -0.2, 0.026, 0.04, W.walnut);
  b.lay(-0.18, -0.66, 0.05, 0.016, W.umbrella);
  const rad = (z: number): number => 0.05 + (0.016 - 0.05) * ((-z - 0.18) / 0.48);
  for (const z of [-0.26, -0.38, -0.5]) b.band(z, rad(z) + 0.004, 0.026, W.umbrellaRib);
  b.band(-0.31, rad(-0.31) + 0.008, 0.03, LEATHER);
  b.lay(-0.64, -0.92, 0.0145, 0.0125, W.steelDark);
  b.cone(0.0125, 0.05, W.brass, [0, 0, -0.945], [-Math.PI / 2, 0, 0]);
}

const BUILD: Record<number, (b: GunBuilder, vm: boolean) => void> = {
  [WEAPON.PISTOL]: pistol,
  [WEAPON.RIFLE]: rifle,
  [WEAPON.BLUNDERBUSS]: blunderbuss,
  [WEAPON.SABRE]: (b) => sabre(b),
  [WEAPON.UMBRELLA]: (b) => umbrella(b),
};

/** Builds a fresh copy of a weapon at a level of detail (callers cache; tests want a fresh one). `vm`: the first-person variant (the butt is trimmed). Undefined for ids without a model. */
export function buildWeapon(id: number, opts: { vm?: boolean; lod?: WeaponLod } = {}): BuiltWeapon | undefined {
  const make = BUILD[id];
  if (!make) return undefined;
  // (the characters' builders set these around their own bones; a weapon builds with the plain settings whoever is asking)
  const saved = [PartBuilder.lod, PartBuilder.hullMode] as const;
  PartBuilder.lod = 0;
  PartBuilder.hullMode = false;
  try {
    const b = new GunBuilder(opts.lod ?? 0);
    make(b, opts.vm === true);
    const geometry = b.build();
    if (!geometry) return undefined;
    return { geometry, meta: b.meta, handles: b.handles };
  } finally {
    PartBuilder.lod = saved[0];
    PartBuilder.hullMode = saved[1];
  }
}

/** The ramrod: a thick steel rod with a knob at the back (a separate mesh: it slides out of the barrel while a muzzle-loader reloads). */
export function buildRamrod(length: number): BuiltWeapon | undefined {
  const saved = [PartBuilder.lod, PartBuilder.hullMode] as const;
  PartBuilder.lod = 0;
  PartBuilder.hullMode = false;
  try {
    const b = new GunBuilder(0);
    b.lay(0, -length, 0.0125, 0.0125, W.steel);
    b.ball(0.02, W.steelDark, [0, 0, 0.004]);
    const geometry = b.build();
    return geometry ? { geometry, meta: b.meta, handles: b.handles } : undefined;
  } finally {
    PartBuilder.lod = saved[0];
    PartBuilder.hullMode = saved[1];
  }
}

/**
 * What a weapon is stowed in, drawn WITH the weapon in the same space (the model's own frame): a leather holster round a pistol's barrel, a scabbard over a
 * sabre's blade. Long guns hang on a sling and an umbrella is simply carried: they have none. A separate geometry: only the stowed weapon shows it.
 */
export function buildStow(id: number, lod: WeaponLod = 0): BuiltWeapon | undefined {
  if (id !== WEAPON.PISTOL && id !== WEAPON.SABRE) return undefined;
  const saved = [PartBuilder.lod, PartBuilder.hullMode] as const;
  PartBuilder.lod = 0;
  PartBuilder.hullMode = false;
  try {
    const b = new GunBuilder(lod);
    if (id === WEAPON.PISTOL) {
      // a pouch over the barrel and lock, open at the back where the grip stands out, with a brass chape at the muzzle end and a belt loop
      b.tube([[0, 0.012, -0.385], [0, 0.012, -0.2], [0, 0.016, -0.02]], (t) => ({ rx: 0.043 + 0.008 * t, rz: 0.05 + 0.006 * t, pow: 2.6 }), LEATHER, { round: "start" });
      b.ball(0.034, W.brass, [0, 0.012, -0.385], [1, 1, 0.8]);
      b.box(0.056, 0.05, 0.04, LEATHER, [0.0, 0.052, -0.03]); // the belt loop
    } else if (id === WEAPON.SABRE) {
      const spine: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        spine.push([0, -0.06 * t * t, -0.07 - t * 0.93]);
      }
      b.tube(spine, (t) => ({ rx: 0.021, rz: 0.04 * (1 - 0.25 * t), pow: 2.2 }), LEATHER, { round: "end" });
      b.ball(0.03, W.brass, [0, -0.06, -1.0], [0.9, 1, 1.3]); // the chape
      b.band(-0.09, 0.034, 0.032, W.brass, 0); // the throat
    }
    const geometry = b.build();
    return geometry ? { geometry, meta: b.meta, handles: b.handles } : undefined;
  } finally {
    PartBuilder.lod = saved[0];
    PartBuilder.hullMode = saved[1];
  }
}

// ---- the hammer: its own part, on its own pivot, so it can fall on a shot and be cocked again at the end of a reload ------------------------------------------------------

/** Where each firearm's hammer pivots (weapon space), the spine of its arm relative to the pivot, and its jaw (a flint's clamp: the pistol's only). */
interface HammerSpec {
  pivot: V3;
  spine: readonly V3[];
  jaw?: { pos: V3; size: V3 };
}

export function hammerSpec(id: number): HammerSpec | undefined {
  if (id === WEAPON.PISTOL) {
    const p: V3 = [0.015, 0.018, 0.04];
    return { pivot: p, spine: [[0, 0, 0], [0.021, 0.032, 0.026], [0.025, 0.062, 0.005], [0.025, 0.068, -0.025]], jaw: { pos: [0.025, 0.064, -0.04], size: [0.03, 0.028, 0.028] } };
  }
  if (id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS) {
    const y = id === WEAPON.RIFLE ? 0.03 : 0.012;
    return { pivot: [0.015, y - 0.004, 0.04], spine: [[0, 0, 0], [0.021, 0.024, 0.018], [0.025, 0.044, 0], [0.025, 0.048, -0.024]] };
  }
  return undefined;
}

/** The hammer in its PIVOT's frame (the origin is where it turns; it stands cocked, drawn back, in this pose). Undefined for weapons without one, and at the far levels of detail (a few pixels). */
export function buildHammer(id: number, lod: WeaponLod = 0): BuiltWeapon | undefined {
  const spec = hammerSpec(id);
  if (!spec || lod > 0) return undefined;
  const saved = [PartBuilder.lod, PartBuilder.hullMode] as const;
  PartBuilder.lod = 0;
  PartBuilder.hullMode = false;
  try {
    const b = new GunBuilder(0);
    b.tube(spec.spine, (t) => ({ rx: 0.0135 - 0.0015 * t, rz: 0.0135 - 0.002 * t, pow: 2.4 }), W.steelDark, { round: "end" });
    if (spec.jaw) b.box(spec.jaw.size[0], spec.jaw.size[1], spec.jaw.size[2], W.steel, spec.jaw.pos);
    const geometry = b.build();
    return geometry ? { geometry, meta: b.meta, handles: b.handles } : undefined;
  } finally {
    PartBuilder.lod = saved[0];
    PartBuilder.hullMode = saved[1];
  }
}
