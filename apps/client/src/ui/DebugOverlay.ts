import type { WebGLRenderer } from "three";

export interface DebugSources {
  renderer: WebGLRenderer;
  players: () => number;
  rttMs: () => number;
  extra?: () => string;
}

/** Toggleable performance overlay (F3). Updates twice a second so it never becomes the cost it measures. */
export class DebugOverlay {
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private text = "";
  private visible = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly src: DebugSources,
  ) {}

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  frame(dtSeconds: number): void {
    this.frames++;
    this.acc += dtSeconds;
    this.worst = Math.max(this.worst, dtSeconds);
    if (this.acc < 0.5) return;
    const info = this.src.renderer.info;
    const fps = this.frames / this.acc;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.text = [
      `${fps.toFixed(0)} fps  ${((this.acc / this.frames) * 1000).toFixed(1)} ms avg  ${(this.worst * 1000).toFixed(1)} ms worst`,
      `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k`,
      `geometries ${info.memory.geometries}  textures ${info.memory.textures}`,
      `players ${this.src.players()}  rtt ${this.src.rttMs().toFixed(0)} ms`,
      mem ? `js heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : "",
      this.src.extra?.() ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    if (this.visible) this.el.textContent = this.text;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }

  /** Last computed stats, for automated performance capture. */
  snapshot(): string {
    return this.text;
  }
}
