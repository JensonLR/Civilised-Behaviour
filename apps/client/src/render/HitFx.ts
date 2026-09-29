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

export const HITFX = {
  /** Live particle cap (a hit spawns 6-18; four players can only produce so many per second). */
  maxParticles: 160,
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
  full: { colors: [...PALETTE.hitFx.full], count: [7, 18], size: 0.045, speed: 4.2, stain: 0.5, stainColor: PALETTE.hitFx.stain },
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
  burst(x: number, y: number, z: number, dx: number, dz: number, power: number, gore: GoreLevel): void {
    if (!(power > 0) || !Number.isFinite(x + y + z + dx + dz)) return;
    const st = STYLES[gore];
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
      this.vy[i] = 1.2 + Math.random() * 2.8 * (0.5 + power);
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
        if (this.stainable[i]) this.addDecal(this.px[i]!, ground, this.pz[i]!, this.size[i]!);
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
