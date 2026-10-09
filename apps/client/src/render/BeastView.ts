import { Group, Mesh, MeshToonMaterial, SphereGeometry, type BufferGeometry, type Scene } from "three";
import { FLAG, PALETTE, type PlayerStateType } from "@cb/shared";
import { addOutlineNormals, isSharedInk, outlineMaterial, sharedToonRamp } from "@cb/procedural/three";
import { Kit, type V3 } from "./world/kit.ts";

const P = PALETTE.highmark;

/**
 * D-094: the hunt's quarry, drawn. A row with `FLAG.BEAST` is not a person: the client draws it here, never as a `CharacterActor` (no ragdoll, no limb to lose). It is the
 * Highmark herds' long-horned grazer (`herdBeastGeometry`'s parts) a size larger and grey with age, with four legs that swing in a walk, a trot and a gallop from the row's
 * own speed, a head that lowers to graze when it stands and lifts when it moves, and a fall onto its side when it goes down. Model space: feet at y = 0, the head toward -Z
 * (the hit shapes' frame, `BEAST_SHAPES`), so `rotation.y = facing` as for a person.
 */

const SCALE = 1.1;
const HIP_Y = 0.95;
const LEGS: readonly (readonly [number, number])[] = [[-0.22, -0.55], [0.22, -0.55], [-0.22, 0.55], [0.22, 0.55]];   // x, z (fore pair first)
/** Lying on its side: the roll, and how high its middle (the barrel's, `MID_Y` up when it stands) rests (its barrel's half-width). */
const LIE_ROLL = 1.42;
const LIE_MID = 0.52;
const MID_Y = 1.1;

function bodyGeometry(): BufferGeometry {
  const k = new Kit();
  const hide = P.greyHide, dark = P.greyHideDark;
  const blob = (s: V3, at: V3, colour: number): void => void k.add(new SphereGeometry(1, 9, 6), { at, scale: s, colour, flat: true });
  blob([0.45, 0.5, 0.95], [0, 1.1, 0], hide);           // the barrel
  blob([0.4, 0.34, 0.42], [0, 1.32, -0.5], dark);       // the shoulder hump
  blob([0.32, 0.3, 0.34], [0, 1.05, 0.6], hide);        // the haunch
  k.limb([0, 1.15, 0.9], [0, 0.45, 1.12], 0.045, 0.02, dark, 4);   // the tail
  return k.build()!;
}

/** The neck and head, built about the neck's root (the head's pivot) at the shoulder: raised, the muzzle 1.45 forward. */
function headGeometry(): BufferGeometry {
  const k = new Kit();
  const hide = P.greyHide, dark = P.greyHideDark;
  k.limb([0, 0, 0], [0, 0.05, -0.55], 0.22, 0.17, hide, 6);   // the neck
  k.add(new SphereGeometry(1, 8, 5), { at: [0, 0.02, -0.72], scale: [0.18, 0.2, 0.3], colour: dark, flat: true });   // the head
  k.add(new SphereGeometry(1, 6, 4), { at: [0, -0.06, -0.98], scale: [0.14, 0.13, 0.12], colour: P.hidePale, flat: true });   // the muzzle
  for (const s of [-1, 1]) {
    // the horns: out from the poll, then up and forward, wider than a dining table
    k.limb([s * 0.1, 0.14, -0.64], [s * 0.62, 0.22, -0.6], 0.07, 0.05, P.hidePale, 6);
    k.limb([s * 0.62, 0.22, -0.6], [s * 0.92, 0.66, -0.82], 0.05, 0.014, P.hidePale, 6);
  }
  return k.build()!;
}

function legGeometry(): BufferGeometry {
  const k = new Kit();
  k.limb([0, 0, 0], [0, -HIP_Y + 0.03, 0], 0.12, 0.07, P.greyHideDark, 6);
  k.add(new SphereGeometry(1, 6, 3), { at: [0, -HIP_Y + 0.04, -0.02], scale: [0.08, 0.04, 0.1], colour: P.hidePale, flat: true });   // the hoof
  return k.build()!;
}

interface Beast {
  root: Group;
  body: Group;
  head: Group;
  legs: Group[];
  phase: number;
  still: number;
  graze: number;
  lie: number;
  flinch: number;
  x: number;
  z: number;
  facing: number;
  seen: boolean;
  frame: number;
}

export class BeastView {
  private readonly beasts = new Map<string, Beast>();
  private readonly mat = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() });
  private readonly geo = { body: bodyGeometry(), head: headGeometry(), leg: legGeometry() };
  private frameNo = 0;

  constructor(private readonly scene: Scene, private outline: boolean) {
    for (const g of Object.values(this.geo)) addOutlineNormals(g);
  }

  /** Whether a row is a beast's (drawn here, never as a person). */
  static is(row: { flags: number }): boolean {
    return (row.flags & FLAG.BEAST) !== 0;
  }

  private part(geo: BufferGeometry): Group {
    const g = new Group();
    const m = new Mesh(geo, this.mat);
    m.castShadow = true;
    g.add(m);
    if (this.outline) g.add(new Mesh(geo, outlineMaterial()));
    return g;
  }

  private build(): Beast {
    const root = new Group();
    const body = new Group();
    root.add(body);
    body.add(this.part(this.geo.body));
    const head = this.part(this.geo.head);
    head.position.set(0, 1.25, -0.78);
    body.add(head);
    const legs = LEGS.map(([x, z]) => {
      const l = this.part(this.geo.leg);
      l.position.set(x, HIP_Y, z);
      body.add(l);
      return l;
    });
    root.scale.setScalar(SCALE);
    this.scene.add(root);
    return { root, body, head, legs, phase: 0, still: 0, graze: 1, lie: 0, flinch: 0, x: 0, z: 0, facing: 0, seen: false, frame: 0 };
  }

  /** A blow landed on beast `id` (the hit event): it flinches. */
  onHit(id: string): void {
    const b = this.beasts.get(id);
    if (b) b.flinch = 1;
  }

  /**
   * Follows every beast's row. `pos` gives the row's smoothed position (the session's interpolation), as for people. Rows that are gone are removed.
   * `dt` in seconds.
   */
  update(dt: number, rows: { forEach(cb: (p: PlayerStateType, id: string) => void): void }, pos: (p: PlayerStateType, k: "x" | "y" | "z") => number): void {
    this.frameNo++;
    rows.forEach((p, id) => {
      if (!BeastView.is(p)) return;
      let b = this.beasts.get(id);
      if (!b) {
        b = this.build();
        this.beasts.set(id, b);
      }
      b.frame = this.frameNo;
      const x = pos(p, "x"), y = pos(p, "y"), z = pos(p, "z");
      const step = b.seen ? Math.hypot(x - b.x, z - b.z) : 0;
      const speed = dt > 0 ? Math.min(12, step / dt) : 0;
      b.x = x;
      b.z = z;
      if (!b.seen) b.facing = p.facing;
      b.facing += wrap(p.facing - b.facing) * (1 - Math.exp(-10 * dt));
      b.seen = true;
      const down = (p.flags & FLAG.DOWNED) !== 0;
      b.lie = Math.max(0, Math.min(1, b.lie + (down ? dt / 0.7 : -dt / 0.4)));
      const ease = b.lie * b.lie * (3 - 2 * b.lie);
      // the gait: a stride of ~1.7 m; diagonal pairs swing together (fore-left with hind-right)
      if (!down) b.phase += (speed / 1.7) * Math.PI * 2 * dt;
      const amp = down ? 0 : Math.min(0.62, speed * 0.11);
      b.legs.forEach((l, i) => {
        const pair = i === 0 || i === 3 ? 0 : Math.PI;
        l.rotation.x = Math.sin(b!.phase + pair) * amp * (i < 2 ? 1 : 0.85);
      });
      // grazing: after a few seconds standing it lowers its head to the grass; moving, it lifts it (and holds it high at a run)
      b.still = speed < 0.3 ? b.still + dt : 0;
      const wantGraze = !down && b.still > 2 ? 1 : 0;
      b.graze += (wantGraze - b.graze) * (1 - Math.exp(-2.5 * dt));
      b.head.rotation.x = -0.75 * b.graze + Math.min(0.25, speed * 0.03) + (down ? -0.3 * ease : 0);
      b.flinch = Math.max(0, b.flinch - dt / 0.25);
      // the body: a little bob in the stride, a jolt when hit, and on its side when down. The roll is about the feet's line, so the barrel's middle (1.1 up) would swing
      // sideways by 1.1 sin r: it is put back over the row (where the hit shapes lie) and let down to rest on its side at its half-width.
      const bob = amp * 0.05 * Math.abs(Math.sin(b.phase * 2));
      const roll = LIE_ROLL * ease;
      b.body.rotation.z = roll + 0.06 * b.flinch * Math.sin(b.flinch * 30);
      b.body.position.set(MID_Y * Math.sin(roll), bob + Math.max(-0.2, (LIE_MID - MID_Y * Math.cos(roll)) * ease), 0);
      b.root.position.set(x, y, z);
      b.root.rotation.y = b.facing;
    });
    for (const [id, b] of this.beasts) {
      if (b.frame === this.frameNo) continue;
      this.disposeBeast(b);
      this.beasts.delete(id);
    }
  }

  setOutline(on: boolean): void {
    if (on === this.outline) return;
    this.outline = on;
    for (const [id, b] of this.beasts) {
      this.disposeBeast(b);
      this.beasts.delete(id);
    }
  }

  /** Where beast `id`'s body is drawn (its barrel's middle), for effects; undefined when there is none. */
  centre(id: string): { x: number; y: number; z: number } | undefined {
    const b = this.beasts.get(id);
    if (!b) return undefined;
    return { x: b.root.position.x, y: b.root.position.y + (b.lie > 0.5 ? 0.5 : 1.2), z: b.root.position.z };
  }

  private disposeBeast(b: Beast): void {
    b.root.removeFromParent();
  }

  dispose(): void {
    for (const b of this.beasts.values()) this.disposeBeast(b);
    this.beasts.clear();
    for (const g of Object.values(this.geo)) g.dispose();
    if (!isSharedInk(this.mat)) this.mat.dispose();
  }
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
