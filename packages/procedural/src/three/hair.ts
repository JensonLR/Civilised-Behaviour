import { SphereGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { skinDir, type FaceCtx } from "./faceParts.ts";
import { addConformedSweep, type HeadFit } from "./headFit.ts";
import { orient } from "./headExtras.ts";
import { buildShell, smooth, type Dir, type ShellSpec } from "./shell.ts";
import { curve } from "./sweep.ts";
import { greyAmount } from "./look.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import type { GridLevel } from "./headShape.ts";

// ---- hairstyles -----------------------------------------------------------------------------------------------------------
//
// Every style is a PLAN: the shells it lays over the skull (a mask and a thickness, both functions of the direction from the head centre) and the extras it
// grows on them (locks, tails, curtains). The plan is pure data, so anything that has to sit ON the hair (a bow, a strap, a hat's crown) can ask how thick the hair is
// in a direction (`hairLiftFn`) instead of guessing. Hair that hangs (curtains, tails, plaits) does not float in a fixed place: it is built by `hangProfile`, which lets it
// fall from the widest part of the head under gravity and pushes it out of the neck, collar and shoulders (`HeadFit.clearRadius`).

type ShellDef = Omit<ShellSpec, "color" | "coarse" | "tint" | "tintColor" | "strands">;

/** Hairline height (y on the unit sphere) by azimuth: high on the forehead, above the ears at the sides, low at the nape. */
const hairline = (az: number, front = 0.42, side = 0.02, back = -0.62): number =>
  front + (side - front) * smooth(0.5, 1.5, az) + (back - side) * smooth(1.3, 2.9, az);

const shade = (color: number, k: number): number => {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
};
const tone = shade;
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A point on the unit head in (azimuth from the face, signed: + = the character's right; height on the unit sphere). */
const dirAt = (az: number, y: number): V3 => {
  const k = Math.sqrt(Math.max(0.02, 1 - y * y));
  return [Math.sin(az) * k, y, -Math.cos(az) * k];
};

/** Hair that is not a shell (curls are spheres standing 0.29 R off the skin) but still has to fit under a hat's crown, in units of R. */
const EXTRA_T = [0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

interface Plan {
  shells: ShellDef[];
  /** Everything that is not a shell: locks, tails, curtains, knots. */
  extras(): void;
}

function planFor(c: FaceCtx, hf: HeadFit, hatOn: boolean, hatSeat: number, hi: number, lo: number): Plan {
  const { spec, P, b, hairC, cy } = c;
  const R = P.headRadius;
  const hatCut = (y: number): number => (hatOn ? 1 - smooth(hatSeat - 0.14, hatSeat + 0.02, y) : 1);
  const cap = (front = 0.42, side = 0.02, back = -0.62): ((d: Dir) => number) => (d) => smooth(hairline(d.az, front, side, back) - 0.1, hairline(d.az, front, side, back) + 0.1, d.y) * hatCut(d.y);
  const shells: ShellDef[] = [];
  /** 0 on the ear, 1 away from it: real hair grows round an ear, it does not bury it (the bowl cut, mop top and mane cover the ears by design). */
  let earBox: { pc: number; hw: number; yc: number; hh: number } | undefined;
  const hole = (d: Dir): number => {
    if (!earBox) {
      const e = hf.ear(1);
      const pf = Math.atan2(Math.abs(e.front[0]), -e.front[2]);
      const pb = Math.atan2(Math.abs(e.back[0]), -e.back[2]);
      earBox = { pc: (pf + pb) / 2, hw: Math.abs(pb - pf) / 2 + 0.07, yc: ((e.top[1] + e.lobe[1]) / 2 - cy) / R, hh: (e.top[1] - e.lobe[1]) / (2 * R) + 0.035 };
    }
    const q = Math.hypot((d.az - earBox.pc) / earBox.hw, (d.y - earBox.yc) / earBox.hh);
    return smooth(0.6, 1.5, q); // (a ramp about a grid cell wide: the hairline round the ear is a smooth curve, not a staircase)
  };
  const coversEars = spec.hair === 7 || spec.hair === 15 || spec.hair === 16;
  const sh = (s: ShellDef): void => void shells.push(coversEars ? s : { ...s, mask: (d) => s.mask(d) * hole(d) });
  const none = (): void => undefined;

  /**
   * A lock of hair: a thin ribbon laid on the head along a path of [azimuth, height] points, its wide side lying on the surface. `lift` (x R) is how
   * far it stands off the skin (about the thickness of the shell under it); `w` and `d` are half-width and half-depth (x R).
   */
  const lock = (path: readonly (readonly [number, number])[], lift: number, w: number, d: number, color: number, taper = 0.6, samples = 5): void =>
    lockDirs(path.map(([az, y]) => dirAt(az, y)), lift, w, d, color, taper, samples);
  const lockDirs = (dirsIn: readonly V3[], lift: number, w: number, d: number, color: number, taper = 0.6, samples = 5): void => {
    let dirs = dirsIn;
    if (PartBuilder.lod > 0 || (hatOn && dirs.some((v) => v[1] > hatSeat - 0.1))) return; // strands are fine detail: crowd levels keep only the shell
    // the path is densified in DIRECTION space first and each sample is then laid on the skull: a spline through a few widely spaced points on the skin would cut across the curve
    let dsp = curve(dirs, Math.max(samples, dirs.length * 3)).map((v) => norm3(v));
    if (!coversEars) {
      // a lock stops before it reaches an ear (it would lie across it): keep the part of the path that stays clear
      const ok = dsp.findIndex((v) => hole({ x: v[0], y: v[1], z: v[2], az: Math.abs(Math.atan2(v[0], -v[2])), phi: Math.atan2(v[0], -v[2]) }) < 0.6);
      if (ok >= 0) {
        if (ok < 3) return;
        dsp = dsp.slice(0, ok);
      }
    }
    const spine = dsp.map((v, i) => skinDir(c, v[0], v[1], v[2], R * (lift + d * 0.4 - 0.02 * (i === 0 ? 1 : 0))));
    b.sweep(
      spine,
      (t) => ({ rx: R * w * (1 - Math.max(taper, 0.82) * t * t), rz: R * d * (1 - 0.5 * t), pow: 2.2, color: tone(color, 0.82 + 0.3 * t ** 0.9) }),
      color,
      {
        segments: 4,
        sideAt: (i) => {
          const a = spine[Math.max(0, i - 1)]!;
          const e = spine[Math.min(spine.length - 1, i + 1)]!;
          const tv: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
          const n = dsp[Math.min(dsp.length - 1, i)] ?? dsp[dsp.length - 1]!;
          return [n[1] * tv[2] - n[2] * tv[1], n[2] * tv[0] - n[0] * tv[2], n[0] * tv[1] - n[1] * tv[0]] as V3;
        },
      },
    );
  };

  // ---- hair that hangs ------------------------------------------------------------------------------------------------------------------------
  const hangProfile = (phi: number, ys: readonly number[], gap: number, minR = 0, inset = 0.05): { rho: number[]; land: number } => hf.hangProfile(phi, ys, { gap, minR, inset });
  /** A spine hanging from the hair at azimuth phi from bone height y0 down to y1: points on the falling profile, `kick` metres extra out near the start (a ponytail leaves the head before it falls). */
  const hangPath = (phi: number, y0: number, y1: number, n: number, gap: number, kick = 0, sway = 0): V3[] => {
    let ys = Array.from({ length: n }, (_, i) => y0 + ((y1 - y0) * i) / (n - 1));
    const prof = hangProfile(phi, ys, gap, 0, 0.02);
    const keep = ys.filter((y) => y >= prof.land - 1e-9).length;
    const cut = Math.max(3, keep);
    const rho = prof.rho;
    ys = ys.slice(0, cut);
    return ys.map((y, i) => {
      const t = i / (n - 1);
      const r = rho[i]! + kick * Math.sin(Math.PI * Math.min(1, t * 1.5)) * (1 - t);
      const a = phi + sway * Math.sin(t * 5.5) * t;
      return [Math.sin(a) * r, y, -Math.cos(a) * r] as V3;
    });
  };
  /** A curtain of hair from azimuth az0 to az1 hanging from bone height yTop, its hem at bottom(az): a patch on the falling profile, hugging the back of the head and lying on the neck and shoulders. */
  const curtain = (az0: number, az1: number, yTop: number, bottom: (az: number) => number, opts: { nu?: number; nv?: number; gap?: number; thick?: number; wave?: number; color?: number } = {}): void => {
    // the profile is computed on a FIXED grid whatever the level of detail (the tessellation only decides how finely it is sampled), so every level has the same silhouette
    const NU = 12;
    const NV = 10;
    const nu = opts.nu ?? (PartBuilder.lod > 0 ? 8 : 12);
    const nv = opts.nv ?? (PartBuilder.lod > 0 ? 4 : 7);
    const gap = opts.gap ?? R * 0.06 + 0.012;
    let lowest = yTop;
    for (let i = 0; i <= 12; i++) lowest = Math.min(lowest, bottom(az0 + ((az1 - az0) * i) / 12));
    const ys = Array.from({ length: NV + 1 }, (_, j) => yTop + ((lowest - yTop) * j) / NV);
    const cols: number[][] = [];
    const lands: number[] = [];
    for (let i = 0; i <= NU; i++) {
      const p = hf.hangProfile(az0 + ((az1 - az0) * i) / NU, ys, { gap, inset: -0.014, maxR: R * 1.32 });
      cols.push(p.rho);
      lands.push(p.land === -Infinity ? -1e9 : p.land);
    }
    const landAt = (u: number): number => {
      const fu = Math.max(0, Math.min(NU, ((u - az0) / (az1 - az0)) * NU));
      const i = Math.min(NU - 1, Math.floor(fu));
      return Math.max(lands[i]!, lands[i + 1]!);
    };
    const base = opts.color ?? hairC;
    const wave = opts.wave ?? 0.012;
    const rhoAt = (u: number, y: number): number => {
      const fu = Math.max(0, Math.min(NU, ((u - az0) / (az1 - az0)) * NU));
      const i = Math.min(NU - 1, Math.floor(fu));
      const fy = Math.max(0, Math.min(NV, ((yTop - y) / (yTop - lowest)) * NV));
      const j = Math.min(NV - 1, Math.floor(fy));
      const a = cols[i]![j]! + (cols[i]![j + 1]! - cols[i]![j]!) * (fy - j);
      const e = cols[i + 1]![j]! + (cols[i + 1]![j + 1]! - cols[i + 1]![j]!) * (fy - j);
      const t = Math.min(1, fu - i);
      return a + (e - a) * t + R * wave * Math.sin(u * 13) * smooth(0, 0.4, (yTop - y) / (yTop - lowest));
    };
    const at = (u: number, y: number, lift: number): { p: V3; n: V3 } => {
      const r = rhoAt(u, y);
      const dr = (rhoAt(u, y + R * 0.05) - rhoAt(u, y - R * 0.05)) / (R * 0.1);
      const du = (rhoAt(u + 0.03, y) - rhoAt(u - 0.03, y)) / (0.06 * r);
      let n: V3 = [Math.sin(u) - Math.cos(u) * du, -dr, -Math.cos(u) - Math.sin(u) * du];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      return { p: [Math.sin(u) * r + n[0] * lift, y + n[1] * lift, -Math.cos(u) * r + n[2] * lift], n };
    };
    const stripe = (u: number): number => 0.94 + 0.12 * (0.5 + 0.5 * Math.sin(u * 23 + 1.3) * Math.sin(u * 7.1));
    b.patch(
      {
        at,
        u0: az0,
        u1: az1,
        v0: lowest,
        v1: yTop,
        nu,
        nv,
        inside: (u, y) => Math.min((y - Math.max(bottom(u), landAt(u))) * 6, Math.min(u - az0, az1 - u) * 6 + 0.4, (yTop - y) * 4 + 0.4),
        lift: () => 0.002,
        color: (u, y) => tone(base, stripe(u) * (0.92 + 0.14 * smooth(lowest, yTop, y))),
        thick: opts.thick ?? R * 0.06,
        lining: tone(base, 0.7),
        rim: () => true,
      },
      true,
    );
  };

  /**
   * A clump of strands: a tapered flat ribbon that leaves the head at azimuth `phi` (bone height y0), falls under gravity along the falling profile (so it lies on the neck and the
   * shoulders instead of passing through them) and ends in a point at y1 or where it lands. `w` / `d` are its half width and half thickness at the top (x R). Its colour runs from a dark
   * root to a light tip (`hi`), with a slow wave in width so a mass of clumps reads as strands and not as a sheet.
   */
  const clump = (phi: number, y0: number, y1: number, o: { w: number; d?: number; gap: number; kick?: number; sway?: number; color?: number; hi?: number; seed?: number; blunt?: boolean }): void => {
    if (PartBuilder.hullMode) return; // (strands are surface detail: the ink line follows the silhouette of the under-layer, not every clump)
    const seed = o.seed ?? 0;
    const path = hangPath(phi, y0, y1, 6, o.gap, o.kick ?? 0, o.sway ?? 0);
    if (path.length < 3) return;
    const sp = curve(path, 6);
    const base = o.color ?? hairC;
    const tip = o.hi ?? tone(base, 1.14);
    const d = o.d ?? 0.05;
    addConformedSweep(
      b,
      hf,
      sp,
      (t) => ({
        rx: R * o.w * (1 - (o.blunt ? 0.55 : 0.93) * t ** 1.5) * (1 + 0.1 * Math.sin(t * 9 + seed * 2.3)),
        rz: R * d * (1 - 0.5 * t),
        pow: 2.4,
        color: shade(t > 0.5 ? tip : base, 0.8 + 0.28 * Math.min(1, t * 1.4)),
      }),
      base,
      { sideAt: (i) => { const a = phi + (o.sway ?? 0) * Math.sin((i / (sp.length - 1)) * 5.5) * (i / (sp.length - 1)); return [Math.cos(a), 0, Math.sin(a)] as V3; }, segments: 4, caps: true },
      0.002,
    );
  };

  /** Ears stay out of long hair: the back curtain starts behind the rim of the ear, the front locks end in front of it. */
  const earAz = (): { front: number; back: number } => {
    const e = hf.ear(1);
    const front = Math.atan2(Math.abs(e.front[0]), -e.front[2]);
    const back = Math.atan2(Math.abs(e.outer[0]), -(e.outer[2] - e.size * 1.1));
    return { front: Math.max(0.9, front - 0.12), back: Math.min(2.4, Math.max(1.75, back + 0.32)) };
  };
  const headBottom = cy - R * 1.02;

  switch (spec.hair) {
    case 1: { // side part: a swept-over mass with a parting line and locks combed from it
      const m = cap(0.4);
      sh({
        mask: m,
        thick: (d) => {
          const part = Math.exp(-(((d.phi + 0.5) / 0.09) ** 2)) * smooth(0.3, 0.7, d.y);
          const over = d.phi > -0.5 ? 0.05 : 0;
          return 0.075 + 0.03 * d.y + over + 0.02 * smooth(0.6, 1, d.y) - 0.07 * part;
        },
      });
      return { shells, extras: () => { for (let i = 0; i < 6; i++) lock([[-0.5 + i * 0.05, 0.9 - i * 0.05], [0.4 + i * 0.12, 0.8 - i * 0.06], [1.0 + i * 0.1, 0.5 - i * 0.12], [1.5 + i * 0.05, 0.05 - i * 0.12]], 0.085, 0.07, 0.03, i % 2 ? hi : lo); } };
    }
    case 2: { // wild tufts: a thin cap with a ring of spikes
      sh({ mask: cap(0.5, 0.1, -0.3), thick: () => 0.06 });
      return {
        shells,
        extras: () => {
          if (hatOn) return;
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + 0.3;
            const dx = Math.sin(a) * 0.75;
            const dz = Math.cos(a) * 0.75;
            const p0 = skinDir(c, dx, 0.66, dz, -R * 0.02);
            const p1: V3 = [p0[0] + dx * R * 0.5, p0[1] + R * 0.3, p0[2] + dz * R * 0.5];
            const p2: V3 = [p0[0] + dx * R * 0.85, p0[1] + R * 0.62, p0[2] + dz * R * 0.85];
            b.sweep([p0, p1, p2], (t) => ({ rx: R * 0.15 * (1 - t * 0.95), rz: R * 0.12 * (1 - t * 0.95), pow: 2.2 }), i % 2 ? hi : hairC, { side: [0, 0, 1], segments: 6 });
          }
        },
      };
    }
    case 3: { // curls: a cap studded with round curls (never a row across the brow)
      sh({ mask: cap(0.5, 0.1, -0.4), thick: () => 0.05 });
      return {
        shells,
        extras: () => {
          const curl = (p: V3, r: number, k = 1): void => void b.add(new SphereGeometry(r, 8, 5), tone(hairC, k), p, [0, 0, 0], [1, 0.9, 1]);
          for (let i = 0; i < 10; i++) {
            const az = 0.85 + (i / 9) * 4.55; // from the temple round the back to the other temple
            const dy = Math.min(0.2 + (i % 3) * 0.16, hatOn ? hatSeat - 0.23 : 9); // (under a hat every curl stays below the band: a curl is 0.4 R across)
            curl(skinDir(c, Math.sin(az) * (1 - dy * 0.3), dy, -Math.cos(az) * (1 - dy * 0.3), R * 0.09), R * 0.2, i % 2 ? 1.1 : 0.92);
          }
          if (!hatOn) for (let i = 0; i < 5; i++) curl(skinDir(c, Math.cos(i * 1.26) * 0.45, 0.93, Math.sin(i * 1.26) * 0.45 + 0.1, R * 0.06), R * 0.22, i % 2 ? 1.08 : 0.94);
        },
      };
    }
    case 4: // slicked back: a thin, high-gloss cap combed into lines
      sh({ mask: cap(0.5, 0.1, -0.55), thick: (d) => 0.045 + 0.02 * d.y, shine: 0.3 });
      return {
        shells,
        extras: () => {
          for (let i = 0; i < 7; i++) {
            const s = -0.72 + i * 0.24; // combed lines from the hairline over the crown to the nape
            lockDirs([[s * 0.9, 0.55, -0.75], [s * 0.6, 0.98, -0.2], [s * 0.6, 0.85, 0.5], [s * 0.85, 0.15, 0.9]], 0.06, 0.05, 0.02, i % 2 ? hi : hairC, 0.5, 9);
          }
        },
      };
    case 5: // receding: a wreath round the sides and back, bare on top
      sh({ mask: (d) => cap(0.3, 0.0, -0.6)(d) * smooth(0.6, 1.5, d.az) * (1 - smooth(0.7, 0.95, d.y) * 0.9), thick: () => 0.08 });
      return { shells, extras: () => { for (let i = 0; i < 5; i++) lock([[1.0 + i * 0.03, 0.55 - i * 0.02], [1.7 + i * 0.12, 0.45 - i * 0.14], [2.4 + i * 0.1, 0.2 - i * 0.16]], 0.09, 0.06, 0.025, i % 2 ? hi : lo, 0.4); } };
    case 6: { // top knot
      sh({ mask: cap(0.5, 0.05, -0.5), thick: () => 0.05 });
      return {
        shells,
        extras: () => {
          if (hatOn) return;
          const top = skinDir(c, 0, 1, 0.02, 0);
          b.loft(
            [
              { y: 0, rx: R * 0.16, rz: R * 0.16, color: hairC },
              { y: R * 0.14, rx: R * 0.13, rz: R * 0.13, color: hairC, crease: true },
              { y: R * 0.2, rx: R * 0.28, rz: R * 0.28, color: hairC },
              { y: R * 0.4, rx: R * 0.3, rz: R * 0.3, color: hi },
              { y: R * 0.58, rx: R * 0.16, rz: R * 0.16, color: hairC },
            ],
            hairC,
            [top[0], top[1] - R * 0.03, top[2]],
          );
        },
      };
    }
    case 7: // bowl cut: a heavy helmet of hair with a blunt fringe
      sh({
        mask: (d) => {
          const hl = d.z < 0 ? 0.5 - 0.12 * smooth(0.6, 1.3, d.az) : 0.5 - 0.5 * smooth(0.5, 1.4, d.az);
          const edge = smooth(-0.02, 0.02, d.y - Math.min(hl, 0.52) + (d.az > 1.2 ? 0.55 : 0));
          return edge * (d.az < 1.5 ? smooth(hl - 0.03, hl + 0.03, d.y) : smooth(-0.02, 0.03, d.y - 0.02)) * hatCut(d.y);
        },
        thick: (d) => 0.12 + 0.03 * smooth(0.3, 0.5, d.y) * smooth(1.3, 0.3, d.az),
      });
      return { shells, extras: none };
    case 8: { // long lank: a cap, an under-layer, two layers of strand clumps down the back to the shoulder blades and locks falling in front of the ears
      sh({ mask: cap(0.42, 0.0, -0.45), thick: () => 0.07 });
      return {
        shells,
        extras: () => {
          const ea = earAz();
          const yTop = cy + R * 0.32;
          const end = headBottom - R * 1.05;
          const span = Math.PI - ea.back;
          const hem = (az: number): number => end + R * 0.75 * (Math.abs(az - Math.PI) / span) ** 2 - R * 0.14 * Math.abs(Math.sin(az * 3.1));
          // the under-layer: a plain, darker sheet that only has to hide the neck between the clumps (crowd levels keep it as the whole back)
          curtain(ea.back, Math.PI * 2 - ea.back, yTop, PartBuilder.lod > 0 ? hem : (az) => hem(az) + R * 0.38, { gap: R * 0.05 + 0.01, thick: PartBuilder.lod > 0 ? R * 0.03 : 0, color: tone(hairC, 0.78), nu: 8, nv: PartBuilder.lod > 0 ? 4 : 5 });
          if (PartBuilder.lod === 0) {
            const layers = [{ n: 6, gap: R * 0.085 + 0.012, up: 0, w: 0.24, c: hairC, hi: hi }, { n: 5, gap: R * 0.13 + 0.014, up: R * 0.16, w: 0.22, c: tone(hairC, 1.06), hi: tone(hairC, 1.22) }];
            layers.forEach((L, li) => {
              for (let i = 0; i < L.n; i++) {
                const u = (i + (li ? 0.5 : 0.15) + 0.2 * Math.sin(i * 2.7 + li)) / L.n;
                const phi = ea.back + (Math.PI * 2 - 2 * ea.back) * u;
                clump(phi, yTop - R * (0.02 + 0.06 * li), hem(phi) + L.up - R * 0.12 * Math.abs(Math.sin(i * 1.9 + li * 4)), { w: L.w * (0.85 + 0.3 * Math.abs(Math.sin(i * 3.3))), d: 0.05, gap: L.gap, color: L.c, hi: L.hi, seed: i + li * 11, sway: 0.05 * Math.sin(i * 2.1) });
              }
            });
          }
          for (const s of [-1, 1]) {
            const phi = s * (ea.front - 0.12);
            clump(phi, cy + R * 0.34, headBottom - R * 0.55, { w: 0.11, d: 0.075, gap: R * 0.05, kick: R * 0.03, color: hairC, hi: hi, seed: s + 3 });
          }
        },
      };
    }
    case 9: { // pompadour: a cap with a great swept-up quiff above the forehead (flattened under a hat)
      const q = hatOn ? 0.3 : 1;
      const quiff = (d: Dir): number => Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2)));
      sh({
        mask: cap(0.5, 0.05, -0.5),
        thick: (d) => 0.05 + 0.3 * q * quiff(d) * (d.z < 0 ? 1 : 0.2),
        lift: (d) => [0, 0.14 * q * quiff(d), -0.08 * q * quiff(d)],
        shine: 0.28,
      });
      return { shells, extras: none };
    }
    case 10: { // ponytail: a slicked cap, a tie at the back and a tail that leaves the head and falls down the neck
      sh({ mask: cap(0.5, 0.1, -0.5), thick: (d) => 0.045 + 0.02 * d.y, shine: 0.25 });
      return {
        shells,
        extras: () => {
          const y0 = cy + R * 0.1;
          const path = hangPath(Math.PI, y0, headBottom - R * 0.85, 10, R * 0.05, R * 0.3);
          if (PartBuilder.lod === 0) {
            // a bundle: a full core and four strands fanning out below the tie, each ending in its own point
            addConformedSweep(b, hf, curve(path.slice(0, Math.max(3, Math.round(path.length * 0.62))), 6), (t) => ({ rx: R * (0.12 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.6))), rz: R * (0.11 + 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.6))), pow: 2.3, color: shade(hairC, 0.86 + 0.2 * t) }), hairC, { side: [1, 0, 0], segments: 6, round: "end" }, 0.002);
            for (let k = 0; k < 2; k++) {
              const off = (k - 0.5) * 0.14;
              const y1 = headBottom - R * (0.55 + 0.35 * Math.abs(Math.sin(k * 2.2)));
              const sp = curve(hangPath(Math.PI + off, y0 - R * 0.05, y1, 7, R * 0.06, R * 0.3, off * 1.7), 7);
              addConformedSweep(b, hf, sp, (t) => ({ rx: R * (0.075 - 0.07 * t ** 1.3), rz: R * (0.07 - 0.055 * t), pow: 2.3, color: shade(k % 2 ? hi : hairC, 0.86 + 0.3 * t) }), hairC, { side: [1, 0, 0], segments: 4, round: "end" }, 0.002);
            }
          } else addConformedSweep(b, hf, curve(path, 12), (t) => ({ rx: R * (0.12 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.09 * t * t), rz: R * (0.11 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.085 * t * t), pow: 2.3, color: t > 0.5 ? hi : hairC }), hairC, { side: [1, 0, 0], segments: 6, round: "end" }, 0.002);
          const tie = path[1]!;
          const tan: V3 = [path[2]![0] - path[0]![0], path[2]![1] - path[0]![1], path[2]![2] - path[0]![2]];
          b.torus(R * 0.11, R * 0.03, PALETTE.trim.ribbonRed, tie, orient(tan));
        },
      };
    }
    case 11: { // plait: a tight cap and a braid hanging down the back, tied with a ribbon
      sh({ mask: cap(0.5, 0.1, -0.5), thick: (d) => 0.05 + 0.015 * d.y });
      return {
        shells,
        extras: () => {
          const path = hangPath(Math.PI, cy - R * 0.1, headBottom - R * 0.9, 10, R * 0.05, R * 0.14);
          const sp = curve(path, 22);
          // interlaced: the cable swings side to side as it falls and its lumps alternate in tone
          const woven = sp.map((p, i) => [p[0] + R * 0.03 * Math.sin(i * 1.9) * (i / sp.length), p[1], p[2]] as V3);
          addConformedSweep(b, hf, woven, (t, i) => ({ rx: R * (0.085 - 0.03 * t + 0.022 * Math.sin(i * 1.9)), rz: R * (0.085 - 0.03 * t + 0.022 * Math.sin(i * 1.9)), pow: 2.2, color: Math.sin(i * 1.9) > 0 ? hi : lo }), hairC, { side: [1, 0, 0], segments: 5, round: "end" }, 0.002);
          const end = sp[sp.length - 3]!;
          const tan: V3 = [sp[sp.length - 1]![0] - sp[sp.length - 4]![0], sp[sp.length - 1]![1] - sp[sp.length - 4]![1], sp[sp.length - 1]![2] - sp[sp.length - 4]![2]];
          b.torus(R * 0.06, R * 0.02, PALETTE.trim.ribbonBlue, end, orient(tan));
        },
      };
    }
    case 12: // monk fringe: bald crown, a ring of hair round the sides and back
      sh({ mask: (d) => cap(0.05, -0.05, -0.62)(d) * (1 - smooth(0.05, 0.3, d.y)) * smooth(0.55, 1.05, d.az), thick: () => 0.085 });
      return { shells, extras: () => { for (let i = 0; i < 6; i++) lock([[1.1 + i * 0.05, 0.22], [1.8 + i * 0.22, 0.05], [2.4 + i * 0.13, -0.2]], 0.09, 0.07, 0.03, i % 2 ? hi : lo, 0.5); } };
    case 13: // comb-over: a thin fringe at the sides, a few long strands dragged across the bald crown
      sh({ mask: (d) => cap(0.05, 0.0, -0.55)(d) * (1 - smooth(0.1, 0.35, d.y)) * smooth(0.5, 1.0, d.az), thick: () => 0.06 });
      return { shells, extras: () => { if (!hatOn) for (let i = 0; i < 6; i++) lock([[-1.35, 0.32 + i * 0.05], [-0.7, 0.72 + i * 0.035], [0.1, 0.94 - i * 0.02], [0.95, 0.72 - i * 0.035]], 0.02, 0.035, 0.016, i % 2 ? hi : hairC, 0.5, 8); } };
    case 14: // thin wisps: a few sad strands
      sh({ mask: (d) => cap(0.0, -0.05, -0.55)(d) * (1 - smooth(0.0, 0.3, d.y)) * smooth(0.6, 1.1, d.az), thick: () => 0.05 });
      return { shells, extras: () => { if (!hatOn) for (let i = 0; i < 7; i++) lock([[-0.6 + i * 0.2, 0.55], [-0.5 + i * 0.18, 0.85 + (i % 3) * 0.03], [-0.3 + i * 0.17, 0.98]], 0.015, 0.02, 0.012, i % 2 ? hi : lo, 0.6); } };
    case 15: { // shaggy mane: a big layered mass, strand clumps of different lengths down the back and locks to the shoulders at the sides
      sh({ mask: cap(0.5, -0.2, -0.85), thick: (d) => 0.13 + 0.05 * smooth(0.2, 0.9, d.y) });
      return {
        shells,
        extras: () => {
          const ea = earAz();
          const yTop = cy + R * 0.28;
          const end = headBottom - R * 0.85;
          const a0 = ea.back - 0.15;
          const span = Math.PI - a0;
          const hem = (az: number): number => end + R * 0.8 * (Math.abs(az - Math.PI) / span) ** 2 - R * 0.3 * Math.abs(Math.sin(az * 2.6));
          curtain(a0, Math.PI * 2 - a0, yTop, PartBuilder.lod > 0 ? hem : (az) => hem(az) + R * 0.45, { gap: R * 0.06 + 0.012, thick: PartBuilder.lod > 0 ? R * 0.04 : 0, wave: 0.02, color: tone(hairC, 0.78), nu: 8, nv: PartBuilder.lod > 0 ? 4 : 5 });
          if (PartBuilder.lod === 0) {
            const layers = [{ n: 6, gap: R * 0.09 + 0.012, up: 0, w: 0.26 }, { n: 5, gap: R * 0.14 + 0.014, up: R * 0.2, w: 0.26 }, { n: 4, gap: R * 0.19 + 0.016, up: R * 0.42, w: 0.26 }];
            layers.forEach((L, li) => {
              for (let i = 0; i < L.n; i++) {
                const u = (i + (li % 2 ? 0.5 : 0.1) + 0.25 * Math.sin(i * 2.3 + li * 1.7)) / L.n;
                const phi = a0 + (Math.PI * 2 - 2 * a0) * u;
                const pick = (i + li) % 3;
                clump(phi, yTop - R * 0.04 * li, hem(phi) + L.up - R * 0.16 * Math.abs(Math.sin(i * 1.7 + li * 3)), { w: L.w * (0.8 + 0.4 * Math.abs(Math.sin(i * 2.9 + li))), d: 0.06, gap: L.gap, color: pick === 0 ? hairC : pick === 1 ? hi : lo, hi: tone(pick === 2 ? hairC : hi, 1.12), seed: i + li * 9, sway: 0.09 * Math.sin(i * 1.3 + li) });
              }
            });
          }
          for (let i = 0; i < 4; i++) {
            const s = i < 2 ? -1 : 1;
            const az = s * (Math.PI - (0.55 + (i % 2) * 0.5));
            const az2 = Math.abs(az) > ea.back ? az : s * ea.back;
            clump(az2, cy + R * 0.25, end + R * 0.2 * (i % 2) - R * 0.1, { w: 0.14, d: 0.09, gap: R * 0.05, kick: R * 0.05, color: i % 2 ? hi : lo, hi: tone(hi, 1.08), seed: i + 40, sway: 0.12 * s });
          }
        },
      };
    }
    case 16: // mop top: a thick bowl that grows over the ears, with a long fringe hanging over the brow
      sh({
        mask: (d) => {
          const hl = d.z < 0 ? 0.28 - 0.3 * smooth(0.6, 1.3, d.az) : 0.05 - 0.5 * smooth(0.5, 1.6, d.az);
          return smooth(hl - 0.05, hl + 0.03, d.y) * hatCut(d.y);
        },
        thick: (d) => 0.11 + 0.05 * smooth(0.2, 0.9, d.y),
        shine: 0.1,
      });
      return { shells, extras: () => { for (let i = 0; i < 8; i++) lock([[-0.6 + i * 0.16, 0.86], [-0.55 + i * 0.15, 0.55], [-0.5 + i * 0.14, 0.26 + (i % 2) * 0.03]], 0.13, 0.07, 0.03, i % 2 ? hi : lo, 0.5); } };
    default:
      return { shells, extras: none };
  }
}

const planCache = new WeakMap<FaceCtx, { key: string; plan: Plan }>();
function plan(c: FaceCtx, hf: HeadFit, hatOn: boolean, hatSeat: number): Plan {
  const key = `${hatOn}|${hatSeat}`;
  const hit = planCache.get(c);
  if (hit && hit.key === key) return hit.plan;
  const p = planFor(c, hf, hatOn, hatSeat, tone(c.hairC, 1.14), tone(c.hairC, 0.86));
  planCache.set(c, { key, plan: p });
  return p;
}

/** How far the hair stands off the skull along a unit direction from the head centre (metres): what a bow, a strap or a hat crown must clear. */
export function hairLiftFn(c: FaceCtx, hf: HeadFit, hatOn: boolean, hatSeat: number): (dx: number, dy: number, dz: number) => number {
  const R = c.P.headRadius;
  const shells = plan(c, hf, hatOn, hatSeat).shells;
  return (dx, dy, dz) => {
    const phi = Math.atan2(dx, -dz);
    const d: Dir = { x: dx, y: dy, z: dz, az: Math.abs(phi), phi };
    let best = 0;
    for (const s of shells) {
      const m = s.mask(d);
      if (m < 0.3) continue;
      const lift = s.lift?.(d);
      const t = s.thick(d) * R * smooth(0.3, 0.7, m) + (lift ? Math.max(0, lift[0] * dx + lift[1] * dy + lift[2] * dz) * R : 0);
      if (t > best) best = t;
    }
    return best > 0 ? best + 0.0015 : 0;
  };
}

export function buildHair(c: FaceCtx, hatOn: boolean, coarse: GridLevel, hatSeat: number, hf: HeadFit): void {
  const { spec, b, hairC, cy } = c;
  if (spec.hair === 0) return;
  const grey = spec.greying > 0;
  const p = plan(c, hf, hatOn, hatSeat);
  for (const s of p.shells) {
    const g = buildShell(c.shape, { ...s, color: hairC, coarse, tint: grey ? (d) => greyAmount(spec, d.az, d.y) : undefined, tintColor: PALETTE.hair[6], strands: true });
    if (g) b.add(g, hairC, [0, cy, 0]);
  }
  p.extras();
}

/** Directions where the hair is a full-thickness cover over the skin (so the skin under it is never seen and is not drawn). */
export function hairCoversFn(c: FaceCtx, hf: HeadFit, hatOn: boolean, hatSeat: number): (dx: number, dy: number, dz: number) => boolean {
  const R = c.P.headRadius;
  const shells = plan(c, hf, hatOn, hatSeat).shells;
  return (dx, dy, dz) => {
    const phi = Math.atan2(dx, -dz);
    const d: Dir = { x: dx, y: dy, z: dz, az: Math.abs(phi), phi };
    for (const s of shells) if (s.mask(d) >= 0.78 && s.thick(d) * R >= 0.03 * R) return true;
    return false;
  };
}

/**
 * How far the hair stands off the skull under a hat's band, in units of R: the largest thickness of any hair shell in the zone the crown has to enclose (from a hand's breadth
 * below the band to the band), and whatever else the style grows there. The crown's margin is this plus a gap, so it always clears the hair.
 */
export function hairBandThickness(c: FaceCtx, hf: HeadFit, seat: number): number {
  if (c.spec.hair === 0) return 0;
  const lift = hairLiftFn(c, hf, true, seat);
  const R = c.P.headRadius;
  let worst = EXTRA_T[c.spec.hair] ?? 0;
  for (let k = 0; k < 24; k++) {
    const az = (k / 24) * Math.PI * 2;
    for (const y of [seat - 0.3, seat - 0.2, seat - 0.1, seat, seat + 0.1]) {
      const yu = Math.max(-0.95, Math.min(0.95, y));
      const kk = Math.sqrt(1 - yu * yu);
      worst = Math.max(worst, lift(Math.sin(az) * kk, yu, -Math.cos(az) * kk) / R);
    }
  }
  return worst;
}
