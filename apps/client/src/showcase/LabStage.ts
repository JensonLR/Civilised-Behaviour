import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshToonMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { PALETTE } from "@cb/shared";
import { setOutlineViewport, sharedToonRamp } from "@cb/procedural/three";

const SUN_DIR = new Vector3(-0.55, 0.62, 0.42).normalize();

/**
 * A character-review stage: the same lights, tone mapping and shadow set-up as the game's Stage, over a plain earth disc and a flat sky colour, with none
 * of the world. It keeps the review pages (`?showcase=lineup`) independent of the environment code, so a character can be judged (and its renders
 * compared over time) whatever state the world is in. Pass `bg=world` to the lineup to use the real Stage instead.
 */
export class LabStage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(65, 1, 0.1, 600);
  private readonly sun = new DirectionalLight(PALETTE.light.sun, 3.0);
  readonly outlines = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color(PALETTE.sky.mid);
    this.scene.add(new HemisphereLight(PALETTE.light.sky, PALETTE.light.bounce, 1.0));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    const ground = new Mesh(new CircleGeometry(60, 48), new MeshToonMaterial({ color: PALETTE.world.dirt, gradientMap: sharedToonRamp() }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    const buf = this.renderer.getDrawingBufferSize(new Vector2());
    setOutlineViewport(buf.x, buf.y);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildWorld(): void {}

  followShadow(target: Vector3): void {
    this.sun.target.position.set(target.x, target.y, target.z);
    this.sun.position.set(target.x + SUN_DIR.x * 60, target.y + SUN_DIR.y * 60, target.z + SUN_DIR.z * 60);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
