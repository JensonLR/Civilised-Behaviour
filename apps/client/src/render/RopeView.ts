import { CylinderGeometry, InstancedMesh, Matrix4, MeshToonMaterial, Quaternion, TorusGeometry, Vector3, type Scene } from "three";
import { sharedToonRamp } from "@cb/procedural/three";
import { LASSO, PALETTE, type LassoEvent } from "@cb/shared";

/**
 * D-106: the lariat as the clients draw it. A rope held is a sagging line of thin segments from the hand holding it to the man on the end (taut when he is at its full
 * length); a loop thrown flies from the hand to where it was aimed, paying out rope behind it, and drops away if it missed. Two instanced draws for all of it;
 * allocation-free per frame (scratch vectors, fixed pools). The server decides every catch (PlayerState.roped); this only draws.
 */
export const ROPE = {
  /** Segments per rope, ropes and loops drawn at once. */
  segments: 12,
  maxRopes: 8,
  maxLoops: 4,
  /** Radius of the rope (m), of the flying loop, and the loop's thickness. */
  radius: 0.025,
  loopR: 0.32,
  loopTube: 0.014,
  /** How far a slack rope sags at its middle, per metre of slack (and at least this much). */
  sagPerSlack: 0.45,
  minSag: 0.06,
  /** Seconds a missed loop takes to fall away. */
  dropS: 0.6,
} as const;

interface Loop {
  live: boolean;
  t: number;
  hit: boolean;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

const A = new Vector3();
const B = new Vector3();
const P0 = new Vector3();
const P1 = new Vector3();
const MID = new Vector3();
const DIR = new Vector3();
const UP = new Vector3(0, 1, 0);
const XAXIS = new Vector3(1, 0, 0);
const Q = new Quaternion();
const S = new Vector3();
const M = new Matrix4();

export class RopeView {
  private readonly segs: InstancedMesh;
  private readonly loops: InstancedMesh;
  private readonly pool: Loop[] = [];
  private n = 0;

  constructor(private readonly scene: Scene) {
    const mat = new MeshToonMaterial({ color: PALETTE.camp.rope, gradientMap: sharedToonRamp() });
    this.segs = new InstancedMesh(new CylinderGeometry(1, 1, 1, 5, 1, true), mat, ROPE.segments * (ROPE.maxRopes + ROPE.maxLoops));
    this.segs.name = "rope_segments";
    this.segs.frustumCulled = false;
    this.segs.count = 0;
    this.loops = new InstancedMesh(new TorusGeometry(1, ROPE.loopTube / ROPE.loopR, 5, 14), mat, ROPE.maxLoops);
    this.loops.name = "rope_loops";
    this.loops.frustumCulled = false;
    this.loops.count = 0;
    for (let i = 0; i < ROPE.maxLoops; i++) this.pool.push({ live: false, t: 0, hit: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 });
    scene.add(this.segs, this.loops);
  }

  /** A loop was thrown (the server's `lasso` event). */
  thrown(e: LassoEvent): void {
    let slot = this.pool.find((l) => !l.live);
    if (!slot) slot = this.pool.reduce((a, b) => (a.t > b.t ? a : b));
    slot.live = true;
    slot.t = 0;
    slot.hit = e.hit;
    slot.x = e.x;
    slot.y = e.y;
    slot.z = e.z;
    slot.tx = e.tx;
    slot.ty = e.ty;
    slot.tz = e.tz;
  }

  /** Starts a frame's ropes (call `rope` for each held one, then `update`). */
  begin(): void {
    this.n = 0;
  }

  /** A rope held from (ax, ay, az) (the hand) to (bx, by, bz) (the man on the end). */
  rope(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    if (this.n >= ROPE.maxRopes * ROPE.segments) return;
    A.set(ax, ay, az);
    B.set(bx, by, bz);
    const slack = Math.max(0, LASSO.length + 0.4 - A.distanceTo(B));
    this.line(Math.max(ROPE.minSag, slack * ROPE.sagPerSlack), 1);
  }

  /** Lays segments along the sagging curve from A to B, up to `upto` (0..1) of the way. */
  private line(sag: number, upto: number): void {
    for (let i = 0; i < ROPE.segments; i++) {
      const u0 = (i / ROPE.segments) * upto;
      const u1 = ((i + 1) / ROPE.segments) * upto;
      this.at(u0, sag, P0);
      this.at(u1, sag, P1);
      DIR.subVectors(P1, P0);
      const len = DIR.length();
      if (len < 1e-5) continue;
      MID.addVectors(P0, P1).multiplyScalar(0.5);
      Q.setFromUnitVectors(UP, DIR.multiplyScalar(1 / len));
      S.set(ROPE.radius, len, ROPE.radius);
      M.compose(MID, Q, S);
      this.segs.setMatrixAt(this.n++, M);
    }
  }

  /** The point `u` (0..1) along the rope from A to B, sagging by `sag` at its middle. */
  private at(u: number, sag: number, out: Vector3): Vector3 {
    out.lerpVectors(A, B, u);
    out.y -= sag * 4 * u * (1 - u);
    return out;
  }

  /** Draws the frame: the held ropes given since `begin`, and the loops in the air. */
  update(dt: number): void {
    let k = 0;
    for (const l of this.pool) {
      if (!l.live) continue;
      l.t += dt;
      const fly = Math.min(1, l.t / LASSO.throwS);
      const drop = l.hit ? 0 : Math.max(0, (l.t - LASSO.throwS) / ROPE.dropS);
      if ((l.hit && l.t > LASSO.throwS + 0.05) || drop >= 1) {
        l.live = false;
        continue;
      }
      // the loop rides an arc to the target, and a missed one falls where it landed
      const x = l.x + (l.tx - l.x) * fly;
      const z = l.z + (l.tz - l.z) * fly;
      const y = l.y + (l.ty - l.y) * fly + Math.sin(fly * Math.PI) * 0.8 - drop * 0.3;
      Q.setFromAxisAngle(XAXIS, Math.PI / 2 - 0.4); // (the loop flies nearly flat, tipped toward its target)
      S.setScalar(ROPE.loopR);
      MID.set(x, y, z);
      M.compose(MID, Q, S);
      this.loops.setMatrixAt(k++, M);
      // and the rope pays out behind it from the hand
      if (this.n < (ROPE.maxRopes + ROPE.maxLoops) * ROPE.segments - ROPE.segments) {
        A.set(l.x, l.y, l.z);
        B.set(x, y, z);
        this.line(0.15 * (1 - fly) + 0.05, 1);
      }
    }
    this.loops.count = k;
    this.loops.instanceMatrix.needsUpdate = true;
    this.segs.count = this.n;
    this.segs.instanceMatrix.needsUpdate = true;
  }

  /** Loops in the air now (tests, diagnostics). */
  get flying(): number {
    let k = 0;
    for (const l of this.pool) if (l.live) k++;
    return k;
  }

  dispose(): void {
    for (const m of [this.segs, this.loops]) {
      m.removeFromParent();
      m.geometry.dispose();
      m.dispose();
    }
    (this.segs.material as MeshToonMaterial).dispose();
  }
}
