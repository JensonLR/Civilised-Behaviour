import { Mesh, MeshToonMaterial, type BufferGeometry, type Group } from "three";
import { PALETTE, ZONE, hashFloat, woundLevel, type ZoneId } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { frontZ, ringAt, upperArmRings, upperLegRings, type BodyCtx } from "./body.ts";
import { drapeCover, outerTorsoRings } from "./drape.ts";
import { faceSurfaceZ } from "./head.ts";
import { PartBuilder } from "./parts.ts";
import type { Ring } from "./loft.ts";
import { torsoSegments } from "./fit/surface.ts";
import { limbSurface, mountOn } from "./limbKit.ts";
import { foreArmRings, lowerLegPlan } from "./limbRings.ts";
import { sharedToonRamp } from "./outline.ts";

/** Player gore setting. "off" replaces every drop of red with dressings and iodine so wounds still read. */
export type GoreLevel = "full" | "reduced" | "off";

interface Palette {
  /** Fresh stain, older stain, drip. */
  fresh: number;
  old: number;
  drip: number;
  /** Multiplier on stain size. */
  size: number;
  drips: boolean;
}

const BANDAGE: number = PALETTE.material.bandage;
const BANDAGE_DIRTY: number = PALETTE.material.bandageDirty;

const PALETTES: Record<GoreLevel, Palette> = {
  full: { ...PALETTE.gore.full, size: 1, drips: true },
  reduced: { ...PALETTE.gore.reduced, size: 0.7, drips: false },
  // Iodine and grime: reads as "treated wound" with no blood at all.
  off: { ...PALETTE.gore.off, size: 0.85, drips: false },
};

/**
 * Bandages, plasters and stains for one body zone at one severity, as a single merged vertex-coloured geometry in the
 * BONE's local frame (same convention as the bone meshes: joint at the origin, +Y up, face toward -Z).
 *
 * Severity reads without any red: 1 = a plaster, 2 = a wrapped dressing, 3 = a bulky, blood-soaked wrap with a tail.
 * `gore` only recolours and resizes the stains. Returns undefined for severity 0.
 */
export function buildWoundGeometry(zone: ZoneId, severity: number, gore: GoreLevel, P: Proportions, spec: CharacterSpec): BufferGeometry | undefined {
  if (severity <= 0) return undefined;
  const sev = Math.min(3, Math.floor(severity));
  const pal = PALETTES[gore];
  const b = new PartBuilder();
  const stain = (x: number, y: number, z: number, w: number, h: number, color = sev >= 3 ? pal.fresh : pal.old): void => {
    b.sphere(1, color, [x, y, z], [w * pal.size, h * pal.size, 0.012]);
  };
  const plaster = (x: number, y: number, z: number, w: number, h: number, rotZ = 0.5): void => {
    b.box(w, h, 0.014, BANDAGE, [x, y, z], [0, 0, rotZ]);
    b.box(w * 0.36, h * 0.9, 0.018, BANDAGE_DIRTY, [x, y, z - 0.002], [0, 0, rotZ]); // the pad
  };
  /** A rolled edge of a dressing: a short, slightly proud open ring (a torus costs ~5x the triangles). */
  const edge = (r: number, y: number, sx = 1, sz = 1): void => {
    b.cylinder(r + 0.006, r + 0.006, 0.016, BANDAGE_DIRTY, [0, y, 0], undefined, [sx, 1, sz], true);
  };
  /** A cylindrical dressing around a limb between two fractions of its length. `radiusAt(f)` is the limb radius at fraction f. */
  const wrapLimb = (len: number, radiusAt: (f: number) => number, from: number, to: number, color = BANDAGE): void => {
    const pad = 0.014;
    b.cylinder(radiusAt(from) + pad, radiusAt(to) + pad, (to - from) * len, color, [0, -len * (from + to) * 0.5, 0], undefined, undefined, true);
    // rolled edges
    edge(radiusAt(from) + pad, -len * from);
    edge(radiusAt(to) + pad, -len * to);
  };
  /** Dangling tail of the bandage at the side of a limb. */
  const tail = (x: number, y: number, z: number, length: number): void => {
    b.box(0.03, length, 0.012, BANDAGE, [x, y - length / 2, z], [0, 0, 0.12]);
  };

  switch (zone) {
    case ZONE.TORSO: {
      const h = P.torsoHeight;
      const rings = outerTorsoRings(P, 0xffffff, spec.jacket); // (over a cape or poncho the dressing lies on the cloth a player sees)
      const sec = (y: number) => ringAt(rings, y);
      if (sev === 1) {
        const y = h * 0.66;
        const x = sec(y).rx * 0.3;
        plaster(x, y, frontZ(sec(y), x) - 0.012, 0.11, 0.055);
      } else {
        // A chest wrap hugging the torso section at its height.
        const top = sev === 2 ? 0.74 : 0.8;
        const bot = sev === 2 ? 0.56 : 0.46;
        const wy = h * (top + bot) * 0.5;
        const wh = h * (top - bot);
        const s = sec(wy);
        // the dressing wraps the very sections the torso is lofted from, with the same number of sides (so it never dips into a flat), 1.2 cm proud
        const ring = (y: number, lift: number, color: number): Ring => {
          const q = sec(y);
          return { y, rx: q.rx + lift, rz: q.rz + lift, cx: q.cx, cz: q.cz, pow: q.pow, color };
        };
        b.loft([ring(wy - wh / 2, 0.0075, BANDAGE), ring(wy, 0.012, BANDAGE), ring(wy + wh / 2, 0.0075, BANDAGE)], BANDAGE, undefined, undefined, undefined, { capTop: false, capBottom: false, segments: torsoSegments() });
        for (const [e, l] of [[wy + wh / 2, 0.0135], [wy - wh / 2, 0.0135]] as const) b.loft([ring(e - 0.008, l, BANDAGE_DIRTY), ring(e + 0.008, l, BANDAGE_DIRTY)], BANDAGE_DIRTY, undefined, undefined, undefined, { capTop: false, capBottom: false, segments: torsoSegments() });
        const fz = s.cz - (s.rz + 0.012) - 0.004;
        stain(s.rx * 0.3, wy, fz, sev === 2 ? 0.06 : 0.1, sev === 2 ? 0.07 : 0.13);
        if (sev === 3) {
          stain(-s.rx * 0.35, wy - wh * 0.15, fz + 0.004, 0.05, 0.06, pal.old);
          if (pal.drips) b.sphere(1, pal.drip, [s.rx * 0.3, wy - wh * 0.5 - 0.09, fz + 0.002], [0.016, 0.1, 0.008]);
        }
        // and one on the back so it reads from the follow camera
        stain(-s.rx * 0.2, wy, s.cz + (s.rz + 0.012) + 0.004, sev === 2 ? 0.05 : 0.09, sev === 2 ? 0.06 : 0.11);
      }
      break;
    }
    case ZONE.HEAD: {
      const R = P.headRadius;
      const cy = R;
      const side = spec.skin % 2 === 0 ? 1 : -1; // which cheek/temple: stable per character, so the same face is always marked the same way
      if (sev === 1) {
        const x = side * R * 0.5;
        const y = -R * 0.22;
        plaster(x, cy + y, faceSurfaceZ(P, y, x) - 0.012, R * 0.42, R * 0.2, side * 0.55);
      } else {
        // Head bandage: a band around the skull just above the brows, tied off with a knot and two tails at the side.
        const by = R * 0.5;
        const half = sev === 2 ? R * 0.15 : R * 0.24;
        // Hair sits ~12% proud of the skull; the band has to clear it or it disappears into the hair.
        const skullR = (y: number): number => R * Math.sqrt(Math.max(0.1, 1 - (y / (1.02 * R)) ** 2)) * (spec.hair === 0 ? 1 : 1.13) + 0.012;
        const rr = skullR(by);
        // Tapered so the band hugs the dome instead of floating like a bucket rim.
        b.cylinder(skullR(by + half), skullR(by - half), half * 2, BANDAGE, [0, cy + by, 0], undefined, undefined, true);
        edge(skullR(by + half), cy + by + half);
        edge(skullR(by - half), cy + by - half);
        b.sphere(0.03, BANDAGE, [side * rr * 0.9, cy + by, -rr * 0.35]);
        tail(side * rr * 0.92, cy + by, -rr * 0.3, R * 0.5);
        // A hat hides the band, so a cheek plaster keeps the wound readable under headwear.
        const cx = -side * R * 0.5;
        const cyy = -R * 0.22;
        plaster(cx, cy + cyy, faceSurfaceZ(P, cyy, cx) - 0.012, R * 0.42, R * 0.2, -side * 0.55);
        stain(side * rr * 0.4, cy + by + 0.005, -rr * 0.92, sev === 2 ? 0.05 : 0.085, half * 0.9);
        if (sev === 3) {
          stain(-side * rr * 0.3, cy + by, rr * 0.94, 0.07, half * 0.8, pal.old);
          // blood running down from under the wrap
          if (pal.drips) b.sphere(1, pal.drip, [side * rr * 0.4, cy + by - half - R * 0.28, faceSurfaceZ(P, by - half - R * 0.28, side * rr * 0.4) - 0.006], [0.018, R * 0.3, 0.008]);
        }
      }
      break;
    }
    case ZONE.ARM_L:
    case ZONE.ARM_R: {
      const sx = zone === ZONE.ARM_L ? -1 : 1;
      const len = P.armUpper;
      const armRings = upperArmRings(P, 0xffffff, spec.jacket);
      // Under a cape's or poncho's arm drape the dressing goes on the bare sleeve below the hem: fractions are remapped into [cover, 1].
      const cover = drapeCover(spec.jacket);
      const F = (f: number): number => cover + f * (1 - cover);
      const rad = (f: number): number => {
        const s = ringAt(armRings, -len * F(f));
        return (s.rx + s.rz) / 2;
      };
      if (sev === 1) {
        plaster(sx * rad(0.5) * 0.35, -len * F(0.5), -rad(0.5) - 0.01, 0.09, 0.05, 0.5);
      } else {
        wrapLimb(len, (f) => rad((f - cover) / (1 - cover || 1)), F(sev === 2 ? 0.3 : 0.15), F(sev === 2 ? 0.7 : 0.85));
        const zf = -rad(0.5) - 0.02;
        stain(sx * rad(0.5) * 0.25, -len * F(0.5), zf, sev === 2 ? 0.04 : 0.065, sev === 2 ? 0.055 : 0.1);
        stain(-sx * rad(0.5) * 0.1, -len * F(0.45), rad(0.5) + 0.02, 0.04, 0.07, pal.old); // back of the arm
        if (sev === 3) {
          tail(sx * (rad(0.5) + 0.012), -len * F(0.82), 0.0, 0.16);
          if (pal.drips) b.sphere(1, pal.drip, [sx * rad(0.8) * 0.2, -len * F(0.9), zf + 0.004], [0.014, 0.09, 0.008]);
        }
      }
      break;
    }
    case ZONE.LEG_L:
    case ZONE.LEG_R: {
      const sx = zone === ZONE.LEG_L ? -1 : 1;
      const len = P.legUpper;
      const ctx = { spec, P, skin: 0, jacketC: 0, trouserC: 0, shirtC: 0, armC: 0, accent: 0, burnt: 0, footH: 0, leather: 0 } satisfies BodyCtx;
      const legRings = upperLegRings(ctx);
      const rad = (f: number): number => {
        const s = ringAt(legRings, -len * f);
        return (s.rx + s.rz) / 2;
      };
      if (sev === 1) {
        plaster(sx * rad(0.5) * 0.3, -len * 0.5, -rad(0.5) - 0.01, 0.1, 0.055, -0.5);
      } else {
        wrapLimb(len, rad, sev === 2 ? 0.3 : 0.15, sev === 2 ? 0.7 : 0.88);
        const zf = -rad(0.5) - 0.02;
        stain(sx * rad(0.5) * 0.2, -len * 0.5, zf, sev === 2 ? 0.05 : 0.08, sev === 2 ? 0.065 : 0.12);
        stain(0, -len * 0.45, rad(0.5) + 0.02, 0.05, 0.08, pal.old);
        if (sev === 3) {
          tail(sx * (rad(0.5) + 0.012), -len * 0.8, 0.0, 0.2);
          if (pal.drips) b.sphere(1, pal.drip, [sx * rad(0.8) * 0.2, -len * 0.92, zf + 0.004], [0.016, 0.11, 0.008]);
        }
      }
      break;
    }
  }
  return b.build();
}


// ---- open wounds: a body that is down -----------------------------------------------------------------------------------------------------------------------------------

const mixHex = (a: number, b: number, t: number): number => {
  const ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Where an open wound sits on a zone's bone, in the bone's frame: a point on the front surface, the way it faces, and which way is down the limb. */
interface WoundSite {
  x: number;
  y: number;
  z: number;
  /** Euler XYZ that lays a flat disc on the surface there (Z along the outward normal). */
  rot: readonly [number, number, number];
}

const legCtx = (spec: CharacterSpec, P: Proportions): BodyCtx => ({ spec, P, skin: 0, jacketC: 0, trouserC: 0, shirtC: 0, armC: 0, accent: 0, burnt: 0, footH: 0, leather: 0 }) satisfies BodyCtx;

function woundSite(zone: ZoneId, sev: number, P: Proportions, spec: CharacterSpec): WoundSite | undefined {
  const ctx = legCtx(spec, P);
  switch (zone) {
    case ZONE.TORSO: {
      const h = P.torsoHeight;
      const rings = outerTorsoRings(P, 0xffffff, spec.jacket);
      const y = h * (sev >= 3 ? 0.56 : 0.64);
      const s = ringAt(rings, y);
      const x = s.rx * 0.32;
      return { x, y, z: frontZ(s, x) - 0.004, rot: [0, 0, 0] };
    }
    case ZONE.HEAD: {
      const R = P.headRadius;
      const side = spec.skin % 2 === 0 ? 1 : -1;
      const y = -R * 0.18;
      const x = side * R * 0.5;
      return { x, y: R + y, z: faceSurfaceZ(P, y, x) - 0.004, rot: [0, side * -0.45, 0] };
    }
    case ZONE.ARM_L:
    case ZONE.ARM_R: {
      const sx = zone === ZONE.ARM_L ? -1 : 1;
      const m = mountOn(limbSurface(upperArmRings(P, 0xffffff, spec.jacket)), sx * 0.35, -P.armUpper * 0.55, 0.004);
      return { x: m.pos[0], y: m.pos[1], z: m.pos[2], rot: m.rot };
    }
    default: {
      const sx = zone === ZONE.LEG_L ? -1 : 1;
      const m = mountOn(limbSurface(upperLegRingsOf(ctx)), sx * 0.3, -P.legUpper * 0.5, 0.004);
      return { x: m.pos[0], y: m.pos[1], z: m.pos[2], rot: m.rot };
    }
  }
}
const upperLegRingsOf = (c: BodyCtx): Ring[] => upperLegRings(c);

/** The size of an open wound by severity (half-axes, metres): a cut, a gash, a tear. */
const OPEN_SIZE: readonly (readonly [number, number])[] = [[0, 0], [0.024, 0.02], [0.036, 0.058], [0.055, 0.085]];

/**
 * An OPEN wound in the bone's frame, for a body that is down (the living wear dressings): a raised, torn lip, a sunken dark cavity, a wet highlight and drips while it is fresh, a
 * dark crust and a dull sheen once it has dried. `dryness` 0 = just made, 1 = long dried (minutes of lying there: the integrator maps the body's time down). `gore`:
 * full draws the whole wound; reduced a plain dark blotch of the palette's reduced brown with no lip, hole or drip; off draws NOTHING (iodine and grime, no red: the dressings
 * carry the injury). Returns undefined for severity 0 and for Off.
 */
export function buildOpenWoundGeometry(zone: ZoneId, severity: number, gore: GoreLevel, dryness: number, P: Proportions, spec: CharacterSpec): BufferGeometry | undefined {
  const sev = Math.min(3, Math.floor(severity));
  if (sev <= 0 || gore === "off") return undefined;
  const site = woundSite(zone, sev, P, spec);
  if (!site) return undefined;
  const dry = Math.min(1, Math.max(0, dryness));
  const [rw, rh] = OPEN_SIZE[sev]!;
  const tone = PALETTE.gore[gore];
  const b = new PartBuilder();
  const at = (dz: number): [number, number, number] => [site.x, site.y, site.z + dz];
  if (gore === "reduced") {
    b.sphere(1, mixHex(tone.fresh, tone.old, dry), at(-0.002), [rw * 0.9, rh * 0.9, 0.008], site.rot);
    return b.build();
  }
  // the torn lip: a raised oval of dull flesh going dark as it dries, and a crust ring once it has
  const lip = mixHex(PALETTE.face.tongue, tone.old, 0.35 + 0.6 * dry);
  b.sphere(1, lip, at(-0.003), [rw * 1.3, rh * 1.3, 0.012], site.rot);
  if (dry > 0.45) b.sphere(1, mixHex(tone.old, PALETTE.material.soot, 0.5), at(-0.002), [rw * 1.5, rh * 1.5, 0.008], site.rot);
  // the cavity: dark, sunk, nearer the viewer than the lip so the lip reads as a rim round a hole
  b.sphere(1, mixHex(PALETTE.face.cavity, tone.fresh, 0.35 * (1 - dry)), at(-0.009), [rw * 0.78, rh * 0.8, 0.007], site.rot);
  // the wet highlight and the drips: only while it is fresh
  if (dry < 0.7) {
    const wet = 1 - dry / 0.7;
    b.sphere(1, tone.fresh, at(-0.013), [rw * 0.22 * wet + 0.002, rh * 0.18 * wet + 0.002, 0.004], [site.rot[0], site.rot[1], site.rot[2]]);
    if (sev >= 2) {
      const len = (0.03 + 0.05 * sev) * wet;
      b.sphere(1, tone.drip, [site.x + rw * 0.2, site.y - rh - len * 0.5, site.z - 0.008], [0.011, len, 0.006]);
      if (sev === 3) b.sphere(1, tone.drip, [site.x - rw * 0.35, site.y - rh * 0.9 - len * 0.35, site.z - 0.007], [0.009, len * 0.7, 0.006]);
    }
  }
  return b.build();
}

// ---- grime: mud and soot by exposure ------------------------------------------------------------------------------------------------------------------------------------

/** The parts of a body that wear grime, each in its own bone's frame (an arm is two bones, a leg two, so mud climbs from the boot). */
export type GrimePart = "torso" | "head" | "upperArm" | "foreArm" | "thigh" | "shin";

/** Exposure (0..1) to a level 0..3: a first splash, a muddy hem, caked to the knee. The thresholds only ever make it show LATER than the exposure (a level needs real exposure). */
export function grimeLevel(exposure: number): 0 | 1 | 2 | 3 {
  return exposure >= 0.75 ? 3 : exposure >= 0.4 ? 2 : exposure >= 0.12 ? 1 : 0;
}

/** What a body has been through, as two accumulators 0..1. */
export interface Exposure {
  mud: number;
  soot: number;
}

/** What the world is doing to a body this instant: `mud` 0..1 how muddy the ground underfoot is, `moving` it is walking or running, `blast` 0..1 how near a blast or a fire, `rain` 0..1, `washing` standing in water. */
export interface ExposureInput {
  mud: number;
  moving: boolean;
  blast: number;
  rain: number;
  washing: boolean;
}

/** Advances a body's exposure by `dt` seconds. Mud collects only while walking on mud (a minute of it makes a level 3) and dries and flakes slowly; soot collects near blasts and fires and only rain and water wash it. Allocation-free. */
export function stepExposure(e: Exposure, dt: number, w: ExposureInput): void {
  if (!(dt > 0)) return;
  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  e.mud = clamp01(e.mud + (w.moving ? w.mud * dt * 0.016 : 0) - dt * (0.0008 + (w.washing ? 0.2 : 0) + w.rain * 0.002));
  e.soot = clamp01(e.soot + w.blast * dt * 0.1 - dt * (0.0003 + (w.washing ? 0.15 : 0) + w.rain * 0.0025));
}

const MUD_TONES = [PALETTE.world.dirtDark, PALETTE.world.mud, PALETTE.world.dirt] as const;
const SOOT_TONES = [PALETTE.camp.charred, PALETTE.camp.charred, PALETTE.material.soot] as const;

/**
 * Mud and soot on one part of a body, as one merged geometry in that bone's frame (undefined when both levels are 0). Mud climbs from the ground: level 1 splashes the boots and
 * shins, 2 the thighs, forearms and the coat's hem, 3 cakes all of it and flecks the face; soot starts as streaks on the cheeks, then smears the chest and forearms, and at 3 darkens the
 * face. Marks are SMALL and many (splashes, streaks), never big round spots: a coat should look dirty, not spotted. They are flat blobs on the real surface of each part (the same ring
 * tables the limbs are lofted from), from a hash of the look, so a body always wears the same marks and they never float.
 */
export function buildGrimeGeometry(part: GrimePart, side: "L" | "R", mud: number, soot: number, P: Proportions, spec: CharacterSpec): BufferGeometry | undefined {
  const mudL = Math.min(3, Math.max(0, Math.floor(mud)));
  const sootL = Math.min(3, Math.max(0, Math.floor(soot)));
  if (mudL === 0 && sootL === 0) return undefined;
  const seed = ((spec.height | 0) * 31 + (spec.torsoWidth | 0) * 17 + (spec.skin | 0) * 7 + (spec.hair | 0)) | 0;
  const sx = side === "L" ? -1 : 1;
  const ctx = legCtx(spec, P);
  const b = new PartBuilder();
  let k = 0;
  const hf = (i: number): number => hashFloat(seed, k * 7 + (part.length + (side === "L" ? 3 : 0)) * 101, i);
  /** A flat blob on a limb's surface: azimuth phi (0 front, +pi/2 right), height y, half width w and half height h. */
  const blob = (surf: ReturnType<typeof limbSurface>, phi: number, y: number, w: number, h: number, color: number, thick = 0.012): void => {
    const m = mountOn(surf, phi, y, 0.003);
    b.sphere(1, color, m.pos, [w, h, thick], m.rot);
    k++;
  };
  const tone = (list: readonly number[]): number => list[Math.floor(hf(5) * list.length) % list.length]!;
  /** A splash of mud: one blot and a few flecks thrown above it (mud is thrown UP from the ground). */
  const splash = (surf: ReturnType<typeof limbSurface>, phi: number, y: number, w: number): void => {
    const c = tone(MUD_TONES);
    blob(surf, phi, y, w, w * (0.7 + 0.4 * hf(1)), c);
    for (let i = 0; i < 2; i++) blob(surf, phi + (hf(2 + i) - 0.5) * w * 4, y + w * (1.2 + 2.2 * hf(6 + i)), w * 0.3, w * 0.28, c, 0.01);
  };
  const mudBand = (surf: ReturnType<typeof limbSurface>, yTop: number, yBot: number, count: number, w: number): void => {
    for (let i = 0; i < count; i++) splash(surf, (hf(10 + i) - 0.5) * Math.PI * 1.8 + (sx > 0 ? 0.15 : -0.15), yBot + (yTop - yBot) * hf(30 + i) ** 1.6, w * (0.7 + 0.7 * hf(50 + i)));
  };
  /** A streak of soot: narrow and long, running down. */
  const streak = (surf: ReturnType<typeof limbSurface>, phi: number, y: number, w: number, h: number): void => blob(surf, phi, y, w, h, tone(SOOT_TONES), 0.01);
  switch (part) {
    case "shin": {
      const plan = lowerLegPlan(ctx);
      const surf = limbSurface(plan.surface);
      const len = P.legLower;
      // (y runs down the bone from the knee: 0 at the knee, -len at the ankle)
      if (mudL >= 1) mudBand(surf, -len * 0.7, -len * 0.99, 1 + mudL * 2, 0.02 + 0.006 * mudL);
      if (mudL >= 2) mudBand(surf, -len * 0.25, -len * 0.7, mudL, 0.026);
      break;
    }
    case "thigh": {
      const surf = limbSurface(upperLegRingsOf(ctx));
      const len = P.legUpper;
      if (mudL >= 2) mudBand(surf, -len * 0.6, -len * 0.98, 1 + mudL, 0.026);
      if (mudL >= 3) mudBand(surf, -len * 0.15, -len * 0.6, 2, 0.028);
      break;
    }
    case "foreArm": {
      const surf = limbSurface(foreArmRings(ctx));
      const len = P.armLower;
      if (mudL >= 2) mudBand(surf, -len * 0.55, -len * 0.97, 1 + mudL, 0.02);
      if (sootL >= 2) for (let i = 0; i < sootL; i++) streak(surf, (hf(70 + i) - 0.5) * 2.2, -len * (0.2 + 0.6 * hf(80 + i)), 0.009 + 0.003 * sootL, 0.03 + 0.025 * hf(85 + i));
      break;
    }
    case "upperArm": {
      const surf = limbSurface(upperArmRingsOf(P, spec));
      if (sootL >= 3) for (let i = 0; i < 2; i++) streak(surf, (hf(90 + i) - 0.5) * 2, -P.armUpper * (0.25 + 0.5 * hf(95 + i)), 0.011, 0.04);
      if (mudL >= 3) mudBand(surf, -P.armUpper * 0.5, -P.armUpper * 0.95, 2, 0.022);
      break;
    }
    case "torso": {
      const h = P.torsoHeight;
      const rings = outerTorsoRings(P, 0xffffff, spec.jacket);
      const front = (y: number, x: number, w: number, hh: number, color: number, thick: number): void => {
        const s = ringAt(rings, y);
        b.sphere(1, color, [x, y, frontZ(s, x) - 0.003], [w, hh, thick]);
        k++;
      };
      // the hem is splashed from the ground; the chest and shoulders are smeared where a man has wiped his hands and leant on a burnt wall
      if (mudL >= 2) for (let i = 0; i < 1 + mudL * 2; i++) front(h * (0.03 + 0.2 * hf(110 + i) ** 1.5), (hf(120 + i) - 0.5) * P.torsoWidth * 0.85, 0.016 + 0.02 * hf(130 + i), 0.02 + 0.02 * hf(135 + i), tone(MUD_TONES), 0.012);
      if (sootL >= 2) for (let i = 0; i < sootL * 2; i++) front(h * (0.4 + 0.45 * hf(140 + i)), (hf(150 + i) - 0.5) * P.torsoWidth * 0.75, 0.012 + 0.012 * hf(160 + i), 0.04 + 0.05 * hf(165 + i), tone(SOOT_TONES), 0.01);
      break;
    }
    case "head": {
      const R = P.headRadius;
      // the face: finger-wide smears across the cheeks and brow, below the eyes' line; flecks of mud at the worst
      const smear = (y: number, x: number, w: number, hh: number, color: number): void => {
        b.sphere(1, color, [x, R + y, faceSurfaceZ(P, y, x) - 0.003], [w, hh, 0.008]);
        k++;
      };
      if (sootL >= 1) for (let i = 0; i < sootL * 2; i++) smear(-R * (0.28 + 0.4 * hf(170 + i)), (hf(180 + i) < 0.5 ? -1 : 1) * R * (0.28 + 0.3 * hf(185 + i)), R * (0.1 + 0.05 * sootL * hf(190 + i)), R * 0.035, tone(SOOT_TONES));
      if (mudL >= 3) for (let i = 0; i < 3; i++) smear(-R * (0.3 + 0.5 * hf(200 + i)), (hf(210 + i) - 0.5) * R * 0.9, R * 0.045, R * 0.04, tone(MUD_TONES));
      break;
    }
  }
  return b.build();
}
const upperArmRingsOf = (P: Proportions, spec: CharacterSpec): Ring[] => upperArmRings(P, 0xffffff, spec.jacket);

// ---- the marks on a body ------------------------------------------------------------------------------------------------------------------------------------------------

/** What a body wears right now: the wound mask shown OPEN (a body that is down; 0 for the living, who wear dressings), how dry those wounds are, mud and soot levels, the gore setting. */
export interface MarkState {
  open: number;
  dryness: number;
  mud: number;
  soot: number;
  gore: GoreLevel;
}

/** The parts of a rig that carry marks (a `CharacterRig` has all of them). */
export interface MarkRig {
  joints: { torso: Group; head: Group; shoulderL: Group; shoulderR: Group; elbowL: Group; elbowR: Group; hipL: Group; hipR: Group; kneeL: Group; kneeR: Group };
  proportions: Proportions;
  spec: CharacterSpec;
}

let marksMaterial: MeshToonMaterial | undefined;
const marksMat = (): MeshToonMaterial => (marksMaterial ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }));

/**
 * The open wounds and the grime on one body, hung on its bones (one mesh per bone, made on first need and re-made only when its own inputs change). The integrator drives it from
 * the actor: `set({ open, dryness, mud, soot, gore })`; calling it every frame with an unchanged state does nothing. A lost limb's dressing is the rig's business, the marks stay.
 */
export class BodyMarks {
  private readonly meshes = new Map<string, Mesh>();
  private readonly keys = new Map<string, string>();
  private readonly owned = new Set<BufferGeometry>();

  constructor(private readonly rig: MarkRig) {}

  /** How many marks meshes are alive (visible) right now. */
  get meshCount(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.visible) n++;
    return n;
  }

  set(s: MarkState): void {
    const { joints: j, proportions: P, spec } = this.rig;
    const dryB = Math.min(3, Math.floor(Math.min(1, Math.max(0, s.dryness)) * 4)); // dryness in quarters: the wound is re-made four times in its life, not every frame
    const open = (zone: ZoneId, bone: Group): void => {
      const sev = woundLevel(s.open, zone);
      this.put(`open${zone}`, bone, `${sev}|${s.gore}|${dryB}`, () => (sev > 0 ? buildOpenWoundGeometry(zone, sev, s.gore, dryB / 3, P, spec) : undefined));
    };
    open(ZONE.HEAD, j.head);
    open(ZONE.TORSO, j.torso);
    open(ZONE.ARM_L, j.shoulderL);
    open(ZONE.ARM_R, j.shoulderR);
    open(ZONE.LEG_L, j.hipL);
    open(ZONE.LEG_R, j.hipR);
    const mud = Math.min(3, Math.max(0, Math.floor(s.mud)));
    const soot = Math.min(3, Math.max(0, Math.floor(s.soot)));
    const grime = (name: string, bone: Group, part: GrimePart, side: "L" | "R"): void => {
      this.put(`grime${name}`, bone, `${mud}|${soot}`, () => buildGrimeGeometry(part, side, mud, soot, P, spec));
    };
    grime("torso", j.torso, "torso", "L");
    grime("head", j.head, "head", "L");
    grime("upperArmL", j.shoulderL, "upperArm", "L");
    grime("upperArmR", j.shoulderR, "upperArm", "R");
    grime("foreArmL", j.elbowL, "foreArm", "L");
    grime("foreArmR", j.elbowR, "foreArm", "R");
    grime("thighL", j.hipL, "thigh", "L");
    grime("thighR", j.hipR, "thigh", "R");
    grime("shinL", j.kneeL, "shin", "L");
    grime("shinR", j.kneeR, "shin", "R");
  }

  private put(name: string, bone: Group, key: string, make: () => BufferGeometry | undefined): void {
    if (this.keys.get(name) === key) return;
    this.keys.set(name, key);
    let m = this.meshes.get(name);
    const old = m?.geometry;
    const geo = make();
    if (!geo) {
      if (m) m.visible = false;
      if (old) {
        old.dispose();
        this.owned.delete(old);
      }
      return;
    }
    if (!m) {
      m = new Mesh(geo, marksMat());
      m.name = `marks_${name}`;
      m.castShadow = false;
      bone.add(m);
      this.meshes.set(name, m);
    } else {
      m.geometry = geo;
      old?.dispose();
      if (old) this.owned.delete(old);
    }
    this.owned.add(geo);
    m.visible = true;
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.removeFromParent();
    for (const g of this.owned) g.dispose();
    this.meshes.clear();
    this.keys.clear();
    this.owned.clear();
  }
}
