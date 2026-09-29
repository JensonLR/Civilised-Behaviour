import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { CLOCK, advanceClock, createDayState, dayState, parseClock, type CollisionWorld } from "@cb/shared";
import { setOutlineViewport } from "@cb/procedural/three";
import { WorldView } from "./world/WorldView.ts";
import { applyDaySky, buildSky, fogColour, setRgb, type SkyUniforms } from "./world/sky.ts";

export interface GraphicsPreset {
  shadowMapSize: number;
  pixelRatioCap: number;
  terrainSegments: number;
  /** Ink outlines on characters (~+37% triangles and one extra draw per bone) and on world objects (one extra draw per instanced set): the low preset drops them. */
  outlines: boolean;
  /** Instanced ground cover and shrubs. Static, so only vertex/triangle cost: low keeps a sparse meadow. */
  grassTufts: number;
  flowers: number;
  bushes: number;
  /** Forest-floor and stream-bank clutter (ferns, mushrooms, reeds), as a multiplier on the base counts. */
  clutter: number;
  /** Small trees on the hill rings' shoulders. */
  treeLine: number;
  /** Crisp footpath overlay on the terrain (one texture sample per fragment); the vertex paint alone is the fallback. */
  trailOverlay: boolean;
  /** Animated water surface (ripples, glitter, drifting foam); off = flat bands. */
  waterFx: boolean;
  /** Ambient life: pollen/fireflies (points), butterflies, birds, smoke puffs. Zero builds nothing. */
  motes: number;
  butterflies: number;
  birds: number;
  smoke: number;
}

export const PRESETS: Record<"low" | "medium" | "high", GraphicsPreset> = {
  low: { shadowMapSize: 1024, pixelRatioCap: 1, terrainSegments: 96, outlines: false, grassTufts: 1800, flowers: 300, bushes: 60, clutter: 0.4, treeLine: 260, trailOverlay: false, waterFx: false, motes: 0, butterflies: 0, birds: 0, smoke: 0 },
  medium: { shadowMapSize: 2048, pixelRatioCap: 1.5, terrainSegments: 160, outlines: true, grassTufts: 5000, flowers: 900, bushes: 130, clutter: 1, treeLine: 900, trailOverlay: true, waterFx: true, motes: 700, butterflies: 12, birds: 6, smoke: 22 },
  high: { shadowMapSize: 4096, pixelRatioCap: 2, terrainSegments: 200, outlines: true, grassTufts: 8000, flowers: 1500, bushes: 200, clutter: 1.5, treeLine: 1500, trailOverlay: true, waterFx: true, motes: 1400, butterflies: 16, birds: 9, smoke: 30 },
};

/**
 * Owns the WebGL renderer, scene lighting, sky and static world dressing, and the time of day. The clock (`?time=` fixes it, otherwise it
 * drifts slowly; see `CLOCK` in shared/daycycle.ts) is pure client-side scenery: it moves no gameplay state, so two clients at different
 * hours still play the same game. Each frame `dayState` fills one preallocated record that lights everything: sun, hemisphere, fog,
 * background, sky, hills, water, ambient life and the fire. Kept behind this small surface so a WebGPU renderer can be swapped in later.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(65, 1, 0.1, 600);
  private readonly sun = new DirectionalLight(0xffffff, 3.0);
  private readonly hemi = new HemisphereLight(0xffffff, 0xffffff, 1.0);
  private readonly sky: Mesh;
  private readonly skyUniforms: SkyUniforms;
  private readonly fog: FogExp2;
  private readonly haze = new Color();
  private readonly day = createDayState();
  private readonly lightDir = new Vector3(-0.55, 0.62, 0.42);
  private hours: number;
  private drift: boolean;
  private lastFrame = 0;
  private worldView?: WorldView;
  private preset: GraphicsPreset;

  get outlines(): boolean {
    return this.preset.outlines;
  }

  /** The current clock hour (0..24). */
  get clock(): number {
    return this.hours;
  }

  constructor(canvas: HTMLCanvasElement, presetName: keyof typeof PRESETS = "medium") {
    this.preset = PRESETS[presetName];
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // `?time=17.5` / `?time=dusk` fixes the hour (stills, review); without it the day drifts from the default start hour.
    const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
    const fixed = parseClock(params.get("time"));
    this.hours = fixed ?? CLOCK.defaultStart;
    this.drift = fixed === undefined || params.get("drift") === "1";

    // One colour of distance for fog, the sky's lowest band, the ground skirt and the far hills (world/sky.ts).
    fogColour(this.haze);
    this.scene.background = this.haze;
    this.fog = new FogExp2(this.haze, 0.0085);
    this.scene.fog = this.fog;

    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.radius = 2.5; // softens the PCF edge so faceted canvas and foliage do not dither at the terminator
    this.sun.shadow.normalBias = 0.07;
    this.sun.shadow.intensity = 0.72; // a toon ramp's darkest lit step is far brighter than raw hemisphere light: full-strength shadows read as holes
    this.scene.add(this.sun, this.sun.target);

    const sky = buildSky(this.lightDir);
    this.sky = sky.mesh;
    this.sky.renderOrder = -10; // the dome never draws over the hills that reach past it
    this.skyUniforms = sky.uniforms;
    this.scene.add(this.sky);
    this.applyDay();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    const buf = this.renderer.getDrawingBufferSize(new Vector2());
    setOutlineViewport(buf.x, buf.y); // outline thickness is in device pixels
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Builds the world (painted terrain, hills, trees, rocks, ground cover, the camp) from the same deterministic data the server simulates. */
  buildWorld(world: CollisionWorld): void {
    this.worldView?.dispose();
    this.worldView = new WorldView(this.scene, world, this.preset, this.lightDir);
    this.worldView.applyDay(this.day);
  }

  /** Draw/triangle counts of the built world, for docs/PERFORMANCE.md. */
  get worldStats(): import("./world/WorldView.ts").WorldStats | undefined {
    return this.worldView?.stats;
  }

  /** Sets the time of day (clock hours) and stops it drifting unless `keepDrifting`. */
  setTime(hours: number, keepDrifting = false): void {
    this.hours = ((hours % 24) + 24) % 24;
    this.drift = keepDrifting;
    this.applyDay();
  }

  /** Up to four walkers grass and flowers bend away from (world x/z). Call once a frame; entries past `n` are cleared. */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    this.worldView?.setPushers(list, n);
  }

  /** Lights everything for `this.hours`. Allocation-free. */
  private applyDay(): void {
    const d = dayState(this.hours, this.day);
    setRgb(this.sun.color, d.sun);
    this.sun.intensity = d.sunIntensity;
    setRgb(this.hemi.color, d.hemiSky);
    setRgb(this.hemi.groundColor, d.hemiGround);
    this.hemi.intensity = d.hemiIntensity;
    setRgb(this.haze, d.horizon); // background and fog share this Color object
    this.fog.density = d.fogDensity;
    this.lightDir.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    applyDaySky(this.skyUniforms, d);
    this.worldView?.applyDay(d);
  }

  /** Keeps the shadow frustum centred on the action, snapped to texels to avoid shimmer, and along the current light (sun by day, moon by night). */
  followShadow(target: Vector3): void {
    const texel = 68 / this.preset.shadowMapSize;
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(sx, target.y, sz);
    this.sun.position.set(sx + this.lightDir.x * 90, target.y + this.lightDir.y * 90, sz + this.lightDir.z * 90);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    const now = performance.now() / 1000;
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.25, now - this.lastFrame);
    this.lastFrame = now;
    if (this.drift && dt > 0) {
      this.hours = advanceClock(this.hours, dt);
      this.applyDay();
    }
    this.worldView?.update(now, this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
