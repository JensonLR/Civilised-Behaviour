import { BoxGeometry, Group, type BufferGeometry, type Object3D } from "three";
import { PALETTE, hash3, kessarBridgeWreck, wreckLandTime, wreckPoseAt, type CollisionWorld, type WreckPiece, type WreckPose } from "@cb/shared";
import { Kit, blend, type ColourFn } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { makeSolid, toonMaterial } from "../toon.ts";

/**
 * D-097: the Kessar bridge's fallen span, drawn (shared/bridgeWreck.ts plans it). Each piece is its own small mesh (and ink hull) so it can FALL: when the charge goes, the
 * pieces start where they were in the bridge and drop or swing into the gorge on the shared timetable (`wreckPoseAt`), and the splashes and dust are scheduled from the same
 * table (`wreckLandTime`). Loaded with the bridge already down, they simply lie where they came to rest. Palette colours only; allocation-free per frame.
 */

const K = PALETTE.kessar;
const h01 = (s: number, a: number, b = 0): number => hash3(s, Math.round(a * 100), Math.round(b * 100)) / 4294967296;

/** Dressed stone in courses (the bridge's own), the road's dust on top, raw broken stone where it snapped. */
const dressed = (seed: number): ColourFn => (p, n, out) => {
  if (n.y > 0.6) blend(out, K.roadDust, K.stoneCap, h01(seed, Math.floor(p.x * 1.2), Math.floor(p.z * 0.9)) * 0.7);
  else if (n.y < -0.6) out.set(K.stoneDark);
  else blend(out, K.stone, K.stoneShade, h01(seed + 1, Math.floor(p.y / 0.45), Math.floor((p.x + p.z) / 1.1)) * 0.85);
};
const broken: ColourFn = (_p, n, out) => blend(out, K.stoneShade, K.stoneDark, n.y > 0.4 ? 0.2 : 0.6);

/** A piece, centred on the origin, `size` = across, thick, along. Its two ends are broken faces: a ragged lip of chipped blocks inside the box. */
function pieceGeometry(p: WreckPiece, seed: number, lod: Lod): BufferGeometry {
  const [w, t, l] = p.size;
  const k = new Kit();
  if (p.kind === "deck") {
    k.add(new BoxGeometry(w, t, l - 0.5), { colour: dressed(seed), flat: true, perFace: true });
    // the broken ends: blocks of uneven length, so each end is ragged rather than sawn
    for (const e of [-1, 1]) {
      const n = lod ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const bw = w / n - 0.04, bl = 0.05 + h01(seed + 7, i, e) * 0.07, bt = t * (0.55 + h01(seed + 8, i, e) * 0.45);   // (2bl <= 0.24: inside the box)
        const by = t / 2 - bt / 2;
        k.add(new BoxGeometry(bw, bt, bl * 2), { at: [-w / 2 + (i + 0.5) * (w / n), by, e * ((l - 0.5) / 2 + bl)], colour: i % 2 ? broken : dressed(seed + i), flat: true, perFace: true });
      }
    }
  } else {
    // a run of balustrade: the wall (dressed stone on every face: it lies on its side), its cap stone, broken at both ends to different heights
    const wall: ColourFn = (p2, _n, out) => blend(out, K.stone, K.stoneShade, h01(seed + 3, Math.floor(p2.y / 0.45), Math.floor(p2.z / 1.1)) * 0.85);
    k.add(new BoxGeometry(w, t - 0.2, l - 0.3, 1, 3, Math.max(1, Math.round(l / 1.1))), { at: [0, -0.1, 0], colour: wall, flat: true, perFace: true });
    k.add(new BoxGeometry(w + 0.3, 0.2, l - 0.6), { at: [0, t / 2 - 0.1, 0], colour: K.stoneCap, flat: true });
    for (const e of [-1, 1]) {
      const bt = (t - 0.2) * (0.5 + h01(seed + 9, e) * 0.4);
      k.add(new BoxGeometry(w * 0.9, bt, 0.3), { at: [0, -t / 2 + bt / 2, e * (l / 2 - 0.15)], colour: broken, flat: true });
    }
  }
  return k.build()!;
}

export class BridgeWreck {
  readonly root = new Group();
  private readonly pieces: WreckPiece[];
  private readonly groups: Group[] = [];
  private readonly pose: WreckPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  /** Seconds since the charge went (negative: not falling, the pieces lie at rest). */
  private t = -1;
  private readonly end: number;

  constructor(parent: Object3D, world: CollisionWorld, lod: Lod, outlines: boolean, track: <T extends { dispose(): void }>(x: T) => T) {
    this.root.name = "bridge-wreck";
    parent.add(this.root);
    this.pieces = kessarBridgeWreck(world.terrain);
    const mat = track(toonMaterial({ wetDark: 0.9 }));
    this.pieces.forEach((p, i) => {
      const g = new Group();
      g.name = `wreck-${i}`;
      const geo = track(pieceGeometry(p, 400 + i * 13, lod));
      const hull = outlines ? track(pieceGeometry(p, 400 + i * 13, 0)) : undefined;
      makeSolid(g, geo, mat, { name: `wreck-${i}-stone`, outline: outlines, ink: "medium", hullGeometry: hull, castShadow: true });
      this.root.add(g);
      this.groups.push(g);
    });
    this.end = Math.max(...this.pieces.map(wreckLandTime));
    this.place(Infinity);
  }

  /** (Stills: every piece where it is `t` seconds after the blast, held there.) */
  holdAt(t: number): void {
    this.t = -1;
    this.place(t);
  }

  /** The charge has gone: every piece back in the bridge, about to let go. */
  fall(): void {
    this.t = 0;
    this.place(0);
  }

  /** Each piece's landing (seconds after the blast, where, and whether it lands in the water), for the splashes and dust. */
  landings(waterY: number): { at: number; x: number; y: number; z: number; water: boolean; size: number }[] {
    return this.pieces.map((p) => ({ at: wreckLandTime(p), x: p.rest.x, y: p.rest.y, z: p.rest.z, water: p.rest.y - p.size[1] / 2 < waterY + 0.2, size: Math.max(p.size[0], p.size[2]) }));
  }

  get falling(): boolean {
    return this.t >= 0 && this.t <= this.end + 0.1;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += Math.min(dt, 0.1);
    this.place(this.t);
    if (this.t > this.end + 0.1) this.t = -1;
  }

  private place(t: number): void {
    for (let i = 0; i < this.pieces.length; i++) {
      const q = wreckPoseAt(this.pieces[i]!, t, this.pose);
      const g = this.groups[i]!;
      g.position.set(q.x, q.y, q.z);
      g.rotation.set(q.rx, q.ry, q.rz);
    }
  }
}
