// @vitest-environment happy-dom
import { DirectionalLight, Mesh, PerspectiveCamera, Scene, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCharacter } from "@cb/procedural";
import { BACKDROP, CreatorPreview } from "./CreatorPreview.ts";
import { POSE_EVENT } from "../ui/creatorLogic.ts";
import { motion } from "./world/atmosphere.ts";
import type { Stage } from "./Stage.ts";

let frames: FrameRequestCallback[] = [];
let t = 0;
const crank = (n = 1, dtMs = 33): void => {
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const run = frames;
    frames = [];
    for (const f of run) f(t);
  }
};

function fakeStage() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(65, 16 / 9, 0.1, 800);
  const pushed: number[] = [];
  const stage = { scene, camera, followShadow: () => undefined, render: () => undefined, setPushers: (_l: unknown, n: number) => pushed.push(n) } as unknown as Stage;
  return { stage, scene, camera, pushed };
}

beforeEach(() => {
  frames = [];
  t = 1000;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
  vi.stubGlobal("cancelAnimationFrame", () => void (frames = []));
  vi.spyOn(performance, "now").mockImplementation(() => t);
  motion.value = 1;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CreatorPreview (the front door's scene)", () => {
  it("stands the figure in the camp, frames it from the drifting camera, and lights it with a rim, a fill and a contact shadow", () => {
    const { stage, scene, camera } = fakeStage();
    const p = new CreatorPreview(stage, document.createElement("canvas"));
    p.setSpec(generateCharacter(4));
    p.start();
    crank(3);
    const lights = scene.children.filter((c) => c instanceof DirectionalLight);
    expect(lights.length).toBe(2);
    const figure = scene.children.find((c) => c.name === "root")!;
    expect(figure.position.x).toBeCloseTo(BACKDROP.x, 6);
    expect(figure.position.z).toBeCloseTo(BACKDROP.z, 6);
    expect(scene.children.some((c) => c instanceof Mesh && c.position.y > 0 && c.geometry.type === "CircleGeometry")).toBe(true);
    // the camera looks at the figure from the camp side, at a steady distance
    const dir = camera.getWorldDirection(new Vector3());
    const toFigure = new Vector3(BACKDROP.x, 0.9, BACKDROP.z).sub(camera.position).normalize();
    expect(dir.dot(toFigure)).toBeGreaterThan(0.97);
    expect(camera.fov).toBe(30);
    const d0 = camera.position.distanceTo(new Vector3(BACKDROP.x, 0, BACKDROP.z));
    expect(d0).toBeGreaterThan(6);
    expect(d0).toBeLessThan(11);
    p.dispose();
  });

  it("drifts slowly, and not at all when the motion preference is zero", () => {
    const span = (k: number): number => {
      motion.value = k;
      const { stage, camera } = fakeStage();
      const p = new CreatorPreview(stage, document.createElement("canvas"));
      p.setSpec(generateCharacter(4));
      p.start();
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 300; i++) {
        crank(1, 100);
        min = Math.min(min, camera.position.x);
        max = Math.max(max, camera.position.x);
      }
      p.dispose();
      return max - min;
    };
    const moving = span(1);
    expect(moving).toBeGreaterThan(0.2);
    expect(moving).toBeLessThan(2.5);
    expect(span(0)).toBeLessThan(1e-6);
  });

  it("follows the ground once the world is built, bends the grass away, and answers the pose picker", () => {
    const { stage, scene, pushed } = fakeStage();
    const p = new CreatorPreview(stage, document.createElement("canvas"));
    p.setSpec(generateCharacter(2));
    p.start();
    p.setGround(() => 2.5);
    crank(2);
    const figure = scene.children.find((c) => c.name === "root")!;
    expect(figure.position.y).toBeGreaterThanOrEqual(2.5);
    expect(pushed.length).toBeGreaterThan(0);
    const y0 = figure.rotation.y;
    window.dispatchEvent(new CustomEvent(POSE_EVENT, { detail: "idle" }));
    crank(5);
    expect(figure.rotation.y).toBeCloseTo(y0, 6); // standing still: no turntable
    window.dispatchEvent(new CustomEvent(POSE_EVENT, { detail: "turntable" }));
    crank(5);
    expect(Math.abs(figure.rotation.y - y0)).toBeGreaterThan(0.01);
    p.dispose();
  });

  it("stop() takes the figure, lights and shadow out of the scene for the game, and dispose() releases the listeners: a second round starts clean", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = window.addEventListener.bind(window);
    const rem = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, fn: never, o?: never) => (added.push(type), add(type, fn, o))) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, fn: never, o?: never) => (removed.push(type), rem(type, fn, o))) as typeof window.removeEventListener;
    for (let round = 0; round < 3; round++) {
      const { stage, scene } = fakeStage();
      const canvas = document.createElement("canvas");
      const p = new CreatorPreview(stage, canvas);
      p.setSpec(generateCharacter(round + 1));
      p.start();
      crank(2);
      expect(scene.children.length).toBeGreaterThan(4);
      p.stop();
      expect(scene.children.length).toBe(0);
      expect(frames.length).toBe(0);
      p.dispose();
    }
    window.addEventListener = add;
    window.removeEventListener = rem;
    expect(added.filter((a) => a === POSE_EVENT).length).toBe(3);
    expect(removed.filter((a) => a === POSE_EVENT).length).toBe(3);
  });
});
