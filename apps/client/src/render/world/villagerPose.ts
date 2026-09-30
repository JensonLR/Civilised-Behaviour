import { Group, Quaternion, Vector3, type Object3D } from "three";
import { FLAG, type Activity, type Carry } from "@cb/shared";
import { CharacterAnimator, HandPoser, buildCharacter, solveArm, type ArmAngles, type CharacterRig, type Lod } from "@cb/procedural/three";
import type { CharacterSpec } from "@cb/procedural";
import { propObject, type PropName } from "./villagerProps.ts";

/**
 * One villager's body: the caricature rig, its animator and hand poser, the props it can hold, and the poses of the village's trades laid on top of the
 * animator's walk and idle. The animator owns the whole pose every frame, so the trade poses run AFTER it: a job is a set of hand targets (the broom's
 * foot on the flagstones, the hammer over the anvil, the rod out over the pond) that the shared arm IK (`solveArm`, which the weapons use) turns into
 * shoulder and elbow angles, plus a lean of the torso and a tilt of the head. The prop is parented to the torso and put exactly where the hand went, so
 * a fist is always on its handle whatever the arm length. Allocation-free per frame; props are built on first use and shared (geometry) between everyone.
 */

export interface BodyState {
  act: Activity;
  carry: Carry;
  /** Metres per second along the ground (already divided by the body scale). */
  speed: number;
  /** Seconds, this villager's own clock (phases the motions). */
  t: number;
  /** A downpour and whether this person has an umbrella (else a hand over the head). */
  rain: number;
  umbrella: boolean;
  /** Under a roof (no umbrella). */
  covered: boolean;
  /** Turn the head toward something: radians relative to the body, and how much (0..1). */
  lookYaw: number;
  lookPitch: number;
  look: number;
  /** 0..1 waving at a passer-by; 0..1 talking with gestures. */
  wave: number;
  talk: number;
  /** Colour variant of the umbrella, and whether a cane is carried (the old). */
  hue: number;
  cane: boolean;
  /** Ground height under the feet (added to the root after the animator has set it). */
  ground: number;
}

export const createBodyState = (): BodyState => ({ act: "idle", carry: "none", speed: 0, t: 0, rain: 0, umbrella: false, covered: false, lookYaw: 0, lookPitch: 0, look: 0, wave: 0, talk: 0, hue: 0, cane: false, ground: 0 });

const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sm = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpD = new Vector3();

/** Hand targets are chosen by the pose code, in the TORSO frame; -1 = no target this frame. */
interface Aim {
  x: number;
  y: number;
  z: number;
  /** 0..1 how firmly the IK owns the arm. */
  w: number;
}

export class FolkBody {
  readonly rig: CharacterRig;
  readonly anim: CharacterAnimator;
  private readonly hands: HandPoser;
  private readonly props = new Map<string, Group>();
  private readonly holder = new Group();
  private readonly ang: ArmAngles = { a: 0, b: 0, e: 0 };
  /** Arm ownership (IK weight), smoothed. */
  private wR = 0;
  private wL = 0;
  private readonly aimR: Aim = { x: 0, y: 0, z: -0.3, w: 0 };
  private readonly aimL: Aim = { x: 0, y: 0, z: -0.3, w: 0 };
  private lean = 0;
  private sit = 0;
  private headDown = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private shown: Group | undefined;
  private shownL: Group | undefined;
  private outline: boolean;
  private lodNow: Lod;
  private hipY = 0.9;
  readonly scale: number;
  /** The height the body sits at on a bench (world metres above the ground). */
  static readonly SEAT = 0.45;

  constructor(readonly spec: CharacterSpec, scale: number, lod: Lod, outline: boolean, parent: Object3D) {
    this.outline = outline;
    this.lodNow = lod;
    this.rig = buildCharacter(spec, { outline: outline && lod === 0, lod });
    this.anim = new CharacterAnimator(this.rig);
    this.hands = new HandPoser(this.rig);
    this.scale = scale;
    this.rig.root.scale.setScalar(scale);
    this.rig.root.name = "villager";
    this.rig.joints.torso.add(this.holder);
    this.holder.name = "held";
    parent.add(this.rig.root);
    this.setShadows(lod);
  }

  get lod(): Lod {
    return this.lodNow;
  }

  /** Switches the level of detail (and the ink line, which only the nearest bodies carry). */
  setLod(lod: Lod): void {
    const ink = this.outline && lod === 0;
    if (lod !== this.lodNow) {
      this.rig.setLod(lod);
      this.lodNow = lod;
      this.setShadows(lod);
    }
    this.rig.setOutline(ink);
    if (lod === 2) this.hideProps();
  }

  private setShadows(lod: Lod): void {
    this.rig.root.traverse((o) => {
      const m = o as { isMesh?: boolean; castShadow: boolean; name: string };
      if (m.isMesh && !m.name.startsWith("outline_")) m.castShadow = lod < 2;
    });
  }

  private hideProps(): void {
    for (const p of this.props.values()) p.visible = false;
    this.shown = undefined;
    this.shownL = undefined;
  }

  private prop(name: PropName, variant = 0): Group {
    const key = name === "umbrella" ? `${name}${variant % 12}` : name;
    let g = this.props.get(key);
    if (!g) {
      g = propObject(name, variant, this.lodNow === 0 && this.outline);
      this.holder.add(g);
      this.props.set(key, g);
    }
    return g;
  }

  /** Puts a prop (grip at its origin, long axis +Y) at torso-frame (x, y, z) pointing along `dir`. */
  private holdAt(g: Group, x: number, y: number, z: number, dx: number, dy: number, dz: number, roll = 0): void {
    tmpD.set(dx, dy, dz).normalize();
    tmpQ.setFromUnitVectors(UP, tmpD);
    g.quaternion.copy(tmpQ);
    if (roll !== 0) g.rotateY(roll);
    g.position.set(x, y, z);
    g.visible = true;
  }

  private reach(side: 1 | -1, aim: Aim, dt: number, rate = 12): void {
    const j = this.rig.joints;
    const P = this.rig.proportions;
    const sh = side === 1 ? j.shoulderR : j.shoulderL;
    const el = side === 1 ? j.elbowR : j.elbowL;
    const w0 = side === 1 ? this.wR : this.wL;
    const w = damp(w0, aim.w, rate, dt);
    if (side === 1) this.wR = w;
    else this.wL = w;
    if (w < 0.01) return;
    solveArm(P.armUpper, P.armLower, side, aim.x - side * P.shoulderHalfWidth, aim.y - sh.position.y, aim.z, this.ang);
    sh.rotation.x = lerp(sh.rotation.x, this.ang.a, w);
    sh.rotation.z = lerp(sh.rotation.z, this.ang.b, w);
    el.rotation.x = lerp(el.rotation.x, this.ang.e, w);
  }

  private aimAt(a: Aim, x: number, y: number, z: number, w = 1): void {
    a.x = x;
    a.y = y;
    a.z = z;
    a.w = w;
  }

  /** Advances the body: animator first, then the trade's pose on top. `dt` seconds. */
  update(dt: number, s: BodyState): void {
    const j = this.rig.joints;
    const P = this.rig.proportions;
    const sitting = s.act === "sit";
    this.anim.update(dt, { speed: s.speed, flags: FLAG.GROUNDED, vy: 0 });
    const near = this.lodNow < 2;
    this.sit = damp(this.sit, sitting ? 1 : 0, 9, dt);
    const L = P.armUpper + P.armLower;
    const gy = -(j.pelvis.position.y + j.torso.position.y); // ground level in the torso frame
    const sy = j.shoulderR.position.y;
    const t = s.t;
    const aimR = this.aimR;
    const aimL = this.aimL;
    let wantR = 0;
    let wantL = 0;
    let torso = 0; // forward lean, radians
    let headPitch = 0;
    let heldR: Group | undefined;
    let heldL: Group | undefined;
    let gripR: number | undefined;
    let gripL: number | undefined;
    const stand = 1 - this.sit;

    switch (s.act) {
      case "sweep": {
        if (!near) break;
        // the foot of the broom sweeps a short arc on the flags ahead; the hands ride the handle above it
        const sw = Math.sin(t * 2.3);
        const fx = 0.08 + sw * 0.22;
        const fz = -0.72 - L * 0.12;
        const cx = 0.12;
        const cy = sy - 0.22 * L;
        const cz = -0.22;
        tmpV.set(cx - fx, cy - gy, cz - fz).normalize();
        this.aimAt(aimR, fx + tmpV.x * 1.17, gy + tmpV.y * 1.17, fz + tmpV.z * 1.17);
        this.aimAt(aimL, fx + tmpV.x * 0.75, gy + tmpV.y * 0.75, fz + tmpV.z * 0.75);
        const g = this.prop("broom");
        this.holdAt(g, aimR.x, aimR.y, aimR.z, tmpV.x, tmpV.y, tmpV.z);
        heldR = g;
        wantR = wantL = 1;
        torso = 0.16;
        headPitch = 0.3;
        gripR = 0.85;
        gripL = 0.85;
        break;
      }
      case "hammer": {
        if (!near) break;
        // a stroke every 1.5 s: up (slow), strike (fast), a beat on the anvil; the left hand steadies the work on the anvil's face
        const p = (t / 1.5) % 1;
        const up = sm(0, 0.62, p) * (1 - sm(0.62, 0.72, p));
        const hy = lerp(gy + 0.9, gy + 1.7 + L * 0.1, up);
        const hz = lerp(-0.62, -0.28, up);
        this.aimAt(aimR, 0.16, hy, hz);
        this.aimAt(aimL, -0.08, gy + 0.9, -0.66);
        const g = this.prop("hammer");
        this.holdAt(g, aimR.x, aimR.y, aimR.z, 0.05, lerp(-0.2, 1, up), lerp(-1, -0.25, up), Math.PI / 2);
        heldR = g;
        wantR = wantL = 1;
        torso = 0.18 + (1 - up) * 0.12;
        headPitch = 0.4;
        gripR = 0.9;
        gripL = 0.5;
        break;
      }
      case "scrub": {
        const sc = Math.sin(t * 5.5);
        this.aimAt(aimR, 0.14, gy + 0.7 - 0.02, -0.5 - 0.09 * sc);
        this.aimAt(aimL, -0.14, gy + 0.7, -0.5 + 0.09 * sc);
        wantR = wantL = 1;
        torso = 0.5;
        headPitch = 0.35;
        gripR = gripL = 0.4;
        break;
      }
      case "hang": {
        const a = Math.sin(t * 2.8);
        this.aimAt(aimR, 0.14 + 0.06 * a, gy + 2.0, -0.3);
        this.aimAt(aimL, -0.14 - 0.06 * a, gy + 1.9 + 0.05 * a, -0.34);
        wantR = wantL = 1;
        headPitch = -0.3;
        gripR = gripL = 0.6;
        break;
      }
      case "tend": {
        // bent double over the beds, hands working the soil
        const w = Math.sin(t * 3.1);
        this.aimAt(aimR, 0.16, gy + 0.32, -0.62 + 0.08 * w);
        this.aimAt(aimL, -0.16, gy + 0.3, -0.58 - 0.08 * w);
        wantR = wantL = 1;
        torso = 0.95;
        headPitch = 0.5;
        gripR = gripL = 0.7;
        break;
      }
      case "hive": {
        const w = Math.sin(t * 0.9);
        this.aimAt(aimR, 0.12, sy - 0.25 * L, -0.5 * L - 0.1);
        this.aimAt(aimL, -0.12, sy - 0.32 * L, -0.42 * L - 0.1 + 0.03 * w);
        wantR = wantL = 1;
        torso = 0.22;
        headPitch = 0.18;
        gripR = 0.3;
        gripL = 0.3;
        break;
      }
      case "fish": {
        // the rod held out over the water at forty-five degrees; a slow tug now and then
        if (!near) break;
        const tug = Math.max(0, Math.sin(t * 0.7) - 0.86) * 4;
        this.aimAt(aimR, 0.13, gy + 1.0, -0.36);
        this.aimAt(aimL, -0.02, gy + 1.06, -0.3);
        const g = this.prop("rod");
        this.holdAt(g, aimR.x, aimR.y, aimR.z, 0.05, Math.cos(1.0 - tug * 0.12), -Math.sin(1.0 - tug * 0.12));
        heldR = g;
        wantR = wantL = 1;
        torso = -0.05;
        headPitch = 0.22;
        gripR = 0.85;
        gripL = 0.8;
        break;
      }
      case "read":
      case "write": {
        if (!near) break;
        // a book held open against the chest in the left hand; the right hand writes in it
        const w = s.act === "write" ? Math.sin(t * 6) * 0.015 : 0;
        this.aimAt(aimL, -0.02, sy - 0.3 * L, -0.34 * L - 0.08);
        this.aimAt(aimR, 0.09 + w, sy - 0.3 * L, -0.3 * L - 0.1);
        const g = this.prop("book");
        this.holdAt(g, -0.02, sy - 0.24 * L, -0.34 * L - 0.12, 0, 0.55, -0.83, 0.15);
        heldL = g;
        wantR = wantL = 1;
        headPitch = 0.45;
        gripL = 0.6;
        gripR = 0.9;
        break;
      }
      case "sell": {
        // both hands on the counter (hip height), one lifted now and then to show the goods
        const show = sm(0.55, 0.62, ((t / 7) % 1)) * (1 - sm(0.8, 0.9, ((t / 7) % 1)));
        this.aimAt(aimL, -0.16, gy + 0.98, -0.5);
        this.aimAt(aimR, 0.16 + 0.06 * show, lerp(gy + 0.98, sy - 0.1, show), lerp(-0.5, -0.42, show));
        wantR = wantL = 1;
        torso = 0.1;
        gripL = 0.3;
        gripR = lerp(0.3, 0.6, show);
        break;
      }
      case "ring": {
        if (!near) break;
        const sw = Math.sin(t * 10);
        this.aimAt(aimR, 0.2 + 0.1 * sw, sy + 0.02, -0.24);
        const g = this.prop("bell");
        this.holdAt(g, aimR.x, aimR.y, aimR.z, 0.6 * sw, 1, 0);
        heldR = g;
        wantR = 1;
        headPitch = -0.15;
        gripR = 0.9;
        break;
      }
      case "lookup": {
        // a hand over the eyes, the head back; the other hand takes out a watch
        this.aimAt(aimR, 0.05, sy + 0.16 * L, -0.34 * L - 0.06);
        this.aimAt(aimL, -0.1, sy - 0.32 * L, -0.24 * L);
        wantR = wantL = 1;
        headPitch = -0.55;
        torso = -0.08;
        gripR = 0.2;
        gripL = 0.6;
        break;
      }
      case "draw": {
        // hand over hand on the well rope
        const w = Math.sin(t * 3.4);
        this.aimAt(aimR, 0.12, gy + 1.0 + 0.16 * w, -0.5 - 0.06 * w);
        this.aimAt(aimL, -0.12, gy + 1.0 - 0.16 * w, -0.5 + 0.06 * w);
        wantR = wantL = 1;
        torso = 0.2;
        headPitch = 0.3;
        gripR = gripL = 0.85;
        break;
      }
      case "lamp": {
        if (!near) break;
        // the pole raised to the lamp on its bracket
        const w = Math.sin(t * 1.3) * 0.04;
        this.aimAt(aimR, 0.16, sy + 0.05 * L, -0.34 * L);
        this.aimAt(aimL, -0.12, sy - 0.3 * L, -0.26 * L);
        const g = this.prop("pole");
        this.holdAt(g, aimR.x, aimR.y, aimR.z, 0.02, 1, -0.28 + w);
        heldR = g;
        wantR = wantL = 1;
        headPitch = -0.45;
        gripR = 0.9;
        gripL = 0.7;
        break;
      }
      case "sack": {
        // stooping to the pile and straightening with a sack
        const p = (t / 4.2) % 1;
        const bend = 1 - sm(0.0, 0.4, p);
        const lift = sm(0.4, 0.9, p);
        this.aimAt(aimR, 0.2, lerp(gy + 0.3, sy - 0.4 * L, lift), -0.5);
        this.aimAt(aimL, -0.2, lerp(gy + 0.3, sy - 0.4 * L, lift), -0.5);
        torso = 0.85 * bend + 0.1;
        headPitch = 0.3 * bend;
        wantR = wantL = 1;
        gripR = gripL = 0.85;
        if (near && lift > 0.05) {
          const g = this.prop("sack");
          g.position.set(0, lerp(gy + 0.4, sy - 0.42 * L, lift), -0.34);
          g.rotation.set(0, 0, 0);
          g.visible = true;
          heldR = g;
        }
        break;
      }
      case "chat": {
        // talkers gesture: the right hand describes something, the head bobs; listeners fold their arms a little
        const g = s.talk;
        const w = Math.sin(t * 3.1) * 0.5 + Math.sin(t * 5.3) * 0.5;
        this.aimAt(aimR, 0.2 + 0.05 * w, sy - lerp(0.42, 0.22, g) * L + 0.05 * w * g, -0.34 * L - 0.1);
        this.aimAt(aimL, -0.14, sy - 0.46 * L, -0.28 * L);
        wantR = 0.5 + 0.5 * g;
        wantL = 0.3;
        headPitch = 0.04 + 0.1 * g * Math.sin(t * 4.2);
        gripR = 0.3;
        break;
      }
      case "lean":
      case "shelter": {
        // arms folded across the chest, weight on one hip
        this.aimAt(aimR, -0.02, sy - 0.42 * L, -0.26 * L - 0.06);
        this.aimAt(aimL, 0.02, sy - 0.5 * L, -0.24 * L - 0.06);
        wantR = wantL = 0.9;
        torso = -0.04;
        gripR = gripL = 0.5;
        break;
      }
      case "sit": {
        // hands on the knees (a reader takes a book)
        const reading = s.carry === "book";
        this.aimAt(aimR, 0.12, reading ? sy - 0.3 * L : -0.05, reading ? -0.3 * L - 0.1 : -P.legUpper * 0.72);
        this.aimAt(aimL, -0.12, reading ? sy - 0.3 * L : -0.05, reading ? -0.34 * L - 0.1 : -P.legUpper * 0.72);
        wantR = wantL = 0.95;
        headPitch = reading ? 0.45 : 0.06;
        if (reading && near) {
          const g = this.prop("book");
          this.holdAt(g, -0.0, sy - 0.24 * L, -0.34 * L - 0.12, 0, 0.55, -0.83, 0.15);
          heldL = g;
        }
        gripR = gripL = 0.5;
        break;
      }
      case "play": {
        // hopping in place while waiting
        if (s.speed < 0.3) {
          const hop = Math.abs(Math.sin(t * 6.5));
          j.root.position.y += hop * 0.1;
          j.shoulderL.rotation.x += Math.sin(t * 6.5) * 0.6;
          j.shoulderR.rotation.x -= Math.sin(t * 6.5) * 0.6;
          j.hipL.rotation.x = -hop * 0.25;
          j.hipR.rotation.x = hop * 0.25;
        }
        break;
      }
      default:
        break;
    }

    // ---- what is carried (unless the trade holds something already) ---------------------------------------------------------------------
    if (!heldR && !heldL && s.act !== "sit") {
      switch (s.carry) {
        case "sack":
        case "basket":
        case "loaves":
        case "washing":
        case "fish":
        case "chair": {
          const name: PropName = s.carry === "sack" ? "sack" : s.carry === "basket" ? "pears" : s.carry === "loaves" ? "loaves" : s.carry === "washing" ? "washing" : s.carry === "fish" ? "fishcrate" : "chair";
          const g = this.prop(name);
          const cy = sy - (s.carry === "sack" ? 0.44 : 0.5) * L;
          g.position.set(0, cy, -0.3 - 0.02 * L);
          g.rotation.set(0, 0, 0);
          g.visible = near;
          heldR = g;
          this.aimAt(aimR, 0.2, cy - 0.02, -0.3);
          this.aimAt(aimL, -0.2, cy - 0.02, -0.3);
          wantR = wantL = 1;
          gripR = gripL = 0.8;
          break;
        }
        case "bucket": {
          const g = this.prop("bucket");
          this.aimAt(aimR, 0.2, gy + 0.78, -0.02);
          this.holdAt(g, aimR.x, aimR.y, aimR.z, 0, 1, 0);
          g.visible = near;
          heldR = g;
          wantR = 1;
          gripR = 0.9;
          break;
        }
        case "lantern": {
          const g = this.prop("lantern");
          this.aimAt(aimR, 0.2, gy + 1.0, -0.24);
          this.holdAt(g, aimR.x, aimR.y, aimR.z, 0, 1, 0);
          g.visible = true;
          heldR = g;
          wantR = 0.9;
          gripR = 0.9;
          break;
        }
        case "book": {
          if (s.act === "read" || s.act === "write") break;
          const g = this.prop("book");
          this.aimAt(aimL, -0.12, sy - 0.5 * L, -0.28 * L);
          this.holdAt(g, aimL.x, aimL.y, aimL.z, 0, 0.9, -0.4, 0.2);
          g.visible = near;
          heldL = g;
          wantL = 0.9;
          gripL = 0.6;
          break;
        }
        case "bottle": {
          const g = this.prop("bottle");
          this.aimAt(aimR, 0.14, sy - 0.4 * L, -0.3 * L - 0.04);
          this.holdAt(g, aimR.x, aimR.y, aimR.z, 0, 1, 0);
          g.visible = near;
          heldR = g;
          wantR = 0.9;
          gripR = 0.9;
          break;
        }
        default:
          break;
      }
    }

    // ---- the old lean on a cane in the left hand (standing or strolling) --------------------------------------------------------------------
    if (s.cane && !heldL && near && (s.act === "idle" || s.act === "walk" || s.act === "chat" || s.act === "lean")) {
      const g = this.prop("cane");
      this.aimAt(aimL, -0.2, gy + 0.94, -0.1 - Math.min(0.12, s.speed * 0.06));
      this.holdAt(g, aimL.x, aimL.y, aimL.z, 0, 1, 0);
      heldL = g;
      wantL = 1;
      gripL = 0.9;
    }

    // ---- rain: an umbrella in the right hand, or a hand over the head ------------------------------------------------------------------------
    const wet = s.rain > 0.36 && !s.covered && !sitting && s.act !== "hammer" && s.act !== "sweep" && s.act !== "sell";
    if (wet && !heldR && near) {
      if (s.umbrella) {
        const g = this.prop("umbrella", s.hue);
        this.aimAt(aimR, 0.26, sy + 0.05 * L, -0.12);
        this.holdAt(g, aimR.x, aimR.y, aimR.z, 0, 1, 0);
        heldR = g;
        wantR = 1;
        gripR = 0.9;
      } else {
        this.aimAt(aimR, 0.08, sy + 0.32 * L, -0.16 * L);
        wantR = 0.9;
        torso += 0.12;
        headPitch += 0.15;
      }
    }

    // ---- a wave for a passer-by ------------------------------------------------------------------------------------------------------------
    if (s.wave > 0.02 && !heldR && near && s.act !== "sit") {
      const w = Math.sin(t * 9);
      this.aimAt(aimR, 0.14 + 0.05 * w, sy + 0.34 * L, -0.12 * L);
      wantR = Math.max(wantR, s.wave);
      gripR = 0;
    }

    // ---- apply ----------------------------------------------------------------------------------------------------------------------------------
    aimR.w = wantR;
    aimL.w = wantL;
    this.lean = damp(this.lean, torso, 6, dt);
    j.torso.rotation.x -= this.lean * stand;
    if (this.sit > 0.01) this.applySeat(dt, s);
    if (near) {
      this.reach(1, aimR, dt);
      this.reach(-1, aimL, dt);
    }
    // (positive head.rotation.x looks UP: a leaning torso is met by a raised head, and `headPitch` is how far the eyes go DOWN)
    this.headDown = damp(this.headDown, headPitch, 6, dt);
    j.head.rotation.x += this.lean * 0.55 * stand - this.headDown;
    // looking at whoever is near (relative to the body), on top of the animator's own glances
    this.lookYaw = damp(this.lookYaw, s.lookYaw * s.look, 5, dt);
    this.lookPitch = damp(this.lookPitch, s.lookPitch * s.look, 5, dt);
    j.head.rotation.y += this.lookYaw;
    j.head.rotation.x += this.lookPitch;
    this.hands.update(dt, FLAG.GROUNDED, s.speed, this.anim.currentExpression, gripL, gripR);

    // props that are not in use this frame go away
    if (this.shown && this.shown !== heldR && this.shown !== heldL) this.shown.visible = false;
    if (this.shownL && this.shownL !== heldR && this.shownL !== heldL) this.shownL.visible = false;
    this.shown = heldR;
    this.shownL = heldL;
    j.root.position.y += s.ground;
  }

  /** The seat: thighs level, shins down, the pelvis at bench height, feet found from the leg length. */
  private applySeat(dt: number, _s: BodyState): void {
    const j = this.rig.joints;
    const P = this.rig.proportions;
    const k = this.sit;
    const H = (FolkBody.SEAT + 0.09) / this.scale; // hip height in the rig's own units
    const foot = 0.05 * P.scale;
    const ca = Math.min(1, Math.max(-1, (H - P.legLower - foot) / P.legUpper));
    const a = Math.min(1.85, Math.max(1.25, Math.acos(ca)));
    const legs = lerp(0, 1, k);
    j.hipL.rotation.x = lerp(j.hipL.rotation.x, a, legs);
    j.hipR.rotation.x = lerp(j.hipR.rotation.x, a, legs);
    j.kneeL.rotation.x = lerp(j.kneeL.rotation.x, -a, legs);
    j.kneeR.rotation.x = lerp(j.kneeR.rotation.x, -a, legs);
    j.hipL.rotation.z = lerp(j.hipL.rotation.z, -0.06, legs);
    j.hipR.rotation.z = lerp(j.hipR.rotation.z, 0.06, legs);
    j.pelvis.position.y = lerp(j.pelvis.position.y, H, k);
    j.pelvis.position.z = lerp(j.pelvis.position.z, 0.06, k);
    j.torso.rotation.x = lerp(j.torso.rotation.x, -(P.lean * 0.6), k);
    this.hipY = H;
    void dt;
  }

  /** Where the body stands and which way it faces; call BEFORE `update` (the animator reads the turn from the yaw). */
  place(x: number, z: number, facing: number): void {
    const r = this.rig.root;
    r.position.x = x;
    r.position.z = z;
    r.rotation.y = facing;
  }

  dispose(): void {
    for (const p of this.props.values()) p.removeFromParent();
    this.props.clear();
    this.rig.dispose();
  }
}

