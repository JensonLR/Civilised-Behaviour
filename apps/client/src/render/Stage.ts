import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  BackSide,
} from "three";
import { ARENA_RADIUS, Rng, clamp, type CollisionWorld, type Obstacle } from "@cb/shared";
import { setOutlineViewport } from "@cb/procedural/three";

export interface GraphicsPreset {
  shadowMapSize: number;
  pixelRatioCap: number;
  terrainSegments: number;
  /** Silhouette outlines on characters: ~+37% triangles and one extra draw per bone, so the low preset drops them. */
  outlines: boolean;
}

export const PRESETS: Record<"low" | "medium" | "high", GraphicsPreset> = {
  low: { shadowMapSize: 1024, pixelRatioCap: 1, terrainSegments: 96, outlines: false },
  medium: { shadowMapSize: 2048, pixelRatioCap: 1.5, terrainSegments: 160, outlines: true },
  high: { shadowMapSize: 4096, pixelRatioCap: 2, terrainSegments: 200, outlines: true },
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
  private readonly sun = new DirectionalLight(0xffd9a8, 3.2);
  private readonly sky: Mesh;
  private readonly staticMeshes: Mesh[] = [];
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

    const horizon = new Color(0xe9c9a0);
    this.scene.background = horizon;
    this.scene.fog = new FogExp2(horizon, 0.0085);

    this.scene.add(new HemisphereLight(0xbfd6ff, 0x5a4a32, 0.9));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.sky = this.buildSky();
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

  /** Builds terrain + obstacle meshes from the same deterministic data the server simulates. */
  buildWorld(world: CollisionWorld): void {
    for (const m of this.staticMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
    this.staticMeshes.length = 0;
    this.addTerrain(world);
    this.addObstacles(world.obstacles);
  }

  private addTerrain(world: CollisionWorld): void {
    const size = ARENA_RADIUS * 2 + 60;
    const seg = this.preset.terrainSegments;
    const geo = new PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new Color(0x5f8036);
    const dry = new Color(0x9a8f47);
    const rock = new Color(0x7d7468);
    const c = new Color();
    const rng = new Rng(1);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = world.terrainHeight(x, z);
      pos.setY(i, h);
      const e = 0.6;
      const slope = Math.hypot(world.terrainHeight(x + e, z) - h, world.terrainHeight(x, z + e) - h) / e;
      c.copy(grass).lerp(dry, clamp((h + 1) / 5, 0, 1));
      c.lerp(rock, clamp((slope - 0.25) * 2.2, 0, 0.85));
      const j = 0.92 + rng.next() * 0.12;
      colors[i * 3] = c.r * j;
      colors[i * 3 + 1] = c.g * j;
      colors[i * 3 + 2] = c.b * j;
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
  }

  private addObstacles(obstacles: readonly Obstacle[]): void {
    const boulders = obstacles.filter((o) => o.kind === "circle" && o.y1 - o.y0 < 5);
    const trunks = obstacles.filter((o) => o.kind === "circle" && o.y1 - o.y0 >= 5);
    const boxes = obstacles.filter((o) => o.kind === "box");
    const m4 = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);

    const make = (geo: IcosahedronGeometry | CylinderGeometry | BoxGeometry, color: number, list: Obstacle[], place: (o: Obstacle) => void) => {
      const mat = new MeshStandardMaterial({ color, roughness: 0.9, flatShading: geo instanceof IcosahedronGeometry });
      const im = new InstancedMesh(geo, mat, Math.max(list.length, 1));
      im.count = list.length;
      list.forEach((o, i) => {
        place(o);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      this.scene.add(im);
      this.staticMeshes.push(im as unknown as Mesh);
    };

    make(new IcosahedronGeometry(1, 1), 0x8a8478, boulders, (o) => {
      if (o.kind !== "circle") return;
      const h = o.y1 - o.y0;
      p.set(o.x, o.y0 + h * 0.5 + 0.2, o.z);
      q.setFromAxisAngle(up, o.x * 7.31);
      s.set(o.r * 1.15, h * 0.5, o.r * 1.15);
    });
    make(new CylinderGeometry(1, 1.25, 1, 10), 0x5b4630, trunks, (o) => {
      if (o.kind !== "circle") return;
      const h = o.y1 - o.y0;
      p.set(o.x, o.y0 + h * 0.5, o.z);
      q.identity();
      s.set(o.r, h, o.r);
    });
    make(new BoxGeometry(1, 1, 1), 0xa68a5b, boxes, (o) => {
      if (o.kind !== "box") return;
      const h = o.y1 - o.y0;
      p.set(o.x, o.y0 + h * 0.5, o.z);
      q.setFromAxisAngle(up, -o.yaw);
      s.set(o.hx * 2, h, o.hz * 2);
    });

    // Tree crowns on top of trunks (instanced, sharing one geometry).
    const crownGeo = new SphereGeometry(1, 10, 8);
    const crownMat = new MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.9, flatShading: true });
    const crowns = new InstancedMesh(crownGeo, crownMat, Math.max(trunks.length, 1));
    crowns.count = trunks.length;
    const rng = new Rng(77);
    trunks.forEach((o, i) => {
      if (o.kind !== "circle") return;
      const r = 1.8 + rng.next() * 1.4;
      p.set(o.x, o.y1 + r * 0.2, o.z);
      q.identity();
      s.set(r, r * 0.8, r);
      m4.compose(p, q, s);
      crowns.setMatrixAt(i, m4);
    });
    crowns.castShadow = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.scene.add(crowns);
    this.staticMeshes.push(crowns as unknown as Mesh);
  }

  private buildSky(): Mesh {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new Color(0x2f5c9e) },
        mid: { value: new Color(0x9fb8d4) },
        horizon: { value: new Color(0xe9c9a0) },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `
        varying vec3 vDir; uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, top, smoothstep(0.2, 0.85, h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += vec3(1.0, 0.82, 0.55) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.28);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new Mesh(new SphereGeometry(400, 24, 16), mat);
    sky.frustumCulled = false;
    return sky;
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
    this.renderer.render(this.scene, this.camera);
  }
}
