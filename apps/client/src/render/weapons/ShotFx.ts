import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  FogExp2,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type Scene,
} from "three";
import { PALETTE, SURFACE, WEAPON, type SurfaceId } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import { getAtmosphere } from "../world/atmosphere.ts";

/**
 * Cosmetic shot effects: muzzle flashes, drifting powder smoke, tracer streaks, impact puffs by surface, the cannon's fireball and smoke column,
 * and the splinters, chips, clods, sparks and wads that fly. Everything is pooled in fixed struct-of-arrays and drawn as four instanced meshes
 * (soft puffs, additive flashes, streaks, debris), so a battle costs four draw calls and allocates nothing per frame. Presentation only:
 * `Math.random` is fine here, nothing in it ever feeds the simulation. Colours are the palette's `weaponFx` group.
 */

export const SHOTFX = {
  puffs: 260,
  flashes: 28,
  streaks: 110,
  debris: 180,
  /** Flat rings on the ground: the cannon's shock ring and the low ring of dust a round throws up. */
  rings: 14,
  /** Scars a round leaves on the ground (a dent, a lip and cracks); the oldest is recycled. */
  marks: 40,
  /** Seconds a scar stays, the last quarter of it fading. */
  markLife: 40,
} as const;

const FX = PALETTE.weaponFx;

/** Slow, deterministic wind DIRECTION for the smoke (m/s at a gentle breeze): the same everywhere, drifting with the time. The environment publishes only the wind's strength (`getAtmosphere().wind`), not a heading. */
export function windAt(t: number, out: { x: number; z: number }): void {
  out.x = 0.55 * Math.cos(t * 0.045 + 1.3) + 0.25 * Math.sin(t * 0.17);
  out.z = 0.4 * Math.sin(t * 0.038) + 0.2 * Math.cos(t * 0.13 + 0.7);
}

/** How much the weather's wind (0..1, `getAtmosphere().wind`) stretches the smoke's drift: half at a dead calm, more than three times in a gale. */
export const windGain = (strength: number): number => 0.5 + 2.9 * Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0.2));

/** The wind the smoke drifts on at time `t` in weather of strength `strength`: `windAt`'s heading, scaled by `windGain`. Writes `out` (m/s). */
export function smokeWind(t: number, strength: number, out: { x: number; z: number }): void {
  windAt(t, out);
  const g = windGain(strength);
  out.x *= g;
  out.z *= g;
}

/** Where a firearm's lock is behind its muzzle (metres along the barrel), for the percussion cap that flies from it. */
const LOCK_BACK: Record<number, number> = { [WEAPON.PISTOL]: 0.3, [WEAPON.RIFLE]: 0.95, [WEAPON.BLUNDERBUSS]: 0.6 };

/** How near (metres) a round must pass the listener to be heard and seen going by. */
export const WHIZZ_RANGE = 3.2;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const hex = (n: number): number => n;

// ---- instanced billboards ---------------------------------------------------------------------------------------------------------------

const BILLBOARD_VERT = /* glsl */ `
  attribute vec4 iPos;      // world xyz, size
  attribute vec4 iCol;      // rgb, alpha
  attribute vec2 iRot;      // rotation, seed
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vSeed;
  varying float vFog;
  uniform float uFog;
  void main() {
    vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
    float c = cos(iRot.x);
    float s = sin(iRot.x);
    vec2 p = position.xy * iPos.w;
    mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vCol = iCol;
    vSeed = iRot.y;
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-uFog * uFog * d * d);
  }`;

const PUFF_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vCol; varying float vSeed; varying float vFog;
  uniform vec3 uFogColor;
  void main() {
    vec2 q = vUv - 0.5;
    float r = length(q) * 2.0;
    float a = atan(q.y, q.x);
    // a lumpy edge (three overlapping wobbles per puff, different for each), then two toon bands: lit top-left, shaded bottom-right
    float lump = 0.05 * sin(a * 3.0 + vSeed * 6.2831) + 0.035 * sin(a * 5.0 + vSeed * 17.0) + 0.02 * sin(a * 8.0 - vSeed * 9.0);
    float edge = 1.0 - smoothstep(0.80 + lump, 0.90 + lump, r);
    if (edge < 0.02) discard;
    float lit = dot(normalize(q + 1e-5), vec2(-0.55, 0.83)) * (0.4 + r) ;
    float band = lit > 0.12 ? 1.0 : (lit > -0.35 ? 0.86 : 0.7);
    vec3 col = vCol.rgb * band;
    // an illustrator's puff: a lighter heart, a darker ring at the edge, so a cloud of dust reads against ground of its own colour
    float core = 1.0 - smoothstep(0.0, 0.62, r);
    float rim = smoothstep(0.7, 0.86, r);
    col = mix(col, col + (vec3(1.0) - col) * 0.5, core * 0.85);
    col = mix(col, col * 0.66, rim);
    col = mix(col, uFogColor, vFog);
    // soft inside, firm at the contour
    gl_FragColor = vec4(col, vCol.a * edge * mix(0.74, 1.0, rim));
    // (a raw shader writes linear light straight to an sRGB target: without these two lines every cloud is darker and more saturated than its palette colour)
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const FLASH_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vCol; varying float vSeed; varying float vFog;
  void main() {
    vec2 q = vUv - 0.5;
    float r = length(q) * 2.0;
    float a = atan(q.y, q.x);
    // a hard star of rays with a hot round core (the illustrator's muzzle flash)
    float rays = 0.55 + 0.45 * cos(a * 7.0 + vSeed * 6.2831);
    float star = 1.0 - smoothstep(0.35 * rays + 0.25, 0.42 * rays + 0.55, r);
    float core = 1.0 - smoothstep(0.16, 0.30, r);
    float k = max(star * 0.85, core);
    if (k < 0.04) discard;
    vec3 col = mix(vCol.rgb, vec3(1.0, 0.94, 0.75), core);
    gl_FragColor = vec4(col * (1.0 - vFog), vCol.a * k);
  }`;

const STREAK_VERT = /* glsl */ `
  attribute vec4 iA;   // start xyz, half width
  attribute vec4 iB;   // end xyz, alpha
  attribute vec3 iC;   // colour
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vFog;
  uniform float uFog;
  void main() {
    vec4 a = viewMatrix * vec4(iA.xyz, 1.0);
    vec4 b = viewMatrix * vec4(iB.xyz, 1.0);
    vec2 d = b.xy - a.xy;
    float l = length(d);
    vec2 dir = l > 1e-5 ? d / l : vec2(1.0, 0.0);
    vec2 n = vec2(-dir.y, dir.x);
    vec4 mv = mix(a, b, position.y + 0.5);
    mv.xy += n * position.x * iA.w;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vCol = vec4(iC, iB.w);
    float dist = length(mv.xyz);
    vFog = 1.0 - exp(-uFog * uFog * dist * dist);
  }`;

const STREAK_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vCol; varying float vFog;
  void main() {
    // brightest at the head (uv.y = 1), a soft tail, hard across
    float along = smoothstep(0.0, 1.0, vUv.y);
    float across = 1.0 - smoothstep(0.55, 1.0, abs(vUv.x - 0.5) * 2.0);
    gl_FragColor = vec4(vCol.rgb * (1.0 - vFog), vCol.a * along * across);
  }`;

/** A pool of instanced quads driven by three per-instance attributes. */
class BillboardPool {
  readonly mesh: Mesh;
  readonly pos: InstancedBufferAttribute;
  readonly col: InstancedBufferAttribute;
  readonly rot: InstancedBufferAttribute;

  constructor(scene: Scene, readonly cap: number, frag: string, additive: boolean, order: number, fog: { value: number }, fogColor: { value: Color }) {
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    this.pos = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
    this.col = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
    this.rot = new InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(DynamicDrawUsage);
    geo.setAttribute("iPos", this.pos);
    geo.setAttribute("iCol", this.col);
    geo.setAttribute("iRot", this.rot);
    geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      vertexShader: BILLBOARD_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : 1,
      uniforms: { uFog: fog, uFogColor: fogColor },
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }

  set count(n: number) {
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = n;
  }

  flush(): void {
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.rot.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

const tint = new Color();

export class ShotFx {
  // soft puffs (smoke, dust, fire) --------------------------------------------------------------------------------------------------
  private readonly puffs: BillboardPool;
  private readonly px = new Float32Array(SHOTFX.puffs);
  private readonly py = new Float32Array(SHOTFX.puffs);
  private readonly pz = new Float32Array(SHOTFX.puffs);
  private readonly pvx = new Float32Array(SHOTFX.puffs);
  private readonly pvy = new Float32Array(SHOTFX.puffs);
  private readonly pvz = new Float32Array(SHOTFX.puffs);
  private readonly ps0 = new Float32Array(SHOTFX.puffs);
  private readonly ps1 = new Float32Array(SHOTFX.puffs);
  private readonly page = new Float32Array(SHOTFX.puffs).fill(1);
  private readonly plife = new Float32Array(SHOTFX.puffs).fill(0.0001);
  private readonly pc0 = new Float32Array(SHOTFX.puffs * 3);
  private readonly pc1 = new Float32Array(SHOTFX.puffs * 3);
  private readonly pa = new Float32Array(SHOTFX.puffs);
  private readonly pdrag = new Float32Array(SHOTFX.puffs);
  private readonly prise = new Float32Array(SHOTFX.puffs);
  private readonly prot = new Float32Array(SHOTFX.puffs);
  private readonly prs = new Float32Array(SHOTFX.puffs);
  private nextPuff = 0;
  // flashes -----------------------------------------------------------------------------------------------------------------------
  private readonly flashes: BillboardPool;
  private readonly fx = new Float32Array(SHOTFX.flashes * 3);
  private readonly fsize = new Float32Array(SHOTFX.flashes);
  private readonly fage = new Float32Array(SHOTFX.flashes).fill(1);
  private readonly flife = new Float32Array(SHOTFX.flashes).fill(0.0001);
  private readonly fcol = new Float32Array(SHOTFX.flashes * 3);
  private nextFlash = 0;
  // streaks -----------------------------------------------------------------------------------------------------------------------
  private readonly streaks: Mesh;
  private readonly sA: InstancedBufferAttribute;
  private readonly sB: InstancedBufferAttribute;
  private readonly sC: InstancedBufferAttribute;
  private readonly sx0 = new Float32Array(SHOTFX.streaks * 3);
  private readonly sx1 = new Float32Array(SHOTFX.streaks * 3);
  private readonly sw = new Float32Array(SHOTFX.streaks);
  private readonly sage = new Float32Array(SHOTFX.streaks).fill(1);
  private readonly slife = new Float32Array(SHOTFX.streaks).fill(0.0001);
  private readonly scol = new Float32Array(SHOTFX.streaks * 3);
  private nextStreak = 0;
  // debris ---------------------------------------------------------------------------------------------------------------------------
  private readonly deb: InstancedMesh;
  private readonly dx = new Float32Array(SHOTFX.debris);
  private readonly dy = new Float32Array(SHOTFX.debris);
  private readonly dz = new Float32Array(SHOTFX.debris);
  private readonly dvx = new Float32Array(SHOTFX.debris);
  private readonly dvy = new Float32Array(SHOTFX.debris);
  private readonly dvz = new Float32Array(SHOTFX.debris);
  private readonly dsx = new Float32Array(SHOTFX.debris);
  private readonly dsy = new Float32Array(SHOTFX.debris);
  private readonly dsz = new Float32Array(SHOTFX.debris);
  private readonly drx = new Float32Array(SHOTFX.debris);
  private readonly dry = new Float32Array(SHOTFX.debris);
  private readonly drvx = new Float32Array(SHOTFX.debris);
  private readonly drvy = new Float32Array(SHOTFX.debris);
  private readonly dlife = new Float32Array(SHOTFX.debris);
  private readonly dfade = new Float32Array(SHOTFX.debris);
  private nextDebris = 0;
  // shock rings ---------------------------------------------------------------------------------------------------------------------
  private readonly ring: InstancedMesh;
  private readonly rx = new Float32Array(SHOTFX.rings);
  private readonly ry = new Float32Array(SHOTFX.rings);
  private readonly rz = new Float32Array(SHOTFX.rings);
  private readonly rmax = new Float32Array(SHOTFX.rings);
  private readonly ralpha = new Float32Array(SHOTFX.rings);
  private readonly rlife = new Float32Array(SHOTFX.rings).fill(0.7);
  private readonly rage = new Float32Array(SHOTFX.rings).fill(9);
  private nextRing = 0;

  // ground scars ------------------------------------------------------------------------------------------------------------------
  private readonly marks: InstancedMesh;
  private readonly mx = new Float32Array(SHOTFX.marks);
  private readonly my = new Float32Array(SHOTFX.marks);
  private readonly mz = new Float32Array(SHOTFX.marks);
  private readonly msize = new Float32Array(SHOTFX.marks);
  private readonly mage = new Float32Array(SHOTFX.marks).fill(Infinity);
  private readonly mseed = new Float32Array(SHOTFX.marks);
  private nextMark = 0;
  /** Where the listener is (the camera), for near-miss cosmetics; set by the game each frame. */
  readonly listener = { x: 0, y: 0, z: 0, valid: false };
  private whizzCool = 0;
  /** Told how close a round passed (0..1) so the game can flick the camera. */
  onNearMiss: ((strength: number) => void) | undefined;

  private readonly fogU = { value: 0.0085 };
  private readonly fogColor = { value: new Color(PALETTE.sky.horizon) };
  private readonly dummy = new Object3D();
  private readonly wind = { x: 0, z: 0 };
  private time = 0;
  /** Effect density: 0.5 on low, 1 on medium, 1.4 on high graphics. */
  scale: number;
  /** Review aid: `?fxslow=0.15` plays the effects in slow motion so a still can catch a 60 ms flash on a 10 fps software renderer. 1 in play. */
  private readonly slow: number;

  constructor(private readonly scene: Scene, private readonly groundAt: (x: number, z: number) => number, scale = 1) {
    this.scale = scale;
    const q = Number(new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("fxslow"));
    this.slow = Number.isFinite(q) && q > 0.02 && q <= 1 ? q : 1;
    this.puffs = new BillboardPool(scene, SHOTFX.puffs, PUFF_FRAG, false, 12, this.fogU, this.fogColor);
    this.flashes = new BillboardPool(scene, SHOTFX.flashes, FLASH_FRAG, true, 14, this.fogU, this.fogColor);

    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    this.sA = new InstancedBufferAttribute(new Float32Array(SHOTFX.streaks * 4), 4).setUsage(DynamicDrawUsage);
    this.sB = new InstancedBufferAttribute(new Float32Array(SHOTFX.streaks * 4), 4).setUsage(DynamicDrawUsage);
    this.sC = new InstancedBufferAttribute(new Float32Array(SHOTFX.streaks * 3), 3).setUsage(DynamicDrawUsage);
    geo.setAttribute("iA", this.sA);
    geo.setAttribute("iB", this.sB);
    geo.setAttribute("iC", this.sC);
    geo.instanceCount = 0;
    this.streaks = new Mesh(
      geo,
      new ShaderMaterial({ vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uFog: this.fogU } }),
    );
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 13;
    scene.add(this.streaks);

    this.deb = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial({ gradientMap: sharedToonRamp() }), SHOTFX.debris);
    this.deb.instanceMatrix.setUsage(DynamicDrawUsage);
    this.deb.frustumCulled = false;
    this.deb.count = 0;
    this.deb.castShadow = false;
    for (let i = 0; i < SHOTFX.debris; i++) this.deb.setColorAt(i, tint.setHex(FX.dust));
    scene.add(this.deb);

    const ringGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.ring = new InstancedMesh(ringGeo, new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new Color(FX.dust) } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying float vA; attribute float aAlpha; void main(){ vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA; uniform vec3 uColor;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.86, 1.0, r));
          if (ring < 0.03) discard;
          gl_FragColor = vec4(uColor, ring * vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }), SHOTFX.rings);
    this.ring.geometry.setAttribute("aAlpha", new InstancedBufferAttribute(new Float32Array(SHOTFX.rings).fill(0), 1).setUsage(DynamicDrawUsage));
    this.ring.instanceMatrix.setUsage(DynamicDrawUsage);
    this.ring.frustumCulled = false;
    this.ring.count = 0;
    this.ring.renderOrder = 11;
    scene.add(this.ring);

    // the scar: a dark dent, a lighter lip, and cracks running out of it, drawn flat on the ground
    const markGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    markGeo.setAttribute("aAlpha", new InstancedBufferAttribute(new Float32Array(SHOTFX.marks), 1).setUsage(DynamicDrawUsage));
    markGeo.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(SHOTFX.marks), 1).setUsage(DynamicDrawUsage));
    this.marks = new InstancedMesh(markGeo, new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { uDark: { value: new Color(PALETTE.world.dirtDark) }, uLight: { value: new Color(PALETTE.world.dry) } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying float vA; varying float vS; attribute float aAlpha; attribute float aSeed; void main(){ vUv = uv; vA = aAlpha; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA; varying float vS; uniform vec3 uDark; uniform vec3 uLight;
        void main(){
          vec2 q = vUv - 0.5;
          float r = length(q) * 2.0;
          float a = atan(q.y, q.x);
          float dent = 1.0 - smoothstep(0.26, 0.5, r);
          float lip = smoothstep(0.44, 0.52, r) * (1.0 - smoothstep(0.6, 0.7, r));
          float cr = 0.0;
          for (int i = 0; i < 6; i++) {
            float ang = float(i) * 1.0472 + vS * 6.2831 + sin(vS * 13.0 + float(i) * 4.1) * 0.3;
            float d = abs(sin(a - ang)) * r;
            float reach = 0.78 + 0.2 * sin(vS * 7.0 + float(i) * 2.3);
            float along = smoothstep(0.3, 0.46, r) * (1.0 - smoothstep(reach - 0.12, reach, r)) * step(0.0, cos(a - ang));
            cr = max(cr, along * (1.0 - smoothstep(0.012, 0.05, d)));
          }
          float dark = max(dent * 0.62, cr * 0.85);
          float light = lip * 0.55;
          float alpha = max(dark, light) * vA;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(mix(uLight, uDark, dark / max(dark + light, 1e-3)), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }), SHOTFX.marks);
    this.marks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.marks.frustumCulled = false;
    this.marks.count = 0;
    this.marks.renderOrder = 10;
    scene.add(this.marks);
  }

  // ---- emitters ----------------------------------------------------------------------------------------------------------------------

  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, s0: number, s1: number, life: number, c0: number, c1: number, alpha: number, drag = 1.2, rise = 0.25): void {
    const i = this.nextPuff;
    this.nextPuff = (this.nextPuff + 1) % SHOTFX.puffs;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pvz[i] = vz;
    this.ps0[i] = s0;
    this.ps1[i] = s1;
    this.page[i] = 0;
    this.plife[i] = life;
    tint.setHex(c0);
    this.pc0[i * 3] = tint.r;
    this.pc0[i * 3 + 1] = tint.g;
    this.pc0[i * 3 + 2] = tint.b;
    tint.setHex(c1);
    this.pc1[i * 3] = tint.r;
    this.pc1[i * 3 + 1] = tint.g;
    this.pc1[i * 3 + 2] = tint.b;
    this.pa[i] = alpha;
    this.pdrag[i] = drag;
    this.prise[i] = rise;
    this.prot[i] = rnd(0, 6.28);
    this.prs[i] = Math.random();
  }

  private flashAt(x: number, y: number, z: number, size: number, life: number, color: number = FX.flashOuter): void {
    const i = this.nextFlash;
    this.nextFlash = (this.nextFlash + 1) % SHOTFX.flashes;
    this.fx[i * 3] = x;
    this.fx[i * 3 + 1] = y;
    this.fx[i * 3 + 2] = z;
    this.fsize[i] = size;
    this.fage[i] = 0;
    this.flife[i] = life;
    tint.setHex(color);
    this.fcol[i * 3] = tint.r;
    this.fcol[i * 3 + 1] = tint.g;
    this.fcol[i * 3 + 2] = tint.b;
  }

  private streak(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, life: number, color: number): void {
    const i = this.nextStreak;
    this.nextStreak = (this.nextStreak + 1) % SHOTFX.streaks;
    this.sx0[i * 3] = ax;
    this.sx0[i * 3 + 1] = ay;
    this.sx0[i * 3 + 2] = az;
    this.sx1[i * 3] = bx;
    this.sx1[i * 3 + 1] = by;
    this.sx1[i * 3 + 2] = bz;
    this.sw[i] = width;
    this.sage[i] = 0;
    this.slife[i] = life;
    tint.setHex(color);
    this.scol[i * 3] = tint.r;
    this.scol[i * 3 + 1] = tint.g;
    this.scol[i * 3 + 2] = tint.b;
  }

  private debris(x: number, y: number, z: number, vx: number, vy: number, vz: number, sx: number, sy: number, sz: number, color: number, life: number): void {
    const i = this.nextDebris;
    this.nextDebris = (this.nextDebris + 1) % SHOTFX.debris;
    this.dx[i] = x;
    this.dy[i] = y;
    this.dz[i] = z;
    this.dvx[i] = vx;
    this.dvy[i] = vy;
    this.dvz[i] = vz;
    this.dsx[i] = sx;
    this.dsy[i] = sy;
    this.dsz[i] = sz;
    this.drx[i] = rnd(0, 6.28);
    this.dry[i] = rnd(0, 6.28);
    this.drvx[i] = rnd(-14, 14);
    this.drvy[i] = rnd(-14, 14);
    this.dlife[i] = life;
    this.dfade[i] = Math.min(0.3, life * 0.4);
    this.deb.setColorAt(i, tint.setHex(color));
    if (this.deb.instanceColor) this.deb.instanceColor.needsUpdate = true;
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.scale));
  }

  /** The report of a weapon: flash, a thrown wad, and smoke that hangs and drifts. `dir` is the barrel's unit direction. */
  muzzle(weapon: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const big = weapon === WEAPON.BLUNDERBUSS ? 1.5 : weapon === WEAPON.RIFLE ? 1.05 : weapon === WEAPON.CANNON ? 4 : 0.8;
    this.flashAt(x + dx * 0.05, y + dy * 0.05, z + dz * 0.05, 0.62 * big, 0.06 + big * 0.012, FX.flashMid);
    this.flashAt(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12, 0.34 * big, 0.05, FX.flashCore);
    // a jet of smoke along the barrel, then a cloud that hangs
    const jets = this.n(weapon === WEAPON.BLUNDERBUSS ? 5 : 3);
    for (let k = 0; k < jets; k++) {
      const sp = rnd(3.5, 7.5) * (weapon === WEAPON.RIFLE ? 1.15 : 1);
      this.puff(x + dx * 0.1, y + dy * 0.1, z + dz * 0.1, dx * sp + rnd(-0.5, 0.5), dy * sp + rnd(-0.2, 0.5), dz * sp + rnd(-0.5, 0.5), 0.18 * big, 0.8 * big, rnd(0.9, 1.4), FX.smokeLight, FX.smokeLight, 0.7, 2.6, 0.15);
    }
    const cloud = this.n(weapon === WEAPON.BLUNDERBUSS ? 7 : weapon === WEAPON.RIFLE ? 5 : 3);
    for (let k = 0; k < cloud; k++) {
      this.puff(x + rnd(-0.06, 0.06), y + rnd(-0.04, 0.08), z + rnd(-0.06, 0.06), dx * rnd(0.3, 1.2) + rnd(-0.25, 0.25), rnd(0.15, 0.5), dz * rnd(0.3, 1.2) + rnd(-0.25, 0.25), 0.22 * big, 0.95 * big, rnd(2.0, 3.4), FX.smokeLight, FX.smokeDark, 0.62, 0.7, 0.3);
    }
    // powder haze: a few big thin puffs that hang for seconds and drift downwind (smokeWind: the weather's strength decides how fast)
    const haze = this.n(weapon === WEAPON.CANNON ? 4 : weapon === WEAPON.BLUNDERBUSS ? 3 : weapon === WEAPON.RIFLE ? 2 : 1);
    for (let k = 0; k < haze; k++) {
      this.puff(x + dx * rnd(0.2, 0.6) + rnd(-0.1, 0.1), y + rnd(-0.05, 0.2), z + dz * rnd(0.2, 0.6) + rnd(-0.1, 0.1), dx * rnd(0.2, 0.8), rnd(0.1, 0.35), dz * rnd(0.2, 0.8), 0.5 * big, 1.9 * big, rnd(3.5, 5.5), FX.smokeLight, FX.smokeLight, 0.34, 0.6, 0.22);
    }
    // the percussion cap leaves the lock sideways and back (a flintlock has none, but the picture is the same small brass fleck), the wad and a few sparks fly on
    if (weapon !== WEAPON.CANNON) {
      const back = LOCK_BACK[weapon] ?? 0.4;
      const rx = -dz;
      const rz = dx;
      this.debris(x - dx * back + rx * 0.03, y - dy * back + 0.035, z - dz * back + rz * 0.03, rx * rnd(1.6, 3.2) - dx * rnd(0.3, 1.2), rnd(1.6, 3), rz * rnd(1.6, 3.2) - dz * rnd(0.3, 1.2), 0.012, 0.012, 0.018, PALETTE.weapons.brass, 1.6);
      this.debris(x + dx * 0.2, y, z + dz * 0.2, dx * rnd(6, 11), dy * 8 + rnd(0.5, 2), dz * rnd(6, 11), 0.03, 0.03, 0.03, PALETTE.material.cream, 0.7);
      for (let k = 0; k < this.n(3); k++) this.debris(x, y, z, dx * rnd(3, 8) + rnd(-1, 1), dy * 5 + rnd(0, 2), dz * rnd(3, 8) + rnd(-1, 1), 0.012, 0.012, 0.03, FX.spark, 0.28);
    }
  }

  /** A streak from the muzzle to where a hitscan round ended. */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, weapon: number): void {
    const rifle = weapon === WEAPON.RIFLE;
    this.streak(x0, y0, z0, x1, y1, z1, rifle ? 0.014 : 0.01, rifle ? 0.11 : 0.07, FX.tracer);
  }

  /** A short streak behind a flying ball or pellet. */
  trail(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cannon = false): void {
    this.streak(x0, y0, z0, x1, y1, z1, cannon ? 0.05 : 0.008, cannon ? 0.2 : 0.06, cannon ? FX.smokeLight : FX.tracer);
  }

  /** A puff of the cannon ball's smoke trail. */
  ballSmoke(x: number, y: number, z: number): void {
    this.puff(x, y, z, rnd(-0.3, 0.3), rnd(0, 0.4), rnd(-0.3, 0.3), 0.18, 0.55, 1.1, FX.smokeLight, FX.smokeDark, 0.5, 1.2, 0.2);
  }

  /** A round struck something: dust, splinters, sparks or chips by what it was. `n` is the unit surface normal. */
  impact(surface: SurfaceId, x: number, y: number, z: number, nx: number, ny: number, nz: number, weapon: number): void {
    const size = weapon === WEAPON.CANNON ? 3 : weapon === WEAPON.BLUNDERBUSS ? 0.7 : weapon === WEAPON.RIFLE ? 1.15 : 0.85;
    const speed = 2.2 * size;
    const burst = (colors: readonly number[], count: number, sx: number, sy: number, sz: number, life: number, spread: number): void => {
      for (let k = 0; k < count; k++) {
        this.debris(x, y, z, (nx + rnd(-spread, spread)) * speed * rnd(0.5, 1.4), (ny + rnd(0, spread)) * speed * rnd(0.6, 1.6) + 0.8, (nz + rnd(-spread, spread)) * speed * rnd(0.5, 1.4), sx * rnd(0.7, 1.3), sy * rnd(0.7, 1.3), sz * rnd(0.7, 1.3), colors[k % colors.length]!, life * rnd(0.7, 1.2));
      }
    };
    switch (surface) {
      case SURFACE.WOOD: {
        for (let k = 0; k < this.n(2); k++) this.puff(x, y, z, nx * 0.8 + rnd(-0.3, 0.3), ny * 0.8 + 0.4, nz * 0.8 + rnd(-0.3, 0.3), 0.12 * size, 0.42 * size, rnd(0.5, 0.8), PALETTE.world.logCut, FX.dust, 0.75, 2.5, 0.3);
        burst([FX.splinter, PALETTE.world.logCut, PALETTE.world.ringDark], this.n(7), 0.012, 0.012, 0.09, 0.9, 0.7);
        break;
      }
      case SURFACE.IRON: {
        this.flashAt(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0.34 * size, 0.05, FX.flashCore);
        burst([FX.spark, FX.flashCore, FX.flashMid], this.n(9), 0.012, 0.012, 0.045, 0.35, 0.9);
        this.puff(x, y, z, nx * 0.4, 0.5, nz * 0.4, 0.08 * size, 0.32 * size, 0.5, FX.smokeDark, FX.smokeLight, 0.55, 2.4, 0.3);
        break;
      }
      case SURFACE.STONE: {
        this.puff(x, y, z, nx * 0.6, ny * 0.6 + 0.3, nz * 0.6, 0.14 * size, 0.55 * size, rnd(0.6, 0.9), FX.stone, FX.dust, 0.8, 2.2, 0.25);
        burst([FX.stone, PALETTE.world.rockPale, FX.spark], this.n(6), 0.03, 0.03, 0.03, 0.8, 0.8);
        if (ny > 0.6) this.scar(x, y, z, 0.32 * size);
        break;
      }
      case SURFACE.CLOTH: {
        for (let k = 0; k < this.n(3); k++) this.puff(x, y, z, nx * 0.7 + rnd(-0.3, 0.3), ny * 0.7 + rnd(0, 0.5), nz * 0.7 + rnd(-0.3, 0.3), 0.1 * size, 0.4 * size, rnd(0.5, 0.9), FX.cloth, FX.cloth, 0.7, 2.0, 0.2);
        break;
      }
      default: {
        // earth (and anything unknown): a plume that lifts, opens and hangs, a low ring of dust racing out along the ground, clods, and a scar
        const ground = ny > 0.55;
        const big = size;
        // the plume: lighter than the ground it came from (dust is pale), with a darker contour (see PUFF_FRAG), big enough and slow enough to read
        for (let k = 0; k < this.n(4); k++) {
          this.puff(x, y + 0.04, z, nx * 1.1 + rnd(-0.55, 0.55), ny * 1.5 + rnd(0.5, 1.5), nz * 1.1 + rnd(-0.55, 0.55), 0.3 * big, 1.25 * big, rnd(1.1, 1.8), PALETTE.world.dust, FX.dust, 0.92, 1.9, 0.28);
        }
        if (ground) {
          // the ring: little puffs flung out flat, and the ring itself
          for (let k = 0; k < this.n(6); k++) {
            const a = rnd(0, 6.28);
            const sp = rnd(1.4, 2.8) * Math.sqrt(big);
            this.puff(x, y + 0.05, z, Math.cos(a) * sp, rnd(0.05, 0.3), Math.sin(a) * sp, 0.12 * big, 0.45 * big, rnd(0.5, 0.9), PALETTE.world.dust, FX.dust, 0.75, 3.2, 0.1);
          }
          this.ringAt(x, y + 0.04, z, 0.7 * big, 0.5, 0.5);
          this.scar(x, y, z, 0.7 * big);
        }
        burst([PALETTE.world.dirt, PALETTE.world.dirtDark, PALETTE.world.dry], this.n(6), 0.045, 0.04, 0.045, 1.0, 0.6);
      }
    }
  }

  /** The cannon's discharge or any big explosion: fireball, a column of smoke that rises and drifts, a ring of dust racing outward, clods and sparks. */
  explosion(x: number, y: number, z: number, radius: number): void {
    const k = radius / 6;
    this.flashAt(x, y + 0.6 * k, z, 5.2 * k, 0.16, FX.flashMid);
    this.flashAt(x, y + 0.7 * k, z, 3.0 * k, 0.11, FX.flashCore);
    for (let i = 0; i < this.n(12); i++) {
      const a = rnd(0, 6.28);
      const r = rnd(0, 1.4 * k);
      this.puff(x + Math.cos(a) * r, y + rnd(0.2, 1.1) * k, z + Math.sin(a) * r, Math.cos(a) * rnd(1, 5), rnd(1.5, 5) , Math.sin(a) * rnd(1, 5), 0.6 * k, 2.6 * k, rnd(0.5, 0.9), FX.flashMid, FX.flashOuter, 0.95, 2.4, 0.6);
    }
    for (let i = 0; i < this.n(22); i++) {
      const a = rnd(0, 6.28);
      const r = rnd(0, 1.8 * k);
      const rise = rnd(2, 5.5);
      this.puff(x + Math.cos(a) * r, y + rnd(0.2, 1.4) * k, z + Math.sin(a) * r, Math.cos(a) * rnd(0.4, 2.5), rise, Math.sin(a) * rnd(0.4, 2.5), 0.9 * k, 3.4 * k, rnd(2.8, 4.8), FX.smokeDark, FX.smokeLight, 0.78, 0.9, 0.8);
    }
    for (let i = 0; i < this.n(14); i++) {
      const a = rnd(0, 6.28);
      this.puff(x + Math.cos(a) * 0.6 * k, y + 0.15, z + Math.sin(a) * 0.6 * k, Math.cos(a) * rnd(6, 12) * k, rnd(0.2, 0.8), Math.sin(a) * rnd(6, 12) * k, 0.5 * k, 1.9 * k, rnd(0.8, 1.4), FX.dust, PALETTE.world.dust, 0.75, 2.6, 0.1);
    }
    for (let i = 0; i < this.n(20); i++) {
      const a = rnd(0, 6.28);
      const sp = rnd(4, 13) * Math.sqrt(k);
      this.debris(x, y + 0.2, z, Math.cos(a) * sp, rnd(4, 12) * Math.sqrt(k), Math.sin(a) * sp, rnd(0.04, 0.12), rnd(0.03, 0.08), rnd(0.04, 0.12), i % 3 === 0 ? PALETTE.world.dirtDark : i % 3 === 1 ? PALETTE.world.dirt : FX.spark, rnd(0.9, 1.6));
    }
    this.ringAt(x, y + 0.05, z, radius * 1.3, 0.55, 0.7);
  }

  /** A flat ring of dust racing out along the ground to `radius` metres in `life` seconds. */
  private ringAt(x: number, y: number, z: number, radius: number, alpha: number, life: number): void {
    const ri = this.nextRing;
    this.nextRing = (this.nextRing + 1) % SHOTFX.rings;
    this.rx[ri] = x;
    this.ry[ri] = y;
    this.rz[ri] = z;
    this.rmax[ri] = radius;
    this.ralpha[ri] = alpha;
    this.rlife[ri] = life;
    this.rage[ri] = 0;
  }

  /** A scar on the ground: a dent, a lip and cracks, `size` metres across. */
  private scar(x: number, y: number, z: number, size: number): void {
    const i = this.nextMark;
    this.nextMark = (this.nextMark + 1) % SHOTFX.marks;
    this.mx[i] = x;
    this.my[i] = y + 0.025;
    this.mz[i] = z;
    this.msize[i] = size;
    this.mage[i] = 0;
    this.mseed[i] = Math.random();
  }

  /** The cannon's fuse: a stream of sparks at the touch hole. */
  fuse(x: number, y: number, z: number): void {
    this.debris(x, y, z, rnd(-0.6, 0.6), rnd(1.2, 3), rnd(-0.6, 0.6), 0.012, 0.012, 0.03, FX.spark, 0.35);
    if (Math.random() < 0.4) this.puff(x, y, z, rnd(-0.1, 0.1), rnd(0.4, 0.8), rnd(-0.1, 0.1), 0.05, 0.2, 0.7, FX.smokeLight, FX.smokeDark, 0.5, 1, 0.2);
  }

  /**
   * A blow landed on a body with gore turned down: a spray of dust off the coat (no blood at all, per the art direction), thrown along the push. `power` 0..1.
   * Same soft puffs as an impact, so a hit is as readable with gore Off as with it on.
   */
  bodyDust(x: number, y: number, z: number, dx: number, dz: number, power: number): void {
    const k = 0.6 + 0.8 * Math.min(1, Math.max(0, power));
    for (let i = 0; i < this.n(3 + Math.round(power * 2)); i++) {
      this.puff(x, y + rnd(-0.1, 0.1), z, dx * rnd(0.6, 2.2) + rnd(-0.4, 0.4), rnd(0.2, 0.9), dz * rnd(0.6, 2.2) + rnd(-0.4, 0.4), 0.12 * k, 0.5 * k, rnd(0.5, 0.9), FX.cloth, FX.dust, 0.8, 2.4, 0.2);
    }
  }

  /** A puff of coal-dark dust where a round has passed the shooter's feet, or where a cast fell: used sparingly by the game. */
  dust(x: number, y: number, z: number, size = 1): void {
    for (let k = 0; k < this.n(3); k++) this.puff(x, y + 0.1, z, rnd(-0.6, 0.6), rnd(0.2, 0.7), rnd(-0.6, 0.6), 0.14 * size, 0.55 * size, rnd(0.6, 1), FX.dust, PALETTE.world.dust, 0.7, 2.2, 0.2);
  }

  /**
   * A round went by the listener (hitscan tracer or flying ball, from `(ax,ay,az)` to `(bx,by,bz)`): if it passed within about three metres, and not so close
   * that it is a hit or the listener's own shot, it leaves two hairline streaks through the air and a ripple of disturbed dust. Returns how close it was as
   * 0..1 (0 = did not pass near), so the caller can flick the camera. Cheap: a distance test; rate limited.
   */
  nearMiss(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const L = this.listener;
    if (!L.valid || this.whizzCool > 0) return 0;
    const vx = bx - ax;
    const vy = by - ay;
    const vz = bz - az;
    const len2 = vx * vx + vy * vy + vz * vz;
    if (len2 < 1e-6) return 0;
    const t = Math.max(0, Math.min(1, ((L.x - ax) * vx + (L.y - ay) * vy + (L.z - az) * vz) / len2));
    const px = ax + vx * t;
    const py = ay + vy * t;
    const pz = az + vz * t;
    const d = Math.hypot(px - L.x, py - L.y, pz - L.z);
    if (d > WHIZZ_RANGE || d < 0.25) return 0;
    if (Math.hypot(ax - L.x, ay - L.y, az - L.z) < 1.5) return 0; // it left your own gun
    this.whizzCool = 0.12;
    const l = Math.sqrt(len2);
    const ux = vx / l;
    const uy = vy / l;
    const uz = vz / l;
    this.streak(px - ux * 1.1, py - uy * 1.1, pz - uz * 1.1, px + ux * 1.1, py + uy * 1.1, pz + uz * 1.1, 0.012, 0.09, FX.flashCore);
    this.streak(px - ux * 0.7 + 0.06, py - uy * 0.7 + 0.03, pz - uz * 0.7, px + ux * 0.9 + 0.06, py + uy * 0.9 + 0.03, pz + uz * 0.9, 0.006, 0.07, FX.tracer);
    this.puff(px, py, pz, ux * 1.5, uy * 1.5 + 0.1, uz * 1.5, 0.08, 0.45, 0.4, FX.smokeLight, FX.smokeLight, 0.35, 3, 0);
    const strength = 1 - d / WHIZZ_RANGE;
    this.onNearMiss?.(strength);
    return strength;
  }

  // ---- per frame -------------------------------------------------------------------------------------------------------------------------

  /** Scars currently on the ground (they outlive every other effect: `SHOTFX.markLife` seconds). */
  get liveMarks(): number {
    let n = 0;
    for (let i = 0; i < SHOTFX.marks; i++) if (this.mage[i]! < SHOTFX.markLife) n++;
    return n;
  }

  /** Live particle counts (tests, the debug overlay). */
  get live(): { puffs: number; flashes: number; streaks: number; debris: number } {
    let puffs = 0;
    let flashes = 0;
    let streaks = 0;
    let debris = 0;
    for (let i = 0; i < SHOTFX.puffs; i++) if (this.page[i]! < this.plife[i]!) puffs++;
    for (let i = 0; i < SHOTFX.flashes; i++) if (this.fage[i]! < this.flife[i]!) flashes++;
    for (let i = 0; i < SHOTFX.streaks; i++) if (this.sage[i]! < this.slife[i]!) streaks++;
    for (let i = 0; i < SHOTFX.debris; i++) if (this.dlife[i]! > 0) debris++;
    return { puffs, flashes, streaks, debris };
  }

  update(dtReal: number): void {
    const dt = dtReal * this.slow;
    this.time += dt;
    smokeWind(this.time, getAtmosphere().wind, this.wind);
    const fog = this.scene.fog;
    if (fog instanceof FogExp2) {
      this.fogU.value = fog.density;
      this.fogColor.value.copy(fog.color);
    }
    const wx = this.wind.x;
    const wz = this.wind.z;

    // puffs
    let n = 0;
    const P = this.puffs;
    for (let i = 0; i < SHOTFX.puffs; i++) {
      const age = this.page[i]!;
      const life = this.plife[i]!;
      if (age >= life) continue;
      this.page[i] = age + dt;
      const t = (age + dt) / life;
      const k = Math.exp(-this.pdrag[i]! * dt);
      // the wind takes over as the puff's own push dies away
      this.pvx[i] = this.pvx[i]! * k + wx * (1 - k) * 0.9;
      this.pvz[i] = this.pvz[i]! * k + wz * (1 - k) * 0.9;
      this.pvy[i] = this.pvy[i]! * k + this.prise[i]! * (1 - k);
      this.px[i]! += this.pvx[i]! * dt;
      this.py[i]! += this.pvy[i]! * dt;
      this.pz[i]! += this.pvz[i]! * dt;
      const ground = this.groundAt(this.px[i]!, this.pz[i]!) + 0.05;
      if (this.py[i]! < ground) this.py[i] = ground;
      const grow = 1 - (1 - t) * (1 - t);
      const size = this.ps0[i]! + (this.ps1[i]! - this.ps0[i]!) * grow;
      const a = this.pa[i]! * Math.min(1, t * 6) * (1 - t * t);
      P.pos.setXYZW(n, this.px[i]!, this.py[i]!, this.pz[i]!, size);
      const j = i * 3;
      const m = Math.min(1, t * 1.5);
      P.col.setXYZW(n, this.pc0[j]! + (this.pc1[j]! - this.pc0[j]!) * m, this.pc0[j + 1]! + (this.pc1[j + 1]! - this.pc0[j + 1]!) * m, this.pc0[j + 2]! + (this.pc1[j + 2]! - this.pc0[j + 2]!) * m, a);
      P.rot.setXY(n, this.prot[i]! + t * 0.6, this.prs[i]!);
      n++;
    }
    P.count = n;
    P.flush();

    // flashes
    n = 0;
    const F = this.flashes;
    for (let i = 0; i < SHOTFX.flashes; i++) {
      const age = this.fage[i]!;
      const life = this.flife[i]!;
      if (age >= life) continue;
      this.fage[i] = age + dt;
      const t = (age + dt) / life;
      F.pos.setXYZW(n, this.fx[i * 3]!, this.fx[i * 3 + 1]!, this.fx[i * 3 + 2]!, this.fsize[i]! * (0.8 + 0.5 * t));
      F.col.setXYZW(n, this.fcol[i * 3]!, this.fcol[i * 3 + 1]!, this.fcol[i * 3 + 2]!, 1 - t * t);
      F.rot.setXY(n, i * 1.7 + t, (i * 0.37) % 1);
      n++;
    }
    F.count = n;
    F.flush();

    // streaks
    n = 0;
    for (let i = 0; i < SHOTFX.streaks; i++) {
      const age = this.sage[i]!;
      const life = this.slife[i]!;
      if (age >= life) continue;
      this.sage[i] = age + dt;
      const t = (age + dt) / life;
      this.sA.setXYZW(n, this.sx0[i * 3]!, this.sx0[i * 3 + 1]!, this.sx0[i * 3 + 2]!, this.sw[i]!);
      this.sB.setXYZW(n, this.sx1[i * 3]!, this.sx1[i * 3 + 1]!, this.sx1[i * 3 + 2]!, 1 - t * t);
      this.sC.setXYZ(n, this.scol[i * 3]!, this.scol[i * 3 + 1]!, this.scol[i * 3 + 2]!);
      n++;
    }
    (this.streaks.geometry as InstancedBufferGeometry).instanceCount = n;
    this.sA.needsUpdate = true;
    this.sB.needsUpdate = true;
    this.sC.needsUpdate = true;

    // debris
    let maxLive = 0;
    const d = this.dummy;
    for (let i = 0; i < SHOTFX.debris; i++) {
      if (this.dlife[i]! <= 0) {
        d.scale.set(0, 0, 0);
        d.updateMatrix();
        this.deb.setMatrixAt(i, d.matrix);
        continue;
      }
      maxLive = i + 1;
      this.dlife[i]! -= dt;
      this.dvy[i]! -= 13 * dt;
      this.dx[i]! += this.dvx[i]! * dt;
      this.dy[i]! += this.dvy[i]! * dt;
      this.dz[i]! += this.dvz[i]! * dt;
      const g = this.groundAt(this.dx[i]!, this.dz[i]!);
      if (this.dy[i]! < g + 0.01) {
        this.dy[i] = g + 0.01;
        this.dvy[i] = Math.abs(this.dvy[i]!) * 0.25;
        this.dvx[i]! *= 0.5;
        this.dvz[i]! *= 0.5;
        this.drvx[i]! *= 0.4;
        this.drvy[i]! *= 0.4;
      }
      this.drx[i]! += this.drvx[i]! * dt;
      this.dry[i]! += this.drvy[i]! * dt;
      const f = Math.min(1, this.dlife[i]! / this.dfade[i]!);
      d.position.set(this.dx[i]!, this.dy[i]!, this.dz[i]!);
      d.rotation.set(this.drx[i]!, this.dry[i]!, 0);
      d.scale.set(this.dsx[i]! * f, this.dsy[i]! * f, this.dsz[i]! * f);
      d.updateMatrix();
      this.deb.setMatrixAt(i, d.matrix);
    }
    this.deb.count = maxLive;
    this.deb.instanceMatrix.needsUpdate = true;

    // shock rings
    let rn = 0;
    const alpha = this.ring.geometry.getAttribute("aAlpha") as InstancedBufferAttribute;
    for (let i = 0; i < SHOTFX.rings; i++) {
      if (this.rage[i]! >= this.rlife[i]!) continue;
      this.rage[i]! += dt;
      const t = this.rage[i]! / this.rlife[i]!;
      const s = this.rmax[i]! * (1 - (1 - t) * (1 - t)) * 2;
      d.position.set(this.rx[i]!, this.ry[i]!, this.rz[i]!);
      d.rotation.set(0, 0, 0);
      d.scale.set(s, 1, s);
      d.updateMatrix();
      this.ring.setMatrixAt(rn, d.matrix);
      alpha.setX(rn, this.ralpha[i]! * (1 - t));
      rn++;
    }
    this.ring.count = rn;
    this.ring.instanceMatrix.needsUpdate = true;
    alpha.needsUpdate = true;

    // ground scars: appear at once, hold, fade over the last quarter of their life
    let mn = 0;
    const ma = this.marks.geometry.getAttribute("aAlpha") as InstancedBufferAttribute;
    const ms = this.marks.geometry.getAttribute("aSeed") as InstancedBufferAttribute;
    for (let i = 0; i < SHOTFX.marks; i++) {
      if (this.mage[i]! >= SHOTFX.markLife) continue;
      this.mage[i]! += dt;
      const a = this.mage[i]!;
      d.position.set(this.mx[i]!, this.my[i]!, this.mz[i]!);
      d.rotation.set(0, 0, 0);
      d.scale.set(this.msize[i]!, 1, this.msize[i]!);
      d.updateMatrix();
      this.marks.setMatrixAt(mn, d.matrix);
      ma.setX(mn, Math.min(1, a / 0.05) * Math.min(1, (SHOTFX.markLife - a) / (SHOTFX.markLife * 0.25)));
      ms.setX(mn, this.mseed[i]!);
      mn++;
    }
    this.marks.count = mn;
    this.marks.instanceMatrix.needsUpdate = true;
    ma.needsUpdate = true;
    ms.needsUpdate = true;
    this.whizzCool = Math.max(0, this.whizzCool - dt);
  }

  dispose(): void {
    this.puffs.dispose();
    this.flashes.dispose();
    for (const m of [this.streaks, this.deb, this.ring, this.marks]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as ShaderMaterial | MeshToonMaterial).dispose();
    }
  }
}

void hex;
