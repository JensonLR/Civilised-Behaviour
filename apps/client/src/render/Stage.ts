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
import { applyWeather, createDayState, dayState, hashFloat, parseClock, parseWeatherKind, type CollisionWorld } from "@cb/shared";
import { setOutlineViewport } from "@cb/procedural/three";
import { WorldView } from "./world/WorldView.ts";
import { atmoUniforms, atmosphereForWriting, motion, motionScale, windGain } from "./world/atmosphere.ts";
import { applyDaySky, buildSky, fogColour, setRgb, type SkyUniforms } from "./world/sky.ts";
import { SkyClock } from "./world/skyclock.ts";

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
  /** Rain streaks in the pool, and puddles on the ground. 0 = the weather is a tint and fog only. */
  rain: number;
  /** Sheep and goats (0 = none). */
  flock: number;
  /** Birch and pine as species of their own. */
  species: boolean;
}

export const PRESETS: Record<"low" | "medium" | "high", GraphicsPreset> = {
  low: { shadowMapSize: 1024, pixelRatioCap: 1, terrainSegments: 96, outlines: false, grassTufts: 1800, flowers: 300, bushes: 60, clutter: 0.4, treeLine: 260, trailOverlay: false, waterFx: false, motes: 0, butterflies: 0, birds: 0, smoke: 0, rain: 0, flock: 0, species: false },
  medium: { shadowMapSize: 2048, pixelRatioCap: 1.5, terrainSegments: 160, outlines: true, grassTufts: 5000, flowers: 900, bushes: 130, clutter: 1, treeLine: 900, trailOverlay: true, waterFx: true, motes: 700, butterflies: 12, birds: 6, smoke: 22, rain: 2000, flock: 1, species: true },
  high: { shadowMapSize: 4096, pixelRatioCap: 2, terrainSegments: 200, outlines: true, grassTufts: 8000, flowers: 1500, bushes: 200, clutter: 1.5, treeLine: 1500, trailOverlay: true, waterFx: true, motes: 1400, butterflies: 16, birds: 9, smoke: 30, rain: 3600, flock: 1, species: true },
};

/**
 * Owns the WebGL renderer, scene lighting, sky and static world dressing, and the time of day and weather. In a room the hour and the
 * weather are pure functions of the server's world age (`SkyClock`, fed by `syncWorldClock`), so every player sees the same sky; `?time=`
 * and `?weather=` override it locally. Each frame `dayState` + `applyWeather` fill one preallocated record that lights everything: sun,
 * hemisphere, fog, background, sky, hills, water, rain, ambient life and the fire. Kept behind this small surface so a WebGPU renderer can
 * be swapped in later.
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
  /** Which hour and which weather: from the URL, a pin, the room's clock or a local drift (see world/skyclock.ts). */
  private readonly sky_ = new SkyClock();
  private lastFrame = 0;
  /** Seconds since the world was born (the room's clock, or a local one): what the flock's positions are a function of. */
  private worldSec = 0;
  private worldView?: WorldView;
  private preset: GraphicsPreset;

  get outlines(): boolean {
    return this.preset.outlines;
  }

  /** The current clock hour (0..24). */
  get clock(): number {
    return this.sky_.hours;
  }

  constructor(canvas: HTMLCanvasElement, presetName: keyof typeof PRESETS = "medium") {
    this.preset = PRESETS[presetName];
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // `?time=17.5` / `?time=dusk` fixes the hour (stills, review); `&drift=1` keeps it running. `?weather=storm` forces a weather state at
    // full strength; `?wms=N&wseed=S` sits the weather schedule at N ms. `?motion=0..1` overrides the motion preference (ambient sway).
    const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
    this.sky_ = new SkyClock({
      urlHours: parseClock(params.get("time")),
      drift: params.get("drift") === "1",
      forcedWeather: parseWeatherKind(params.get("weather")),
      startWorldMs: Number(params.get("wms") ?? 0) || 0,
      localSeed: Number(params.get("wseed") ?? 7) || 7,
    });
    motion.value = motionScale(params); // ?motion=0..1 or prefers-reduced-motion

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
    this.builtFor = world;
    this.worldView?.dispose();
    this.worldView = new WorldView(this.scene, world, this.preset, this.lightDir);
    this.worldView.applyDay(this.day);
  }

  /** The world last passed to `buildWorld`, kept so the graphics preset can be changed live (settings screen). */
  private builtFor?: CollisionWorld;

  /**
   * Switches graphics preset while running: shadow map size, pixel ratio and the whole world (ground cover, trees, water, ambient life) are
   * rebuilt from the same deterministic data. Characters already on screen keep the outline choice they were made with.
   */
  setPreset(name: keyof typeof PRESETS): void {
    const next = PRESETS[name];
    if (!next || next === this.preset) return;
    this.preset = next;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
    this.resize();
    if (this.builtFor) this.buildWorld(this.builtFor);
  }

  /** Draw/triangle counts of the built world, for docs/PERFORMANCE.md. */
  get worldStats(): import("./world/WorldView.ts").WorldStats | undefined {
    return this.worldView?.stats;
  }

  /**
   * Pins the time of day (clock hours) and stops it drifting unless `keepDrifting`. The menu and the creator preview call this for a
   * calm fixed hour; a joined room's clock (`syncWorldClock`) takes over from it. `?time=` in the URL always wins.
   */
  setTime(hours: number, keepDrifting = false): void {
    this.sky_.pin(hours, keepDrifting);
    this.applyDay();
  }

  /**
   * Feeds the server's world clock (the room state's `seed`, `worldMs`, `dayStartHour`, `dayMinutes`; call every frame, it is cheap). From
   * then on the hour of day and the weather are pure functions of the world's age, so every player sees the same sky. The age is
   * extrapolated with this machine's monotonic clock between the server's refreshes.
   */
  syncWorldClock(seed: number, worldMs: number, startHour: number, dayMinutes: number): void {
    this.sky_.sync(seed, worldMs, startHour, dayMinutes, performance.now());
  }

  /** Leaves the room's clock (back to the menu): the sky is local again. */
  leaveWorldClock(): void {
    this.sky_.leave();
  }

  /** Up to four walkers grass and flowers bend away from (world x/z). Call once a frame; entries past `n` are cleared. */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    this.worldView?.setPushers(list, n);
  }

  /** Lights everything for the sky clock's hour and weather. Allocation-free. */
  private applyDay(): void {
    const d = dayState(this.sky_.hours, this.day);
    const w = this.sky_.weather;
    applyWeather(d, w, this.sky_.lightning.flash);
    setRgb(this.sun.color, d.sun);
    this.sun.intensity = d.sunIntensity;
    // cloud takes the sun's shadows with it
    this.sun.shadow.intensity = 0.72 * (1 - 0.85 * Math.max(0, (d.cover - 0.06) / 0.94));
    setRgb(this.hemi.color, d.hemiSky);
    setRgb(this.hemi.groundColor, d.hemiGround);
    this.hemi.intensity = d.hemiIntensity;
    setRgb(this.haze, d.horizon); // the background
    this.fog.color.copy(this.haze); // FogExp2 keeps its own copy of the colour, so the fog must be told too (it stayed noon-cream all night before)
    this.fog.density = d.fogDensity;
    this.lightDir.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    applyDaySky(this.skyUniforms, d);
    atmoUniforms.uWindK.value = windGain(w.wind, motion.value);
    atmoUniforms.uWet.value = w.wet;
    atmoUniforms.uRain.value = w.rain;
    this.worldView?.applyDay(d);
  }

  /** Resolves this frame's hour, weather and lightning from the sky clock, and publishes the atmosphere (audio and shaders read it). */
  private updateSky(nowPerfMs: number, dt: number): void {
    const c = this.sky_;
    c.update(nowPerfMs, dt);
    this.worldSec = c.worldMs / 1000;
    const l = c.lightning;
    this.skyUniforms.uBolt.value.set(hashFloat(c.seed, Math.floor(l.lastStrikeMs) | 0, 0x77) * Math.PI * 2, l.flash > 0.35 ? 1 : 0, (l.lastStrikeMs % 1000) * 0.013);
    const wx = c.weather;
    const at = atmosphereForWriting();
    at.rain = wx.rain;
    at.wind = wx.wind;
    at.thunderAt = Number.isNaN(l.thunderMs) ? null : nowPerfMs / 1000 + (l.thunderMs - c.lightningMs) / 1000;
    at.hour = c.hours;
    at.wet = wx.wet;
    at.fog = wx.fog;
    at.overcast = wx.overcast;
    at.storm = wx.storm;
    at.dust = wx.dust;
    at.flash = l.flash;
    at.kind = wx.kind;
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
    this.updateSky(performance.now(), dt);
    this.applyDay();
    this.worldView?.update(now, this.camera.position, this.worldSec);
    this.renderer.render(this.scene, this.camera);
  }
}
