import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { FLAG } from "@cb/shared";

const SLOT_COLOURS = [0x9c3b2e, 0x2f5f8f, 0x4c7a3d, 0x8f6a1f];

/**
 * M1 stand-in figure: a rigid articulated hierarchy (pelvis > torso > head/arms, hips > legs)
 * that already has the joint layout the M2 procedural caricature generator will fill in, so
 * animation code written against it carries over. Not shipped as final art.
 */
export class Puppet {
  readonly root = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private phase = 0;

  constructor(slot: number) {
    const cloth = new MeshStandardMaterial({ color: SLOT_COLOURS[slot % 4], roughness: 0.85 });
    const skin = new MeshStandardMaterial({ color: 0xd9a27f, roughness: 0.75 });
    const dark = new MeshStandardMaterial({ color: 0x2b2118, roughness: 0.9 });

    const pelvis = new Group();
    pelvis.position.y = 0.9;
    this.root.add(pelvis);

    this.torso.position.y = 0.05;
    const belly = new Mesh(new SphereGeometry(0.42, 16, 12), cloth);
    belly.scale.set(1, 1.05, 0.95);
    belly.position.y = 0.28;
    this.torso.add(belly);
    pelvis.add(this.torso);

    this.head.position.y = 0.82;
    const skull = new Mesh(new SphereGeometry(0.27, 16, 12), skin);
    const nose = new Mesh(new ConeGeometry(0.07, 0.24, 8), skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.02, -0.3);
    const moustache = new Mesh(new CapsuleGeometry(0.035, 0.34, 4, 8), dark);
    moustache.rotation.z = Math.PI / 2;
    moustache.position.set(0, -0.13, -0.24);
    const hat = new Mesh(new CylinderGeometry(0.2, 0.26, 0.34, 12), dark);
    hat.position.y = 0.34;
    const brim = new Mesh(new CylinderGeometry(0.38, 0.38, 0.04, 16), dark);
    brim.position.y = 0.19;
    this.head.add(skull, nose, moustache, hat, brim);
    this.torso.add(this.head);

    const limbGeo = new CapsuleGeometry(0.09, 0.42, 4, 8);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 0.46, 0.68, 0);
      const seg = new Mesh(limbGeo, cloth);
      seg.position.y = -0.26;
      arm.add(seg);
      this.torso.add(arm);
    }
    const legGeo = new CapsuleGeometry(0.11, 0.5, 4, 8);
    const bootGeo = new SphereGeometry(0.17, 10, 8);
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(side * 0.18, 0, 0);
      const seg = new Mesh(legGeo, dark);
      seg.position.y = -0.36;
      const boot = new Mesh(bootGeo, dark);
      boot.scale.set(1, 0.7, 1.5);
      boot.position.set(0, -0.72, -0.06);
      leg.add(seg, boot);
      pelvis.add(leg);
    }
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
  }

  /** Poses the figure. `speed` in m/s, `facing` radians (0 = -Z), `flags` = FLAG bits. */
  update(dt: number, x: number, y: number, z: number, facing: number, speed: number, flags: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
    const grounded = (flags & FLAG.GROUNDED) !== 0;
    const crouch = (flags & FLAG.CROUCHING) !== 0 || (flags & FLAG.DOWNED) !== 0;
    this.phase += dt * (2.5 + speed * 1.25);
    const swing = grounded ? Math.min(speed / 4.4, 1.4) : 0.2;
    const s = Math.sin(this.phase * 2) * 0.85 * swing;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8;
    this.armR.rotation.x = s * 0.8;
    this.torso.rotation.z = Math.sin(this.phase * 2) * 0.05 * swing;
    this.torso.position.y = 0.05 + Math.abs(Math.sin(this.phase * 2)) * 0.05 * swing - (crouch ? 0.28 : 0);
    this.root.rotation.z = (flags & FLAG.DOWNED) !== 0 ? Math.PI / 2 : 0;
    this.head.rotation.y = Math.sin(this.phase) * 0.06;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshStandardMaterial).dispose();
      }
    });
    this.root.removeFromParent();
  }
}
