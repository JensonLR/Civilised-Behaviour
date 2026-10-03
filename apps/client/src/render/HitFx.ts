import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  type Scene,
} from "three";
import type { GoreLevel } from "@cb/procedural/three";
import { PALETTE } from "@cb/shared";
import type { DecalField } from "./decals/DecalField.ts";

export const HITFX = {
  /** Live particle cap (a hit spawns 6-18; four players can only produce so many per second). */
  maxParticles: 240,
  /** Ground stains kept; the oldest is recycled. */
  maxDecals: 40,
  /** Seconds before a decal has shrunk away completely. */
  decalLife: 45,
  gravity: 13,
} as const;

interface Style {
  /** Particle colours picked per particle. */
  colors: number[];
  count: [number, number];
  size: number;
  speed: number;
  /** Fraction of grounded particles that leave a stain. */
  stain: number;
  stainColor: number;
}

// "off" keeps the impact readable with a harmless burst of dust and stars: same timing, no blood.
const STYLES: Record<GoreLevel, Style> = {
  full: { colors: [...PALETTE.hitFx.full], count: [9, 22], size: 0.045, speed: 4.2, stain: 0.5, stainColor: PALETTE.hitFx.stain },
  reduced: { colors: [...PALETTE.hitFx.reduced], count: [4, 9], size: 0.035, speed: 3.2, stain: 0, stainColor: 0 },
  off: { colors: [...PALETTE.hitFx.off], count: [5, 10], size: 0.04, speed: 3.6, stain: 0, stainColor: 0 },
};

const dummy = new Object3D();
const color = new Color();

/**
 * Cosmetic hit effects: a pooled burst of particles (blood, or dust with gore off) and pooled ground stains.
 * Everything is fixed-size, allocation-free per frame, and driven by the client only; the server never hears about it.
 * Randomness here is presentation-only (Math.random is fine; it never feeds the shared simulation).
 */
export class HitFx {
  private readonly parts: InstancedMesh;
  private readonly decals: InstancedMesh;
  // Particle state (struct-of-arrays).
  private readonly px = new Float32Array(HITFX.maxParticles);
  private readonly py = new Float32Array(HITFX.maxParticles);
  private readonly pz = new Float32Array(HITFX.maxParticles);
  private readonly vx = new Float32Array(HITFX.maxParticles);
  private readonly vy = new Float32Array(HITFX.maxParticles);
  private readonly vz = new Float32Array(HITFX.maxParticles);
  private readonly life = new Float32Array(HITFX.maxParticles);
  private readonly size = new Float32Array(HITFX.maxParticles);
  private readonly stainable = new Uint8Array(HITFX.maxParticles);
  private nextPart = 0;
  // Decal state.
  private readonly dx = new Float32Array(HITFX.maxDecals);
  private readonly dy = new Float32Array(HITFX.maxDecals);
  private readonly dz = new Float32Array(HITFX.maxDecals);
  private readonly dsize = new Float32Array(HITFX.maxDecals);
  private readonly dage = new Float32Array(HITFX.maxDecals).fill(Infinity);
  private nextDecal = 0;
  /** The persistent field's decals (render/decals): when attached, blood that lands is left there (it stays, spreads and dries) instead of in this module's own short-lived stains. */
  private field: DecalField | undefined;
  private landed = 0;

  constructor(
    scene: Scene,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.parts = new InstancedMesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial(), HITFX.maxParticles);
    this.parts.instanceMatrix.setUsage(DynamicDrawUsage);
    this.parts.frustumCulled = false; // instances move; the base bounding sphere is meaningless
    this.parts.count = 0;
    const stainMat = new MeshBasicMaterial({ color: PALETTE.hitFx.stain, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.decals = new InstancedMesh(new CircleGeometry(1, 9), stainMat, HITFX.maxDecals);
    this.decals.instanceMatrix.setUsage(DynamicDrawUsage);
    this.decals.frustumCulled = false;
    this.decals.count = 0;
    scene.add(this.parts, this.decals);
  }

  /**
   * Routes this module's stains to the persistent decal field (`Stage` creates the field; the integrator attaches it). With a field attached the short-lived
   * stain pool here stays empty; without one nothing changes. The field applies the Full / Reduced / Off look itself.
   */
  attachDecals(field: DecalField | undefined): void {
    this.field = field;
  }

  get liveParticles(): number {
    let n = 0;
    for (let i = 0; i < HITFX.maxParticles; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  get liveDecals(): number {
    let n = 0;
    for (let i = 0; i < HITFX.maxDecals; i++) if (this.dage[i]! < HITFX.decalLife) n++;
    return n;
  }

  /**
   * A blow landed at (x,y,z) pushing the victim along the unit vector (dx,dz); `power` 0..1. Particles fly with the blow and
   * fan out; with gore off the same burst is dust.
   */
  /** `up` 0..1 throws the drops upward as well (a head wound, a severed joint: a fountain, not a splash). */
  burst(x: number, y: number, z: number, dx: number, dz: number, power: number, gore: GoreLevel, up = 0): void {
    if (!(power > 0) || !Number.isFinite(x + y + z + dx + dz)) return;
    const st = STYLES[gore];
    if (this.field) {
      // the blow leaves its mark where the victim stands: drops thrown along the push, and on a hard hit a fan of spray (the field hides what the gore level hides)
      const len = Math.hypot(dx, dz) || 1;
      const ground = this.groundAt(x, z);
      const reach = 0.5 + 0.9 * Math.min(1, power);
      this.field.spatterAt(x + (dx / len) * reach, z + (dz / len) * reach, dx, dz, 0.22 + 0.3 * Math.min(1, power));
      if (power > 0.45 && y - ground < 1.9) this.field.sprayAt(x + (dx / len) * 0.2, z + (dz / len) * 0.2, dx, dz, 0.9 + 1.1 * power);
    }
    const n = Math.round(st.count[0] + (st.count[1] - st.count[0]) * Math.min(1, power));
    for (let k = 0; k < n; k++) {
      const i = this.nextPart;
      this.nextPart = (this.nextPart + 1) % HITFX.maxParticles;
      const spread = (Math.random() - 0.5) * 1.6;
      const s = st.speed * (0.4 + Math.random() * 0.9) * (0.5 + power * 0.7);
      this.px[i] = x + (Math.random() - 0.5) * 0.12;
      this.py[i] = y + (Math.random() - 0.5) * 0.12;
      this.pz[i] = z + (Math.random() - 0.5) * 0.12;
      // Rotate the push direction by `spread` in the ground plane.
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      this.vx[i] = (dx * c - dz * sn) * s;
      this.vz[i] = (dx * sn + dz * c) * s;
      this.vy[i] = 1.2 + Math.random() * 2.8 * (0.5 + power) + up * (2 + Math.random() * 3.5);
      this.life[i] = 0.5 + Math.random() * 0.6;
      this.size[i] = st.size * (0.6 + Math.random() * 0.9);
      this.stainable[i] = Math.random() < st.stain ? 1 : 0;
      color.setHex(st.colors[Math.floor(Math.random() * st.colors.length)]!);
      this.parts.setColorAt(i, color);
    }
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let maxLive = 0;
    for (let i = 0; i < HITFX.maxParticles; i++) {
      if (this.life[i]! <= 0) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.parts.setMatrixAt(i, dummy.matrix);
        continue;
      }
      maxLive = i + 1;
      this.life[i]! -= dt;
      this.vy[i]! -= HITFX.gravity * dt;
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      this.pz[i]! += this.vz[i]! * dt;
      const ground = this.groundAt(this.px[i]!, this.pz[i]!);
      if (this.py[i]! <= ground + 0.01) {
        if (this.stainable[i]) {
          // (with the field attached the drops of a burst land as small spatters, one in three: the burst itself already left its mark)
          if (!this.field) this.addDecal(this.px[i]!, ground, this.pz[i]!, this.size[i]!);
          else if (++this.landed % 3 === 0) this.field.spatterAt(this.px[i]!, this.pz[i]!, this.vx[i]!, this.vz[i]!, 0.1 + this.size[i]! * 3);
        }
        this.life[i] = 0;
        continue;
      }
      const fade = Math.min(1, this.life[i]! * 3);
      dummy.position.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      dummy.scale.setScalar(this.size[i]! * fade);
      dummy.rotation.set(this.life[i]! * 9, this.life[i]! * 7, 0);
      dummy.updateMatrix();
      this.parts.setMatrixAt(i, dummy.matrix);
    }
    this.parts.count = maxLive;
    this.parts.instanceMatrix.needsUpdate = true;

    let decalMax = 0;
    for (let i = 0; i < HITFX.maxDecals; i++) {
      if (this.dage[i]! >= HITFX.decalLife) continue;
      decalMax = i + 1;
      this.dage[i]! += dt;
      // Grow in over the first 0.15 s (a splat), then shrink away over the last quarter of its life.
      const a = this.dage[i]!;
      const grow = Math.min(1, a / 0.15);
      const fadeOut = Math.min(1, (HITFX.decalLife - a) / (HITFX.decalLife * 0.25));
      dummy.position.set(this.dx[i]!, this.dy[i]! + 0.02, this.dz[i]!);
      dummy.rotation.set(-Math.PI / 2, 0, i * 2.4);
      dummy.scale.setScalar(this.dsize[i]! * grow * Math.max(0, fadeOut));
      dummy.updateMatrix();
      this.decals.setMatrixAt(i, dummy.matrix);
    }
    this.decals.count = decalMax;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** A body bleeds out where it lies (a downed or dead victim): a pool that spreads for `seconds` of bleeding. A no-op without a field. */
  bleedOut(x: number, z: number, radius: number): void {
    this.field?.bloodPool(x, z, radius, 1.3);
  }

  private addDecal(x: number, y: number, z: number, size: number): void {
    const i = this.nextDecal;
    this.nextDecal = (this.nextDecal + 1) % HITFX.maxDecals;
    this.dx[i] = x;
    this.dy[i] = y;
    this.dz[i] = z;
    this.dsize[i] = size * (3.2 + Math.random() * 3);
    this.dage[i] = 0;
  }

  dispose(): void {
    for (const m of [this.parts, this.decals]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.dispose();
    }
  }
}
