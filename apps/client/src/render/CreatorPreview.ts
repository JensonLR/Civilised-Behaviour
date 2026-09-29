import { Vector3 } from "three";
import { FLAG } from "@cb/shared";
import { generateCharacter, type CharacterSpec } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig } from "@cb/procedural/three";
import type { Stage } from "./Stage.ts";

/** Live 3D preview behind the menu: slow turntable, drag to rotate, idle animation and blinking. */
export class CreatorPreview {
  private rig: CharacterRig | undefined;
  private anim: CharacterAnimator | undefined;
  private yaw = Math.PI + 0.5;
  private raf = 0;
  private running = false;
  private dragging = false;
  private lastX = 0;
  private last = performance.now();
  private readonly target = new Vector3();

  constructor(
    private readonly stage: Stage,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.running) return;
      this.dragging = true;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    const up = () => (this.dragging = false);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  setSpec(spec: CharacterSpec): void {
    this.rig?.dispose();
    this.rig = buildCharacter(spec ?? generateCharacter(1));
    this.anim = new CharacterAnimator(this.rig);
    this.stage.scene.add(this.rig.root);
    this.rig.root.rotation.y = this.yaw;
    // Frame the whole figure with room for hats; shift right so the form panels do not cover it.
    const h = this.rig.proportions.totalHeight;
    this.target.set(0.0, h * 0.52, 0);
    const cam = this.stage.camera;
    cam.fov = 30;
    cam.updateProjectionMatrix();
    cam.position.set(0.55, h * 0.62, 5.2 + h * 0.6);
    cam.lookAt(this.target);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      if (!this.dragging) this.yaw += dt * 0.35;
      if (this.rig && this.anim) {
        this.rig.root.rotation.y = this.yaw;
        this.anim.update(dt, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      }
      this.stage.followShadow(this.target);
      this.stage.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.rig?.dispose();
    this.rig = undefined;
    this.anim = undefined;
  }
}
