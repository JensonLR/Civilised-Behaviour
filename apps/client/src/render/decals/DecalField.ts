import { Color, DynamicDrawUsage, FogExp2, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, type Scene } from "three";
import type { GoreLevel } from "@cb/procedural/three";
import { getAtmosphere } from "../world/atmosphere.ts";
import { DECAL_ATTR, DECAL_CAP, DecalPool, type DecalPreset } from "./decalPool.ts";

/**
 * The field's persistent marks, drawn: ONE instanced draw call for every blood pool, spray, drag mark, scorch and splash of mud, whatever the count. The pure pool
 * (`decalPool.ts`) owns the state and the buffers; this binds them as instanced attributes of one quad and draws each kind's shape in the fragment shader (lumpy
 * pools with a darker coagulated rim and a wet highlight that dries off, spray fans, ragged scorch with soot rays, mud blotches). Unlit, so it follows the daylight
 * by a multiplier and the fog by the scene's own density. Colours come from the palette through the pool.
 *
 * Wiring (the integrator): `Stage` adds the field to the scene once and calls `update(dt)` each frame; `setGore` follows the gore setting; `HitFx.attachDecals(field)`
 * routes its stains here; ragdoll/casualty events call `bloodPool` / `drag`; blasts call `blast`; hooves and boots call `mud`. See `docs/_notes/polish2.md` section 11 step 7.
 */

const VERT = /* glsl */ `
  attribute vec4 iPos;   // xyz, size
  attribute vec4 iAxis;  // tangent xyz, aspect
  attribute vec4 iNorm;  // normal xyz, seed
  attribute vec4 iCol;   // rgb, alpha
  attribute vec4 iInfo;  // kind, wet, spread, -
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec4 vInfo;
  varying float vSeed;
  varying float vFog;
  uniform float uFog;
  void main() {
    vec3 n = normalize(iNorm.xyz);
    vec3 t = iAxis.xyz;
    vec3 b = cross(n, t);
    vec2 p = position.xy * 2.0;
    // lifted 2 cm off the surface and given a depth bias in the material: it never sinks into the ground and never floats
    vec3 world = iPos.xyz + n * 0.012 + t * (p.x * iPos.w * iAxis.w) + b * (p.y * iPos.w);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vCol = iCol;
    vInfo = iInfo;
    vSeed = iNorm.w;
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-uFog * uFog * d * d);
  }`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec4 vInfo;
  varying float vSeed;
  varying float vFog;
  uniform vec3 uFogColor;
  uniform float uLight;
  float h1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
  void main() {
    if (vCol.a < 0.01) discard;
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float a = atan(q.y, q.x);
    float kind = vInfo.x;
    float wet = vInfo.y;
    float cover = 0.0;
    float shade = 1.0;
    vec3 col = vCol.rgb;
    if (kind < 0.5) {
      // POOL: a lumpy disc with a few drops thrown clear, a darker crust at the rim as it dries, a wet highlight while it is fresh
      float lump = 0.10 * sin(a * 3.0 + vSeed * 6.2831) + 0.07 * sin(a * 5.0 + vSeed * 17.0) + 0.05 * sin(a * 9.0 - vSeed * 9.0);
      float edge = 0.78 + lump;
      cover = 1.0 - smoothstep(edge - 0.05, edge, r);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float ang = h1(vSeed * 31.0 + fi) * 6.2831;
        vec2 c = vec2(cos(ang), sin(ang)) * (0.86 + 0.08 * h1(vSeed * 7.0 + fi * 3.0));
        float rr = 0.03 + 0.035 * h1(vSeed * 13.0 + fi);
        cover = max(cover, (1.0 - smoothstep(rr - 0.012, rr, length(q - c))) * step(0.5, vInfo.z));
      }
      shade = mix(1.0, 0.8, smoothstep(edge - 0.2, edge - 0.02, r) * (1.0 - wet * 0.6));
      float hl = (1.0 - smoothstep(0.0, 0.22, length(q - vec2(-0.26, 0.3)))) * wet;
      col = mix(col, vec3(1.0, 0.92, 0.88) * 0.9 + col * 0.1, hl * 0.4);
    } else if (kind < 1.5) {
      // SPATTER: drops of many sizes, thickest toward the throw
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float ang = h1(vSeed * 19.0 + fi) * 6.2831;
        float rad = sqrt(h1(vSeed * 5.0 + fi * 2.0)) * 0.8;
        vec2 c = vec2(cos(ang) * rad * 1.0 + 0.1, sin(ang) * rad * 0.8);
        float rr = 0.05 + 0.15 * pow(h1(vSeed * 23.0 + fi * 5.0), 2.0);
        cover = max(cover, 1.0 - smoothstep(rr - 0.025, rr, length(q - c)));
      }
    } else if (kind < 2.5) {
      // SPRAY: streaks fanning from the wound at the left; they run along the tangent (down a wall, away on the ground)
      vec2 o = vec2(-0.92, 0.0);
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float ang = (h1(vSeed * 17.0 + fi) - 0.5) * 1.5;
        vec2 d = vec2(cos(ang), sin(ang));
        float len = 0.35 + 1.45 * h1(vSeed * 11.0 + fi * 3.0);
        vec2 pq = q - o;
        float along = dot(pq, d);
        float across = abs(pq.x * d.y - pq.y * d.x);
        float w = 0.025 + 0.05 * h1(vSeed * 29.0 + fi) * (1.0 - clamp(along / len, 0.0, 1.0));
        float body = (1.0 - smoothstep(w - 0.015, w, across)) * step(0.03, along) * (1.0 - smoothstep(len - 0.12, len, along));
        float tip = 1.0 - smoothstep(0.03, 0.065, length(pq - d * (len + 0.04)));
        cover = max(cover, max(body, tip * 0.9));
      }
    } else if (kind < 3.5) {
      // DRAG: a smear along the long axis, ragged at its edges, thinning at both ends
      float halfw = 0.5 * (1.0 - 0.3 * pow(abs(q.x), 3.0)) + 0.07 * sin(q.x * 9.0 + vSeed * 6.2831) + 0.04 * sin(q.x * 23.0 + vSeed * 3.0);
      cover = (1.0 - smoothstep(halfw - 0.12, halfw, abs(q.y))) * (1.0 - smoothstep(0.78, 1.0, abs(q.x)));
      shade = 0.86 + 0.14 * smoothstep(0.0, 0.5, abs(q.y));
    } else if (kind < 4.5) {
      // SCORCH: a ragged dark disc, soot rays thrown outward, the middle blackest and the rim ashen
      float edge = 0.62 + 0.1 * sin(a * 5.0 + vSeed * 6.2831) + 0.07 * sin(a * 11.0 - vSeed * 5.0);
      float disc = 1.0 - smoothstep(edge - 0.2, edge, r);
      float rays = pow(abs(sin(a * 7.0 + vSeed * 20.0)), 14.0) * step(0.5, r) * (1.0 - smoothstep(0.62, 1.0, r));
      cover = max(disc, rays * 0.8) * (0.7 + 0.3 * (1.0 - r));
      shade = 0.55 + 0.75 * smoothstep(0.05, 0.85, r);
    } else {
      if (vInfo.w > 0.5) {
        // MUD, second shape: a hoof print (D-058), a horseshoe crescent open at the heel (-x), with nail dots along the shoe and the frog's dent in the middle
        float rr = length(q * vec2(1.0, 1.08));
        float ring = (1.0 - smoothstep(0.86, 0.96, rr)) * smoothstep(0.5, 0.6, rr);
        float open = smoothstep(-0.55, -0.35, q.x);
        float frog = (1.0 - smoothstep(0.18, 0.3, length((q - vec2(-0.05, 0.0)) * vec2(1.0, 1.8)))) * 0.6;
        cover = max(ring * open, frog);
        float nails = 0.0;
        for (int i = 0; i < 6; i++) {
          float ang = mix(-2.2, 2.2, float(i) / 5.0);
          nails = max(nails, 1.0 - smoothstep(0.04, 0.07, length(q - vec2(cos(ang), sin(ang)) * 0.73)));
        }
        shade = mix(1.0, 0.75, nails * ring);
      } else {
      // MUD: a boot print (D-058), the toe forward along the walk (+x): a sole and a separate heel, a little ragged where the mud gave, faint tread across the sole,
      // pressed darker at the middle and wet-glossy while fresh. (The quad is stretched by the mark's aspect, so the ellipses read as a boot, not a disc.)
      vec2 sq = (q - vec2(0.24, 0.0)) / vec2(0.66, 0.86);
      vec2 hq = (q - vec2(-0.64, 0.0)) / vec2(0.3, 0.74);
      float rag = 0.06 * sin(a * 7.0 + vSeed * 6.2831);
      float sole = 1.0 - smoothstep(0.86 + rag, 1.0 + rag, length(sq));
      float heel = 1.0 - smoothstep(0.84 + rag, 1.0 + rag, length(hq));
      cover = max(sole, heel);
      float tread = 0.5 + 0.5 * sin(q.x * 26.0);
      shade = mix(0.82, 1.0, smoothstep(0.2, 0.9, max(length(sq) * sole, length(hq) * heel))) * mix(1.0, 0.9, tread * sole);
      col = mix(col, vec3(0.9, 0.86, 0.8) * 0.5 + col * 0.5, (1.0 - smoothstep(0.0, 0.5, length(sq - vec2(0.15, 0.25)))) * wet * 0.35);
      }
    }
    // an ink-like darker edge where the coverage thins, a firm contour
    float line = smoothstep(0.05, 0.4, cover);
    if (line < 0.02) discard;
    col *= shade * (0.72 + 0.28 * smoothstep(0.4, 0.95, cover)) * uLight;
    col = mix(col, uFogColor, vFog);
    gl_FragColor = vec4(col, vCol.a * line);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The light on the ground as a multiplier, from the world clock (the marks are unlit): dim at night, full by day. */
export function dayLight(hour: number): number {
  const day = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
  return 0.42 + 0.58 * Math.min(1, day * 1.5);
}

export class DecalField {
  pool: DecalPool;
  private mesh!: Mesh;
  private geo!: InstancedBufferGeometry;
  private attrs: InstancedBufferAttribute[] = [];
  private readonly fog = { value: 0.0085 };
  private readonly fogColor = { value: new Color() };
  private readonly light = { value: 1 };
  private lastDrawn = 0;
  private preset: DecalPreset;
  private gore: GoreLevel = "full";
  private readonly n = { x: 0, y: 1, z: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number,
    preset: DecalPreset = "medium",
    private readonly seed = 1,
  ) {
    this.preset = preset;
    this.pool = new DecalPool(DECAL_CAP[preset], seed);
    this.build();
  }

  private build(): void {
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    const names = ["iPos", "iAxis", "iNorm", "iCol", "iInfo"] as const;
    const arrays = [this.pool.pos, this.pool.axis, this.pool.norm, this.pool.col, this.pool.info];
    this.attrs = names.map((nm, k) => {
      const a = new InstancedBufferAttribute(arrays[k]!, DECAL_ATTR).setUsage(DynamicDrawUsage);
      geo.setAttribute(nm, a);
      return a;
    });
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
        uniforms: { uFog: this.fog, uFogColor: this.fogColor, uLight: this.light },
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // after the ground and the props, before the smoke and flashes
    this.mesh.name = "decals";
    this.scene.add(this.mesh);
  }

  /** Draw calls this field costs (one: every kind in one instanced mesh). */
  readonly drawCalls = 1;

  /** The graphics preset changed: a new cap. The marks are kept as far as they fit (the newest first). */
  setPreset(preset: DecalPreset): void {
    if (preset === this.preset) return;
    this.preset = preset;
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.pool = new DecalPool(DECAL_CAP[preset], this.seed);
    this.pool.setGore(this.gore);
    this.build();
    this.lastDrawn = 0;
  }

  setGore(level: GoreLevel): void {
    this.gore = level;
    this.pool.setGore(level);
  }

  /**
   * The height a mark of radius `r` at (x, z) is laid at: the HIGHEST of the terrain under its footprint (the centre and four points round it) plus a hand's breadth that grows with
   * its size. The terrain mesh is a coarse sampling of a bumpy surface: a mark laid at the centre's height alone is cut by the bumps beside it (speckled edges); laid on the
   * crest of them it floats by a centimetre or two at worst, which reads as lying on the ground.
   */
  groundTop(x: number, z: number, r: number): number {
    const k = Math.min(1.2, r) * 0.8;
    let y = this.groundAt(x, z);
    y = Math.max(y, this.groundAt(x + k, z), this.groundAt(x - k, z), this.groundAt(x, z + k), this.groundAt(x, z - k));
    return y + 0.01 + 0.03 * Math.min(1, r);
  }

  /** The ground's normal at (x, z) by differences of the height (written into `out`). */
  groundNormal(x: number, z: number, out: { x: number; y: number; z: number } = this.n): { x: number; y: number; z: number } {
    const e = 0.4;
    const dx = this.groundAt(x - e, z) - this.groundAt(x + e, z);
    const dz = this.groundAt(x, z - e) - this.groundAt(x, z + e);
    const l = Math.hypot(dx, 2 * e, dz);
    out.x = dx / l;
    out.y = (2 * e) / l;
    out.z = dz / l;
    return out;
  }

  // ---- placing marks on the ground by (x, z): the height and the slope come from the terrain -------------------------------------------

  bloodPool(x: number, z: number, radius: number, fed = 1): number {
    const n = this.groundNormal(x, z);
    return this.pool.pool(x, this.groundTop(x, z, radius), z, n.x, n.y, n.z, radius, fed);
  }

  spatterAt(x: number, z: number, dx: number, dz: number, radius: number): number {
    const n = this.groundNormal(x, z);
    return this.pool.spatter(x, this.groundTop(x, z, radius), z, n.x, n.y, n.z, dx, dz, radius);
  }

  /** Spray on the GROUND from a wound at (x, z) thrown along (dx, dz). */
  sprayAt(x: number, z: number, dx: number, dz: number, length: number): number {
    const n = this.groundNormal(x, z);
    return this.pool.spray(x, this.groundTop(x, z, length * 0.5), z, n.x, n.y, n.z, dx, 0, dz, length);
  }

  /** A boot print at (x, z), heading (dx, dz), set to one side of the line the body walks (`foot` +1 right, -1 left). */
  printAt(x: number, z: number, dx: number, dz: number, foot: 1 | -1): number {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return -1; // (shuffling on the spot leaves no trail of prints)
    const ux = dx / len, uz = dz / len;
    const px = x - uz * 0.11 * foot, pz = z + ux * 0.11 * foot;
    const n = this.groundNormal(px, pz);
    return this.pool.print(px, this.groundTop(px, pz, 0.15), pz, n.x, n.y, n.z, ux, uz);
  }

  /** A hoof print at (x, z), the horse heading (dx, dz), set a hand's breadth to one side of its line (`side`). */
  hoofAt(x: number, z: number, dx: number, dz: number, side: 1 | -1): number {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / len, uz = dz / len;
    const px = x - uz * 0.16 * side, pz = z + ux * 0.16 * side;
    const n = this.groundNormal(px, pz);
    return this.pool.hoof(px, this.groundTop(px, pz, 0.12), pz, n.x, n.y, n.z, ux, uz);
  }

  /** A body dragged: call every frame it moves. */
  drag(key: number, x: number, z: number, dx: number, dz: number, blood: number): boolean {
    const n = this.groundNormal(x, z);
    return this.pool.dragStep(key, x, this.groundTop(x, z, 0.3), z, n.x, n.y, n.z, dx, dz, blood);
  }

  blast(x: number, z: number, radius: number): number {
    const n = this.groundNormal(x, z);
    return this.pool.scorch(x, this.groundTop(x, z, radius), z, n.x, n.y, n.z, radius);
  }

  mud(x: number, z: number, dx: number, dz: number, radius: number): number {
    const n = this.groundNormal(x, z);
    return this.pool.mud(x, this.groundTop(x, z, radius), z, n.x, n.y, n.z, dx, dz, radius);
  }

  /** Spray on a WALL or any surface: the impact point, the surface's unit normal, the way the blood was thrown. */
  sprayOn(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, length: number): number {
    // on a steep surface the fan runs DOWN it, whatever way it was thrown
    const steep = Math.abs(ny) < 0.5;
    return this.pool.spray(x, y, z, nx, ny, nz, steep ? 0 : dx, steep ? -1 : dy, steep ? 0 : dz, length);
  }

  update(dt: number): void {
    const atm = getAtmosphere();
    this.light.value = dayLight(atm.hour);
    const f = this.scene.fog;
    if (f instanceof FogExp2) {
      this.fog.value = f.density;
      this.fogColor.value.copy(f.color);
    }
    this.pool.update(dt);
    const d = this.pool.drawn;
    this.geo.instanceCount = d;
    if (d > 0 || this.lastDrawn > 0) for (const a of this.attrs) a.needsUpdate = true;
    this.lastDrawn = d;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
