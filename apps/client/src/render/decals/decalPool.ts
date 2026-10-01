import type { GoreLevel } from "@cb/procedural/three";
import { PALETTE, hashFloat } from "@cb/shared";

/**
 * The persistent marks a fight leaves on the field, as a pure fixed-size pool (no three.js here: `DecalField.ts` draws it). The jolly look needs its counterweight to
 * STAY: a pool of blood that spreads and dries and darkens over minutes, spray on a wall, a drag mark behind a body, soot where a shell fell, mud from hooves.
 *
 * - Fixed capacity by graphics preset; struct-of-arrays; `add` and `update` allocate nothing.
 * - Each mark has a PRIORITY (a pool outranks a mud splash). When the pool is full the oldest mark of the lowest priority that is not outranked by the newcomer is
 *   evicted, and the freshest pool is never evicted; a newcomer outranked by everything is dropped. Lifetime also follows priority (mud 40 s .. pools 10 minutes).
 * - Deterministic: every random detail of a mark is `hashFloat(seed, serial, k)`, so the same seed and the same calls draw the same field (a replay, a screenshot).
 * - Gore Full / Reduced / Off is applied at DRAW time from the current level, so changing the setting changes the field at once: Reduced is brown and smaller with no spray;
 *   Off draws a blood mark as a plain patch of grime and hides spray, spatter and drag: no red anywhere, and nothing needs it to read.
 */

export const DECAL = { POOL: 0, SPATTER: 1, SPRAY: 2, DRAG: 3, SCORCH: 4, MUD: 5 } as const;
export type DecalKind = (typeof DECAL)[keyof typeof DECAL];

export type DecalPreset = "low" | "medium" | "high";
/** Marks kept alive at once, by graphics preset. */
export const DECAL_CAP: Record<DecalPreset, number> = { low: 96, medium: 192, high: 320 };

/** Higher outlasts lower. */
export const DECAL_PRIORITY: Record<DecalKind, number> = { [DECAL.MUD]: 0, [DECAL.SPATTER]: 1, [DECAL.SPRAY]: 1, [DECAL.SCORCH]: 2, [DECAL.DRAG]: 3, [DECAL.POOL]: 4 };
/** Seconds a mark lasts (the last 15% fades). */
export const DECAL_LIFE: Record<DecalKind, number> = { [DECAL.MUD]: 40, [DECAL.SPATTER]: 90, [DECAL.SPRAY]: 150, [DECAL.SCORCH]: 240, [DECAL.DRAG]: 180, [DECAL.POOL]: 600 };
/** Which kinds are blood (and so change with the gore setting). */
export const IS_BLOOD: Record<DecalKind, boolean> = { [DECAL.POOL]: true, [DECAL.SPATTER]: true, [DECAL.SPRAY]: true, [DECAL.DRAG]: true, [DECAL.SCORCH]: false, [DECAL.MUD]: false };

/** Floats per instance in each render buffer (the four attributes `DecalField` binds). */
export const DECAL_ATTR = 4;

// ---- colours (linear, from the palette: no literals) ------------------------------------------------------------------------------------

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** 0xRRGGBB (sRGB) to linear floats into `out[o..o+2]`. */
export function hexToLinear(hex: number, out: Float32Array | number[], o = 0): void {
  out[o] = lin(((hex >> 16) & 255) / 255);
  out[o + 1] = lin(((hex >> 8) & 255) / 255);
  out[o + 2] = lin((hex & 255) / 255);
}

/** Linear blend of two hex colours (in sRGB space: the way the palette's own tints are chosen) as a hex number. */
function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface Tone {
  fresh: number;
  dry: number;
}

/** Blood tones by level: the palette's own stain colours; the dry end is darkened toward soot. Off is grime, deliberately not red. */
const BLOOD: Record<GoreLevel, Tone> = {
  full: { fresh: PALETTE.gore.full.fresh, dry: mixHex(PALETTE.gore.full.old, PALETTE.material.soot, 0.45) },
  reduced: { fresh: PALETTE.gore.reduced.fresh, dry: mixHex(PALETTE.gore.reduced.old, PALETTE.material.soot, 0.35) },
  off: { fresh: PALETTE.world.dirtDark, dry: mixHex(PALETTE.world.dirtDark, PALETTE.world.dust, 0.4) },
};
const SCORCH: Tone = { fresh: PALETTE.material.soot, dry: mixHex(PALETTE.camp.charred, PALETTE.camp.ash, 0.45) };
const MUD: Tone = { fresh: PALETTE.world.mud, dry: mixHex(PALETTE.world.dirt, PALETTE.world.dust, 0.5) };

/** What a kind looks like at a gore level: undefined = not drawn. Sizes multiply the mark's own. */
export interface DecalStyle {
  tone: Tone;
  size: number;
  /** Drawn with the wet highlight while fresh. */
  glossy: boolean;
}

// (built once: `styleFor` runs for every live mark every frame and must allocate nothing)
const STYLE_SCORCH: DecalStyle = { tone: SCORCH, size: 1, glossy: false };
const STYLE_MUD: DecalStyle = { tone: MUD, size: 1, glossy: false };
const STYLE_FULL: DecalStyle = { tone: BLOOD.full, size: 1, glossy: true };
const STYLE_REDUCED_POOL: DecalStyle = { tone: BLOOD.reduced, size: 0.7, glossy: false };
const STYLE_REDUCED: DecalStyle = { tone: BLOOD.reduced, size: 0.65, glossy: false };
const STYLE_OFF_POOL: DecalStyle = { tone: BLOOD.off, size: 0.55, glossy: false };

export function styleFor(kind: DecalKind, gore: GoreLevel): DecalStyle | undefined {
  if (kind === DECAL.SCORCH) return STYLE_SCORCH;
  if (kind === DECAL.MUD) return STYLE_MUD;
  switch (gore) {
    case "full":
      return STYLE_FULL;
    case "reduced":
      return kind === DECAL.SPRAY ? undefined : kind === DECAL.POOL ? STYLE_REDUCED_POOL : STYLE_REDUCED;
    case "off":
      return kind === DECAL.POOL ? STYLE_OFF_POOL : undefined;
  }
}

/** Per-kind timing: seconds a mark takes to spread to its full size, to start drying, and to finish drying. */
const TIMING: Record<DecalKind, { spread: number; wet: number; dry: number }> = {
  [DECAL.POOL]: { spread: 7, wet: 14, dry: 70 },
  [DECAL.SPATTER]: { spread: 0.25, wet: 8, dry: 30 },
  [DECAL.SPRAY]: { spread: 0.18, wet: 8, dry: 30 },
  [DECAL.DRAG]: { spread: 0.4, wet: 10, dry: 50 },
  [DECAL.SCORCH]: { spread: 0.5, wet: 0, dry: 200 },
  [DECAL.MUD]: { spread: 0.2, wet: 6, dry: 30 },
};

const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/** The pool of marks. Own the arrays the renderer binds; call `update(dt)` once a frame. */
export class DecalPool {
  // render buffers (bound by DecalField as instanced attributes)
  /** xyz position, size (the radius of the mark; for a stretched mark its half WIDTH). */
  readonly pos: Float32Array;
  /** tangent xyz (the mark's long axis, in the surface), aspect (length / width). */
  readonly axis: Float32Array;
  /** surface normal xyz, seed (0..1). */
  readonly norm: Float32Array;
  /** rgb (linear), alpha. */
  readonly col: Float32Array;
  /** kind, wetness 0..1 (1 = fresh and glossy), spread 0..1, unused. */
  readonly info: Float32Array;
  /** One past the highest live slot: how many instances to draw. */
  drawn = 0;

  // state
  private readonly alive: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly born: Float32Array;
  private readonly size: Float32Array;
  private readonly aspect: Float32Array;
  private readonly tint: Float32Array;
  private readonly serialOf: Uint32Array;
  private readonly life: Float32Array;
  private readonly spreadT: Float32Array;
  private readonly wetT: Float32Array;
  private readonly dryT: Float32Array;
  private readonly grow: Float32Array;
  private readonly gloss: Float32Array;
  private now = 0;
  private serial = 0;
  private freshestPool = -1;
  private goreLevel: GoreLevel = "full";
  // drag trackers (a fixed table: a body dragged leaves a mark every half metre or so)
  private readonly dragKey = new Int32Array(8).fill(-1);
  private readonly dragX = new Float32Array(8);
  private readonly dragZ = new Float32Array(8);
  private readonly dragLeft = new Float32Array(8);
  private nextDrag = 0;

  constructor(
    readonly cap: number,
    readonly seed: number,
  ) {
    this.pos = new Float32Array(cap * DECAL_ATTR);
    this.axis = new Float32Array(cap * DECAL_ATTR);
    this.norm = new Float32Array(cap * DECAL_ATTR);
    this.col = new Float32Array(cap * DECAL_ATTR);
    this.info = new Float32Array(cap * DECAL_ATTR);
    this.alive = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.born = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.aspect = new Float32Array(cap);
    this.tint = new Float32Array(cap);
    this.serialOf = new Uint32Array(cap);
    this.life = new Float32Array(cap);
    this.spreadT = new Float32Array(cap);
    this.wetT = new Float32Array(cap);
    this.dryT = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.gloss = new Float32Array(cap);
  }

  get gore(): GoreLevel {
    return this.goreLevel;
  }

  /** Marks alive (counting the ones the current gore level hides). */
  get count(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.alive[i]) n++;
    return n;
  }

  /** Marks alive of one kind. */
  countOf(kind: DecalKind): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.alive[i] && this.kind[i] === kind) n++;
    return n;
  }

  /** Marks the current gore level actually draws. */
  get visible(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.alive[i] && this.col[i * DECAL_ATTR + 3]! > 0.001) n++;
    return n;
  }

  /** Gore level changed: blood marks recolour or hide at the next `update`. */
  setGore(level: GoreLevel): void {
    this.goreLevel = level;
  }

  clear(): void {
    this.alive.fill(0);
    this.col.fill(0);
    this.pos.fill(0);
    this.drawn = 0;
    this.freshestPool = -1;
    this.dragKey.fill(-1);
  }

  /** The age in seconds of slot i, or -1 when it is free (for tests and the debug overlay). */
  ageOf(i: number): number {
    return this.alive[i] ? this.now - this.born[i]! : -1;
  }

  kindOf(i: number): number {
    return this.alive[i] ? this.kind[i]! : -1;
  }

  private rnd(k: number): number {
    return hashFloat(this.seed, this.serial, k);
  }

  /** A slot for a mark of this kind: a free one, else the oldest of the lowest priority that the newcomer does not rank below. -1 = rejected. */
  private slotFor(kind: DecalKind): number {
    for (let i = 0; i < this.cap; i++) if (!this.alive[i]) return i;
    const pri = DECAL_PRIORITY[kind];
    let best = -1;
    for (let i = 0; i < this.cap; i++) {
      if (i === this.freshestPool) continue; // (the pool a body is still lying in is never taken away)
      const p = DECAL_PRIORITY[this.kind[i] as DecalKind];
      if (p > pri) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const pb = DECAL_PRIORITY[this.kind[best] as DecalKind];
      if (p < pb || (p === pb && this.born[i]! < this.born[best]!)) best = i;
    }
    return best;
  }

  /**
   * Adds a mark. `(x, y, z)` on the surface with unit normal `(nx, ny, nz)`; `dx, dy, dz` the direction its long axis (or its spray) runs (any length; zero = a hash-chosen
   * angle); `size` the radius in metres; `aspect` length over width (1 = round); `extra` how much longer to spread/dry than usual (a pool fed by a bleeding body). Returns the slot, or -1.
   */
  add(kind: DecalKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, size: number, aspect = 1, extra = 1): number {
    if (!(size > 0) || !Number.isFinite(x + y + z + nx + ny + nz + dx + dy + dz + size + aspect)) return -1;
    this.serial++;
    const i = this.slotFor(kind);
    if (i < 0) return -1;
    // the surface basis: the normal, and the tangent the long axis runs along (the direction projected into the surface)
    let ul = Math.hypot(nx, ny, nz);
    if (ul < 1e-6) {
      nx = 0;
      ny = 1;
      nz = 0;
      ul = 1;
    }
    nx /= ul;
    ny /= ul;
    nz /= ul;
    let tx = dx - nx * (dx * nx + dy * ny + dz * nz);
    let ty = dy - ny * (dx * nx + dy * ny + dz * nz);
    let tz = dz - nz * (dx * nx + dy * ny + dz * nz);
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-4) {
      // no direction given: a hash-chosen angle round the normal (any vector not parallel to it will do as the first axis)
      const ax = Math.abs(ny) < 0.9 ? 0 : 1;
      const ay = Math.abs(ny) < 0.9 ? 1 : 0;
      // e = (a x n) normalised, f = n x e: two axes in the surface
      let ex = ay * nz;
      let ey = -ax * nz;
      let ez = ax * ny - ay * nx;
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el;
      ey /= el;
      ez /= el;
      const fx = ny * ez - nz * ey;
      const fy = nz * ex - nx * ez;
      const fz = nx * ey - ny * ex;
      const a = this.rnd(1) * Math.PI * 2;
      tx = ex * Math.cos(a) + fx * Math.sin(a);
      ty = ey * Math.cos(a) + fy * Math.sin(a);
      tz = ez * Math.cos(a) + fz * Math.sin(a);
      tl = 1;
    }
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const o = i * DECAL_ATTR;
    const tm = TIMING[kind];
    this.alive[i] = 1;
    this.kind[i] = kind;
    this.born[i] = this.now;
    this.size[i] = size * (0.9 + 0.2 * this.rnd(2));
    this.aspect[i] = aspect;
    this.tint[i] = this.rnd(3) - 0.5;
    this.serialOf[i] = this.serial;
    this.life[i] = DECAL_LIFE[kind] * (0.9 + 0.2 * this.rnd(4));
    this.spreadT[i] = tm.spread * extra;
    this.wetT[i] = (tm.wet === 0 ? 0 : tm.wet * (0.8 + 0.4 * this.rnd(5))) * extra;
    this.dryT[i] = tm.dry * (0.8 + 0.4 * this.rnd(6)) * extra;
    this.grow[i] = kind === DECAL.POOL ? 0.25 : 1;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = 0;
    this.axis[o] = tx;
    this.axis[o + 1] = ty;
    this.axis[o + 2] = tz;
    this.axis[o + 3] = aspect;
    this.norm[o] = nx;
    this.norm[o + 1] = ny;
    this.norm[o + 2] = nz;
    this.norm[o + 3] = this.rnd(7);
    this.info[o] = kind;
    this.info[o + 1] = 1;
    this.info[o + 2] = 0;
    this.info[o + 3] = 0;
    this.col[o + 3] = 0;
    if (kind === DECAL.POOL) this.freshestPool = i;
    if (i >= this.drawn) this.drawn = i + 1;
    this.paint(i);
    return i;
  }

  // ---- the marks, by what made them -----------------------------------------------------------------------------------------------

  /** A pool of blood where a body lies: spreads over seconds to `radius`, `fed` > 1 for a body that keeps bleeding. */
  pool(x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, fed = 1): number {
    return this.add(DECAL.POOL, x, y, z, nx, ny, nz, 0, 0, 0, radius, 1, fed);
  }

  /** Drops of blood thrown from a wound along (dx, dz) on the ground. */
  spatter(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dz: number, radius: number): number {
    return this.add(DECAL.SPATTER, x, y, z, nx, ny, nz, dx, 0, dz, radius, 1.3);
  }

  /** A fan of spray on a surface (a wall, the ground) from a wound: `dx, dy, dz` the way it was thrown; on a wall it runs down. */
  spray(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, length: number): number {
    return this.add(DECAL.SPRAY, x, y, z, nx, ny, nz, dx, dy, dz, length * 0.5, 2.1);
  }

  /**
   * A body is being dragged: call every frame with its position and the direction it moves; a smear is laid every ~0.5 m, paler the further it has gone from the wound
   * (`blood` metres of trail the body has in it; 0 = a mark in the dirt, no blood). `key` tells dragged bodies apart (an entity id). Returns true when a mark was laid.
   */
  dragStep(key: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dz: number, blood: number): boolean {
    let s = -1;
    for (let k = 0; k < 8; k++) if (this.dragKey[k] === key) s = k;
    if (s < 0) {
      s = this.nextDrag;
      this.nextDrag = (this.nextDrag + 1) % 8;
      this.dragKey[s] = key;
      this.dragX[s] = x;
      this.dragZ[s] = z;
      this.dragLeft[s] = blood;
      return false;
    }
    const d = Math.hypot(x - this.dragX[s]!, z - this.dragZ[s]!);
    if (d < 0.5) return false;
    const len = Math.hypot(dx, dz);
    const ux = len > 1e-4 ? dx / len : x - this.dragX[s]!;
    const uz = len > 1e-4 ? dz / len : z - this.dragZ[s]!;
    const mx = (x + this.dragX[s]!) / 2;
    const mz = (z + this.dragZ[s]!) / 2;
    this.dragX[s] = x;
    this.dragZ[s] = z;
    // the smear is laid between the two points, with the width of a body
    const placed = this.add(DECAL.DRAG, mx, y, mz, nx, ny, nz, ux, 0, uz, 0.22, Math.max(2, (d * 0.8) / 0.22));
    if (placed >= 0) this.gloss[placed] = Math.max(0.15, Math.min(1, this.dragLeft[s]! / Math.max(1, blood)));
    this.dragLeft[s] = Math.max(0, this.dragLeft[s]! - d);
    return placed >= 0;
  }

  /** Where a shell fell: a scorched disc with soot rays, `radius` metres across. */
  scorch(x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number): number {
    return this.add(DECAL.SCORCH, x, y, z, nx, ny, nz, 0, 0, 0, radius);
  }

  /** Mud thrown by a hoof or a boot, heading along (dx, dz). */
  mud(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dz: number, radius: number): number {
    return this.add(DECAL.MUD, x, y, z, nx, ny, nz, dx, 0, dz, radius, 1.2);
  }

  // ---- the frame --------------------------------------------------------------------------------------------------------------------

  /** Writes the colour, size and wetness of one live mark for the current time and gore level. */
  private paint(i: number): void {
    const o = i * DECAL_ATTR;
    const kind = this.kind[i] as DecalKind;
    const age = this.now - this.born[i]!;
    const st = styleFor(kind, this.goreLevel);
    if (!st) {
      this.col[o + 3] = 0;
      this.pos[o + 3] = 0;
      return;
    }
    const tm = this.spreadT[i]!;
    const spread = tm > 0 ? 1 - Math.exp(-age / (tm * 0.55)) : 1;
    const wet = kind === DECAL.SCORCH ? 0 : 1 - smooth(this.wetT[i]!, this.wetT[i]! + this.dryT[i]!, age);
    // size: a pool spreads from a quarter to full; everything else pops in over its short spread
    const grow = kind === DECAL.POOL ? 0.25 + 0.75 * spread : 0.35 + 0.65 * spread;
    this.pos[o + 3] = this.size[i]! * st.size * grow;
    // colour: fresh to dry, with a little per-mark tint so a field of pools is not a field of copies
    const dry = 1 - wet;
    hexToLinear(st.tone.fresh, this.col, o);
    const fr = this.col[o]!;
    const fg = this.col[o + 1]!;
    const fb = this.col[o + 2]!;
    hexToLinear(st.tone.dry, this.col, o);
    const k = 1 + this.tint[i]! * 0.14;
    this.col[o] = (fr + (this.col[o]! - fr) * dry) * k;
    this.col[o + 1] = (fg + (this.col[o + 1]! - fg) * dry) * k;
    this.col[o + 2] = (fb + (this.col[o + 2]! - fb) * dry) * k;
    // alpha: in over a moment, out over the last 15% of its life; a smear paler along the drag
    const fade = Math.min(1, age / 0.1) * Math.min(1, (this.life[i]! - age) / (this.life[i]! * 0.15));
    const base = kind === DECAL.SCORCH ? 0.92 - 0.35 * dry : kind === DECAL.MUD ? 0.85 - 0.3 * dry : 0.93;
    this.col[o + 3] = Math.max(0, fade) * base * (kind === DECAL.DRAG && this.gloss[i]! > 0 ? 0.55 + 0.45 * this.gloss[i]! : 1);
    this.info[o + 1] = st.glossy ? wet : 0;
    this.info[o + 2] = spread;
  }

  /** Advances the clock and rewrites every live mark. Allocation-free. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    this.now += dt;
    let top = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      if (this.now - this.born[i]! >= this.life[i]!) {
        this.alive[i] = 0;
        const o = i * DECAL_ATTR;
        this.col[o + 3] = 0;
        this.pos[o + 3] = 0;
        if (i === this.freshestPool) this.freshestPool = -1;
        continue;
      }
      this.paint(i);
      top = i + 1;
    }
    this.drawn = top;
  }
}
