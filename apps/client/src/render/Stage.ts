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
import { PALETTE, type CollisionWorld } from "@cb/shared";
import { setOutlineViewport } from "@cb/procedural/three";
import { WorldView } from "./world/WorldView.ts";
import { buildSky, fogColour } from "./world/sky.ts";

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
}

export const PRESETS: Record<"low" | "medium" | "high", GraphicsPreset> = {
  low: { shadowMapSize: 1024, pixelRatioCap: 1, terrainSegments: 96, outlines: false, grassTufts: 1800, flowers: 300, bushes: 60 },
  medium: { shadowMapSize: 2048, pixelRatioCap: 1.5, terrainSegments: 160, outlines: true, grassTufts: 5000, flowers: 900, bushes: 130 },
  high: { shadowMapSize: 4096, pixelRatioCap: 2, terrainSegments: 200, outlines: true, grassTufts: 8000, flowers: 1500, bushes: 200 },
};

const SUN_DIR = new Vector3(-0.55, 0.62, 0.42).normalize();

/**
 * Owns the WebGL renderer, scene lighting, sky and static world dressing. Kept behind this
 * small surface so a WebGPU renderer can be swapped in later without touching gameplay code.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(65, 1, 0.1, 600);
  private readonly sun = new DirectionalLight(PALETTE.light.sun, 3.0);
  private readonly sky: Mesh;
  private worldView?: WorldView;
  private preset: GraphicsPreset;

  get outlines(): boolean {
    return this.preset.outlines;
  }

  constructor(canvas: HTMLCanvasElement, presetName: keyof typeof PRESETS = "medium") {
    this.preset = PRESETS[presetName];
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // One colour of distance for fog, the sky's lowest band, the ground skirt and the far hills (world/sky.ts).
    const haze = fogColour(new Color());
    this.scene.background = haze;
    this.scene.fog = new FogExp2(haze, 0.0085);

    this.scene.add(new HemisphereLight(PALETTE.light.sky, PALETTE.light.bounce, 1.0));
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
    this.scene.add(this.sun, this.sun.target);

    this.sky = buildSky(SUN_DIR);
    this.scene.add(this.sky);
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
    this.worldView = new WorldView(this.scene, world, this.preset, SUN_DIR);
  }

  /** Draw/triangle counts of the built world, for docs/PERFORMANCE.md. */
  get worldStats(): import("./world/WorldView.ts").WorldStats | undefined {
    return this.worldView?.stats;
  }

  /** Keeps the shadow frustum centred on the action, snapped to texels to avoid shimmer. */
  followShadow(target: Vector3): void {
    const texel = 68 / this.preset.shadowMapSize;
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(sx, target.y, sz);
    this.sun.position.set(sx + SUN_DIR.x * 90, target.y + SUN_DIR.y * 90, sz + SUN_DIR.z * 90);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    this.worldView?.update(performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
  }
}
