import { CircleGeometry, Color, DirectionalLight, Mesh, ShaderMaterial, Vector3 } from "three";
import { FLAG, PALETTE } from "@cb/shared";
import { generateCharacter, type CharacterSpec } from "@cb/procedural";
import { CharacterAnimator, HandPoser, buildCharacter, type CharacterRig } from "@cb/procedural/three";
import { POSE_EVENT, type PoseId } from "../ui/creatorLogic.ts";
import { motion } from "./world/atmosphere.ts";
import type { Stage } from "./Stage.ts";

/**
 * The scene behind the front door: the creator's character stands in the expedition camp at golden hour while the camera drifts slowly round
 * (parallax against the tents, the fire, the Observatory and its falls), lit by a key (the low sun), a cool fill and a warm rim, on a soft contact shadow.
 * The creator's pose picker (`POSE_EVENT` on window) switches it between a turntable, walking on the spot, standing still, and the pain and
 * triumph poses (which also close the hands into fists); dragging turns the figure. The world behind is built AFTER the first paint (`Stage.buildWorld`,
 * about a second), so the door opens at once: until then the sky alone is behind the figure (`setGround` tells the preview where the ground is).
 */

/** Where the figure stands in the camp (world x, z) and the direction the camera sits in from it (radians from +Z, toward -X). */
export const BACKDROP = { x: 1.2, z: 1.6, camAngle: -0.44 } as const;

const SHADOW_FRAG = /* glsl */ `
  varying vec2 vUv; uniform vec3 uColor; uniform float uAlpha;
  void main(){
    float r = length(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, r)); a *= a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * uAlpha);
    #include <colorspace_fragment>
  }`;

export class CreatorPreview {
  private rig: CharacterRig | undefined;
  private anim: CharacterAnimator | undefined;
  private hands: HandPoser | undefined;
  private pose: PoseId = "turntable";
  private yaw = Math.PI + BACKDROP.camAngle;
  private raf = 0;
  private running = false;
  private dragging = false;
  private lastX = 0;
  private last = performance.now();
  private clock = 0;
  private groundY = 0;
  private groundAt: (x: number, z: number) => number = () => 0;
  private readonly target = new Vector3();
  private readonly rim = new DirectionalLight(PALETTE.light.sun, 0.9);
  private readonly fill = new DirectionalLight(PALETTE.light.sky, 0.45);
  private readonly shadow: Mesh;
  private height = 1.8;
  /** Grass is bent away from the figure and the ground in front of it, so the legs are clear of blades (the same push the walkers give in the game). */
  private readonly pushers = [0, 1, 2].map(() => ({ x: 0, z: 0 }));
  private readonly offPose = (e: Event): void => this.setPose((e as CustomEvent<PoseId>).detail);
  private readonly onDown = (e: PointerEvent): void => {
    if (!this.running) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.canvas.setPointerCapture(e.pointerId);
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw += (e.clientX - this.lastX) * 0.01;
    this.lastX = e.clientX;
  };
  private readonly onUp = (): void => void (this.dragging = false);

  constructor(
    private readonly stage: Stage,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    window.addEventListener(POSE_EVENT, this.offPose);
    this.shadow = new Mesh(
      new CircleGeometry(0.8, 28).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: { uColor: { value: new Color(PALETTE.light.bounce) }, uAlpha: { value: 0.55 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: SHADOW_FRAG,
      }),
    );
    this.shadow.renderOrder = 5;
  }

  /** The ground under the camp, once the world is built (before that the figure stands at height 0). */
  setGround(at: (x: number, z: number) => number): void {
    this.groundAt = at;
    this.groundY = at(BACKDROP.x, BACKDROP.z);
    this.place();
  }

  /** Chooses what the figure does (see the class comment). */
  setPose(id: PoseId): void {
    this.pose = id;
    this.anim?.setExpression(id === "pain" ? "pain" : id === "triumph" ? "triumph" : "neutral");
  }

  setSpec(spec: CharacterSpec): void {
    this.rig?.dispose();
    this.rig = buildCharacter(spec ?? generateCharacter(1));
    this.anim = new CharacterAnimator(this.rig);
    this.hands = new HandPoser(this.rig);
    this.setPose(this.pose);
    this.stage.scene.add(this.rig.root);
    this.height = this.rig.proportions.totalHeight;
    this.place();
    this.frameCamera(0);
  }

  private place(): void {
    if (this.rig) this.rig.root.position.set(BACKDROP.x, this.groundY, BACKDROP.z);
    this.shadow.position.set(BACKDROP.x, this.groundY + 0.03, BACKDROP.z);
  }

  /** The camera rides a slow figure of eight round the figure: a little sway of angle, distance and height (scaled by the motion preference). */
  private frameCamera(t: number): void {
    const k = motion.value;
    const h = this.height;
    const a = BACKDROP.camAngle + 0.1 * k * Math.sin(t * 0.11);
    const r = 7.4 + h * 0.6 + 0.14 * k * Math.sin(t * 0.07 + 1);
    const cam = this.stage.camera;
    cam.fov = 30;
    cam.updateProjectionMatrix();
    cam.position.set(BACKDROP.x + Math.sin(a) * r, this.groundY + h * 0.82 + 0.05 * k * Math.sin(t * 0.09), BACKDROP.z + Math.cos(a) * r);
    this.target.set(BACKDROP.x, this.groundY + h * 0.47, BACKDROP.z);
    cam.lookAt(this.target);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const scene = this.stage.scene;
    scene.add(this.rim, this.rim.target, this.fill, this.fill.target, this.shadow);
    this.rim.position.set(BACKDROP.x + 4, this.groundY + 3.2, BACKDROP.z - 5);
    this.rim.target.position.set(BACKDROP.x, this.groundY + 1.2, BACKDROP.z);
    this.fill.position.set(BACKDROP.x - 5, this.groundY + 2.4, BACKDROP.z + 4);
    this.fill.target.position.set(BACKDROP.x, this.groundY + 1.0, BACKDROP.z);
    this.place();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.clock += dt;
      // the turntable (and a walk, so the gait can be judged from every side) turns; the other poses hold still unless dragged
      if (!this.dragging && (this.pose === "turntable" || this.pose === "walk")) this.yaw += dt * (this.pose === "walk" ? 0.2 : 0.3);
      if (this.rig && this.anim) {
        this.rig.root.rotation.y = this.yaw;
        const speed = this.pose === "walk" ? 3.2 : 0;
        this.anim.update(dt, { speed, flags: FLAG.GROUNDED, vy: 0 });
        this.hands?.update(dt, FLAG.GROUNDED, speed, this.anim.currentExpression);
        this.rig.root.position.y += this.groundY;
      }
      this.frameCamera(this.clock);
      this.pushGrass();
      this.stage.followShadow(this.target);
      this.stage.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private pushGrass(): void {
    const dx = Math.sin(BACKDROP.camAngle);
    const dz = Math.cos(BACKDROP.camAngle);
    for (let i = 0; i < this.pushers.length; i++) {
      this.pushers[i]!.x = BACKDROP.x + dx * i * 0.9;
      this.pushers[i]!.z = BACKDROP.z + dz * i * 0.9;
    }
    this.stage.setPushers(this.pushers, this.pushers.length);
  }

  /** Stops drawing and takes the figure, the lights and the shadow out of the scene (the game is about to use it). */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.rig?.dispose();
    this.rig = undefined;
    this.anim = undefined;
    this.hands = undefined;
    for (const o of [this.rim, this.rim.target, this.fill, this.fill.target, this.shadow]) o.removeFromParent();
  }

  /** Stops and lets go of every listener (tests, leaving the front door for good). */
  dispose(): void {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener(POSE_EVENT, this.offPose);
    this.shadow.geometry.dispose();
    (this.shadow.material as ShaderMaterial).dispose();
  }
}
