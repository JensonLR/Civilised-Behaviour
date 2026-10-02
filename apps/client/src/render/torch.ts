import { AdditiveBlending, BufferGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { toonMaterial } from "./world/toon.ts";

/**
 * A lit torch held upright in a hand (D-047: the Syndicate's raiders on the Raid on the Post, whose copy has always had them waving torches). One shared stick and two shared flame
 * cones for every torch in the scene; the flames are unlit (they ARE the light) and flicker by a pure function of time and a per-torch phase. `TorchHold` keeps the torch upright
 * whatever the wrist is doing (a person holds a torch up, not along their fingers), allocation-free per frame.
 */

const C = PALETTE.camp;
let shared: { stick: BufferGeometry; outer: BufferGeometry; inner: BufferGeometry; glow: BufferGeometry; wood: ReturnType<typeof toonMaterial>; flameOuter: MeshBasicMaterial; flameCore: MeshBasicMaterial; glowMat: MeshBasicMaterial } | undefined;
function parts(): NonNullable<typeof shared> {
  if (!shared) {
    // sized to read at fighting distance on the caricature's hand (the first cut, a 0.26 m flame, was a speck at 6 m: looked at, D-047)
    const stick = new CylinderGeometry(0.03, 0.04, 0.9, 6);
    stick.translate(0, 0.25, 0);
    const outer = new ConeGeometry(0.12, 0.42, 7);
    outer.translate(0, 0.86, 0);
    const inner = new ConeGeometry(0.065, 0.26, 6);
    inner.translate(0, 0.8, 0);
    const glow = new IcosahedronGeometry(0.26, 1);
    glow.translate(0, 0.84, 0);
    shared = {
      stick, outer, inner, glow,
      wood: toonMaterial({}),
      flameOuter: new MeshBasicMaterial({ color: C.flameOuter, transparent: true, opacity: 0.92, depthWrite: false }),
      flameCore: new MeshBasicMaterial({ color: C.flameCore }),
      glowMat: new MeshBasicMaterial({ color: C.flameMid, transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending }),
    };
  }
  return shared;
}

const qWrist = new Quaternion();
const qUp = new Quaternion();
const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.18);

/** One character's torch: built on first use, hung on the hand bone, shown or hidden each frame. */
export class TorchHold {
  readonly group = new Group();
  private readonly outer: Mesh;
  private readonly glow: Mesh;
  private readonly phase: number;

  constructor(seed: number) {
    const p = parts();
    const stick = new Mesh(p.stick, p.wood);
    stick.castShadow = true;
    this.outer = new Mesh(p.outer, p.flameOuter);
    const core = new Mesh(p.inner, p.flameCore);
    this.glow = new Mesh(p.glow, p.glowMat);
    this.group.add(stick, this.outer, core, this.glow);
    this.group.name = "torch";
    this.group.visible = false;
    this.phase = (seed % 97) * 0.37;
  }

  /** Hangs the torch on `hand` (the wrist bone). Call again after the rig is rebuilt. */
  attach(hand: Group): void {
    hand.add(this.group);
  }

  /** Shows it (or not), keeps it upright against the hand's world turn, and flickers the flame. `t` is seconds. */
  update(on: boolean, t: number): void {
    this.group.visible = on;
    if (!on) return;
    const hand = this.group.parent;
    if (hand) {
      hand.getWorldQuaternion(qWrist);
      // world orientation wanted: upright with a slight forward lean; local = inverse(parent world) * wanted
      qUp.copy(tilt);
      this.group.quaternion.copy(qWrist.invert()).multiply(qUp);
    }
    const f = 0.85 + 0.15 * Math.sin(t * 17 + this.phase) * Math.sin(t * 7.3 + this.phase * 2.1);
    this.outer.scale.set(1, f, 1);
    this.glow.scale.setScalar(0.9 + 0.2 * f);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
