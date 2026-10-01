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
import { applyWeather, createDayState, dayState, hashFloat, mistLevel, parseClock, parseWeatherKind, type CollisionWorld, type HqHistoryPiece, type RegionDress, type RegionId, type ScenarioView } from "@cb/shared";
import { setOutlineViewport } from "@cb/procedural/three";
import type { GoreLevel } from "@cb/procedural/three";
import { DecalField, type DecalPreset } from "./decals/index.ts";
import { createRegionView, type RegionView } from "./world/regionView.ts";
import { setToonLite } from "./world/toon.ts";
import { atmoUniforms, atmosphereForWriting, motion, motionScale, windGain } from "./world/atmosphere.ts";
import { applyDaySky, buildSky, fogColour, setRgb, type SkyDetail, type SkyUniforms } from "./world/sky.ts";
import { SkyClock } from "./world/skyclock.ts";

export interface GraphicsPreset {
  /** Sun shadows at all (off: no shadow pass, no shadow sampling in any material). */
  shadows: boolean;
  shadowMapSize: number;
  /** MSAA on the canvas (a context attribute: fixed when the renderer is made, so a live switch keeps the first choice). */
  antialias: boolean;
  /** The sky: `full` (two cloud decks, stars, moon), `simple` (one cloud deck) or `flat` (banded gradient with the sun's disc). */
  sky: SkyDetail;
  /** Toon materials without the valley-mist chunk (noise in every fragment) and the campfire's warm term. */
  liteShading: boolean;
  /** Hollowmere's ambient people (off builds none). */
  villagers: boolean;
  /** Level of detail of the trees (1 full, 0 coarse: about half the triangles, in the shadow pass too). */
  treeLod: 0 | 1;
  /** Build the real camp behind the front door (off: the sky alone; no world is built until a session starts). */
  menuBackdrop: boolean;
  /** Share of the trees (and their shrubs) that are DRAWN, 0..1. Collision obstacles are shared with the server and never thin out; this is visual only. */
  treeDensity: number;
  pixelRatioCap: number;
  /**
   * three.js asks the driver for every program's info log and link status the first time it is used, which stalls until that program is compiled
   * (about 70-160 ms EACH on a software rasteriser, 45 programs; `?shaderchecks=0|1` overrides). Off, `Stage` checks all of them once, later, in one go.
   */
  shaderChecks: boolean;
  /** Extra multiplier on the pixel ratio (1 = native). The test preset renders a quarter of the pixels: nobody looks at them and a software rasteriser pays per pixel. */
  renderScale: number;
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

export const PRESETS: Record<"low" | "medium" | "high" | "test", GraphicsPreset> = {
  low: { shadows: true, shaderChecks: true, shadowMapSize: 1024, antialias: false, sky: "full", liteShading: false, villagers: true, treeLod: 0, menuBackdrop: true, treeDensity: 1, pixelRatioCap: 1, renderScale: 1, terrainSegments: 96, outlines: false, grassTufts: 1800, flowers: 300, bushes: 60, clutter: 0.4, treeLine: 260, trailOverlay: false, waterFx: false, motes: 0, butterflies: 0, birds: 0, smoke: 0, rain: 0, flock: 0, species: false },
  medium: { shadows: true, shaderChecks: true, shadowMapSize: 2048, antialias: true, sky: "full", liteShading: false, villagers: true, treeLod: 1, menuBackdrop: true, treeDensity: 1, pixelRatioCap: 1.5, renderScale: 1, terrainSegments: 160, outlines: true, grassTufts: 5000, flowers: 900, bushes: 130, clutter: 1, treeLine: 900, trailOverlay: true, waterFx: true, motes: 700, butterflies: 12, birds: 6, smoke: 22, rain: 2000, flock: 1, species: true },
  high: { shadows: true, shaderChecks: true, shadowMapSize: 4096, antialias: true, sky: "full", liteShading: false, villagers: true, treeLod: 1, menuBackdrop: true, treeDensity: 1, pixelRatioCap: 2, renderScale: 1, terrainSegments: 200, outlines: true, grassTufts: 8000, flowers: 1500, bushes: 200, clutter: 1.5, treeLine: 1500, trailOverlay: true, waterFx: true, motes: 1400, butterflies: 16, birds: 9, smoke: 30, rain: 3600, flock: 1, species: true },
  /**
   * NOT a player preset (`?gfx=test`; the Settings screen never lists it): the e2e suite and headless tooling on a SOFTWARE rasteriser, where every
   * pixel and every vertex is CPU time. It keeps the world's shapes (terrain, trees and rocks at a thinner draw density, the village, the camp, the
   * ruin, the water) and drops everything that is only ornament: shadows, MSAA, clouds, ground cover, ambient life, weather visuals, ink, people.
   * Gameplay, collision and the server are untouched: the obstacles come from the shared arena, so a tree that is not drawn still blocks.
   */
  test: { shadows: false, shaderChecks: false, shadowMapSize: 256, antialias: false, sky: "flat", liteShading: true, villagers: false, treeLod: 0, menuBackdrop: false, treeDensity: 0.4, pixelRatioCap: 1, renderScale: 0.5, terrainSegments: 64, outlines: false, grassTufts: 0, flowers: 0, bushes: 0, clutter: 0, treeLine: 0, trailOverlay: false, waterFx: false, motes: 0, butterflies: 0, birds: 0, smoke: 0, rain: 0, flock: 0, species: false },
};
export type PresetName = keyof typeof PRESETS;

/** The decal cap that goes with a graphics preset (the test preset, like low, keeps the field small). */
function decalPresetOf(p: GraphicsPreset): DecalPreset {
  for (const [name, v] of Object.entries(PRESETS)) if (v === p) return name === "high" ? "high" : name === "medium" ? "medium" : "low";
  return p.grassTufts >= 8000 ? "high" : p.grassTufts >= 5000 ? "medium" : "low";
}

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
  readonly camera = new PerspectiveCamera(65, 1, 0.1, 820);
  private readonly sun = new DirectionalLight(0xffffff, 3.0);
  private readonly hemi = new HemisphereLight(0xffffff, 0xffffff, 1.0);
  private sky!: Mesh;
  private skyUniforms!: SkyUniforms;
  private readonly fog: FogExp2;
  private readonly haze = new Color();
  private readonly day = createDayState();
  private readonly lightDir = new Vector3(-0.55, 0.62, 0.42);
  /** Which hour and which weather: from the URL, a pin, the room's clock or a local drift (see world/skyclock.ts). */
  private readonly sky_ = new SkyClock();
  private lastFrame = 0;
  /** Seconds since the world was born (the room's clock, or a local one): what the flock's positions are a function of. */
  private worldSec = 0;
  private worldView?: RegionView;
  private preset: GraphicsPreset;
  /** D-038: the field's persistent marks (blood pools, spray, drags, scorch, mud): ONE instanced draw call, kept across frames, cleared when the region changes. Gore level via `setGore`. */
  readonly decals: DecalField;

  get outlines(): boolean {
    return this.preset.outlines;
  }

  /** Whether the front door shows the real camp behind the figure (false for the test preset). */
  get menuBackdrop(): boolean {
    return this.preset.menuBackdrop;
  }

  /** The current clock hour (0..24). */
  get clock(): number {
    return this.sky_.hours;
  }

  constructor(canvas: HTMLCanvasElement, presetName: PresetName = "medium") {
    this.preset = PRESETS[presetName];
    setToonLite(this.preset.liteShading);
    this.renderer = new WebGLRenderer({ canvas, antialias: this.preset.antialias, powerPreference: "high-performance" });
    const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("shaderchecks");
    this.renderer.debug.checkShaderErrors = q === "1" ? true : q === "0" ? false : this.preset.shaderChecks;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = this.preset.shadows;
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
      moon: params.get("moon") !== null && Number.isFinite(Number(params.get("moon"))) ? Number(params.get("moon")) : undefined,
    });
    motion.value = motionScale(params); // ?motion=0..1 or prefers-reduced-motion

    // One colour of distance for fog, the sky's lowest band, the ground skirt and the far hills (world/sky.ts).
    fogColour(this.haze);
    this.scene.background = this.haze;
    this.fog = new FogExp2(this.haze, 0.0085);
    this.scene.fog = this.fog;

    this.scene.add(this.hemi);
    this.sun.castShadow = this.preset.shadows;
    this.sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.07;
    this.sun.shadow.radius = 2.5; // softens the PCF edge so faceted canvas and foliage do not dither at the terminator
    this.sun.shadow.intensity = 0.72; // a toon ramp's darkest lit step is far brighter than raw hemisphere light: full-strength shadows read as holes
    this.scene.add(this.sun, this.sun.target);

    this.makeSky();
    this.decals = new DecalField(this.scene, (x, z) => this.builtFor?.terrainHeight(x, z) ?? 0, decalPresetOf(this.preset));
    this.applyDay();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** The gore setting (Full / Reduced / Off) for the persistent marks: Off hides spatter, spray and drag; a pool is only a small dirt-dark stain (never red); soot and mud stay. */
  setGore(level: GoreLevel): void {
    this.decals.setGore(level);
  }

  /** Where the local player stands, once a frame: a region with walkable interiors lifts the roof over the room the viewer is in (docs/LEVEL_PLAN.md section 4, rule 7). */
  setViewer(x: number, z: number): void {
    this.worldView?.setViewer?.(x, z);
  }

  /** (Re)builds the dome for the preset: the painted sky, or the flat one. */
  private makeSky(): void {
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      (this.sky.material as { dispose(): void }).dispose();
    }
    const sky = buildSky(this.lightDir, this.preset.sky);
    this.sky = sky.mesh;
    this.skyUniforms = sky.uniforms;
    this.scene.add(this.sky);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.pixelRatioCap) * this.preset.renderScale);
    this.renderer.setSize(w, h, false);
    const buf = this.renderer.getDrawingBufferSize(new Vector2());
    setOutlineViewport(buf.x, buf.y); // outline thickness is in device pixels
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Builds the world (painted terrain, hills, trees, rocks, ground cover, the camp) from the same deterministic data the server simulates. */
  buildWorld(world: CollisionWorld, region: RegionId = "hollowmere", seed?: number): void {
    if (region !== this.builtRegion) this.decals.pool.clear(); // (blood is world space: it does not follow the party across the sea)
    this.builtFor = world;
    this.builtRegion = region;
    this.builtSeed = seed; // (Highmark's herds and signs are a pure function of the world seed; a preset change rebuilds with the same one)
    // (the new world first, then the old one goes: programs both use stay linked instead of being destroyed and compiled again)
    const old = this.worldView;
    this.worldView = createRegionView(region, this.scene, world, this.preset, this.lightDir, seed);
    old?.dispose();
    this.worldView.applyDay(this.day);
    // what the campaign has built (D-035) is re-applied to every new view, so a preset change or a region change never loses it
    if (this.dress) this.worldView.applyDress?.(this.dress);
    this.worldView.applyHistory?.(this.history);
    this.worldView.applyScenario?.(this.scenario);
  }

  private scenario: ScenarioView | undefined;

  /** The contract in play (D-037): handed to the region view, which may dress it (a fall, a flood); re-applied to every new view. */
  setScenario(v: ScenarioView | undefined): void {
    this.scenario = v;
    this.worldView?.applyScenario?.(v);
  }

  private dress: RegionDress | undefined;
  private history: readonly HqHistoryPiece[] = [];

  /** The Society's outpost, the roads, the wire, the launch and the Syndicate's post as the campaign has them (Kessar swaps its group in place). */
  setDress(d: RegionDress | undefined): void {
    this.dress = d;
    if (d) this.worldView?.applyDress?.(d);
  }

  /** What HQ keeps of the campaign: pieces on the planning table, the strongbox and the marquee's back wall (Hollowmere swaps its group in place). */
  setHistory(p: readonly HqHistoryPiece[]): void {
    this.history = p;
    this.worldView?.applyHistory?.(p);
  }

  /**
   * Links every shader the scene needs in parallel, without blocking the page (KHR_parallel_shader_compile where the browser has it; otherwise a
   * plain sequential compile, same as the first frame would have done). Without it each program stalls the first frame that draws it: on a software
   * rasteriser about 100 ms each, on a real driver 10-50 ms each and a visible hitch at the start of a session.
   */
  async precompile(): Promise<void> {
    // (never let a driver that does not answer hold the game at the door: after 20 s the first frames simply compile what is left)
    await Promise.race([this.renderer.compileAsync(this.scene, this.camera), new Promise((r) => setTimeout(r, 20_000))]);
  }

  /** `buildWorld`, then reveal it once its shaders are linked (the world is hidden until then so the frames in between never stall on a compile). */
  async buildWorldAsync(world: CollisionWorld, wanted: () => boolean = () => true, region: RegionId = "hollowmere", seed?: number): Promise<void> {
    if (!wanted()) return;
    this.buildWorld(world, region, seed);
    const view = this.worldView;
    if (!view) return;
    view.root.visible = false;
    await this.precompile();
    if (this.worldView === view) view.root.visible = true;
  }

  /** The world last passed to `buildWorld`, kept so the graphics preset can be changed live (settings screen). */
  private builtFor?: CollisionWorld;
  private builtSeed: number | undefined;
  private builtRegion: RegionId = "hollowmere";

  /**
   * Switches graphics preset while running: shadow map size, pixel ratio and the whole world (ground cover, trees, water, ambient life) are
   * rebuilt from the same deterministic data. Characters already on screen keep the outline choice they were made with.
   */
  setPreset(name: PresetName): void {
    const next = PRESETS[name];
    if (next) this.applyPreset(next);
  }

  /** Measurement tooling: the current preset with some knobs changed, applied like `setPreset` (one variable at a time in docs/PERFORMANCE.md). */
  tweakPreset(patch: Partial<GraphicsPreset>): void {
    this.applyPreset({ ...this.preset, ...patch });
  }

  private applyPreset(next: GraphicsPreset): void {
    if (next === this.preset) return;
    const reshade = next.shadows !== this.preset.shadows;
    const prevSky = this.preset.sky;
    this.preset = next;
    setToonLite(next.liteShading);
    this.renderer.shadowMap.enabled = next.shadows;
    this.sun.castShadow = next.shadows;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
    this.resize();
    this.decals.setPreset(decalPresetOf(next));
    if (next.sky !== prevSky) {
      this.makeSky();
      this.applyDay();
    }
    if (reshade) this.scene.traverse((o) => {
      const m = (o as Mesh).material as { needsUpdate: boolean } | { needsUpdate: boolean }[] | undefined; // programs differ with and without shadow sampling
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
    if (this.builtFor) this.buildWorld(this.builtFor, this.builtRegion, this.builtSeed);
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
    // moonlight follows the moon's phase: a full moon lights the night well, a new moon hardly at all
    const illum = 0.5 - 0.5 * Math.cos(this.sky_.moon * Math.PI * 2);
    this.sun.intensity = d.sunIntensity * (1 - d.night * 0.6 * (1 - illum));
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
    this.skyUniforms.uPhase.value = this.sky_.moon * Math.PI * 2;
    atmoUniforms.uWindK.value = windGain(w.wind, motion.value);
    atmoUniforms.uWet.value = w.wet;
    atmoUniforms.uMist.value = mistLevel(d.hours, w.wet);
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
    const texel = 68 / this.preset.shadowMapSize; // (the map is unused when shadows are off, but the target still follows)
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(sx, target.y, sz);
    this.sun.position.set(sx + this.lightDir.x * 90, target.y + this.lightDir.y * 90, sz + this.lightDir.z * 90);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
  }

  private framesRendered = 0;

  /**
   * With `checkShaderErrors` off, every program is checked once here instead of stalling its first draw: a program that failed to link would
   * otherwise only show as objects that never appear. Logs the driver's message like three.js does. Cheap: by now everything is linked.
   */
  verifyPrograms(): number {
    const gl = this.renderer.getContext();
    let bad = 0;
    for (const p of this.renderer.info.programs ?? []) {
      const prog = (p as unknown as { program: WebGLProgram }).program;
      if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === false) {
        bad++;
        console.error("WebGLProgram: link failed -", gl.getProgramInfoLog(prog));
      }
    }
    return bad;
  }

  render(): void {
    if (!this.renderer.debug.checkShaderErrors && ++this.framesRendered === 90) this.verifyPrograms();
    const now = performance.now() / 1000;
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.25, now - this.lastFrame);
    this.lastFrame = now;
    this.updateSky(performance.now(), dt);
    this.applyDay();
    this.worldView?.update(now, this.camera.position, this.worldSec);
    this.decals.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
