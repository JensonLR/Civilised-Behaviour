import { Vector3 } from "three";
import { CollisionWorld, FLAG } from "@cb/shared";
import { ARCHETYPES, decodeSpec, generateCharacter, type CharacterSpec } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId } from "@cb/procedural/three";
import { Stage } from "../render/Stage.ts";

/**
 * Character lineup / marketing showcase scene (`?showcase=lineup`). Deterministic: same URL -> same picture.
 *   seed=N        base seed for the row
 *   n=K           characters in the row (default: one per archetype)
 *   close=I       frame character I's head and shoulders
 *   expr=pain     expression for everyone (neutral|pain|fear|triumph|drunk|angry)
 *   pose=walk     walk|idle|carry|crouch|air|down
 *   look=<code>   show exactly one encoded character (from the creator) instead of the row
 *   marks=1       add campaign history marks (scars, gold tooth, eyepatch, wooden leg, medals)
 */
export function runLineup(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "high");
  const flat = new CollisionWorld({ height: () => 0 }, [], 100);
  stage.buildWorld(flat);

  const seed = Number(params.get("seed") ?? 1);
  const pose = params.get("pose") ?? "idle";
  const expr = (params.get("expr") ?? "neutral") as ExpressionId;
  const close = params.get("close");
  const single = params.get("look");

  const specs: CharacterSpec[] = [];
  const decoded = single ? decodeSpec(single) : undefined;
  if (decoded) specs.push(decoded);
  else {
    const n = Number(params.get("n") ?? ARCHETYPES.length);
    for (let i = 0; i < n; i++) specs.push(generateCharacter(seed + i * 7919, i % ARCHETYPES.length));
  }
  if (params.get("marks") === "1") {
    specs.forEach((s, i) => {
      s.scars = [1, 6, 10, 5, 18, 3][i % 6] as number;
      s.teeth = [2, 1, 6, 8, 3, 0][i % 6] as number;
      s.eyepatch = i % 3 === 0 ? 1 : 0;
      s.woodenLeg = i % 4 === 1 ? 2 : 0;
      s.burnt = i % 3;
      s.medals = 2 + (i % 4);
    });
  }

  const spacing = 1.9;
  const rigs: { rig: CharacterRig; anim: CharacterAnimator }[] = [];
  specs.forEach((spec, i) => {
    const rig = buildCharacter(spec);
    rig.root.position.set((i - (specs.length - 1) / 2) * spacing, 0, 0);
    // The rig faces -Z; the camera sits at +Z, so turn each figure around (plus a little three-quarter variety).
    rig.root.rotation.y = Math.PI + (params.get("turn") ? Number(params.get("turn")) : -0.3 + (i % 2) * 0.6);
    stage.scene.add(rig.root);
    const anim = new CharacterAnimator(rig);
    anim.setExpression(expr);
    rigs.push({ rig, anim });
  });

  const camera = stage.camera;
  camera.fov = 32;
  camera.updateProjectionMatrix();
  const target = new Vector3(0, 1.0, 0);
  if (close !== null && rigs[Number(close)]) {
    const r = rigs[Number(close)]!.rig;
    target.set(r.root.position.x, r.proportions.totalHeight * 0.82, 0);
    camera.position.set(target.x + 0.2, target.y + 0.1, 2.6);
  } else {
    camera.position.set(0, 1.35, Math.max(7.5, specs.length * 1.55));
    target.set(0, 0.95, 0);
  }
  camera.lookAt(target);

  const flags = pose === "walk" ? FLAG.GROUNDED : pose === "carry" ? FLAG.GROUNDED | FLAG.CARRYING : pose === "crouch" ? FLAG.GROUNDED | FLAG.CROUCHING : pose === "down" ? FLAG.GROUNDED | FLAG.DOWNED : pose === "air" ? 0 : FLAG.GROUNDED;
  const speed = pose === "walk" ? 3.6 : 0;
  // Step the animation to a settled, deterministic frame for stills, then keep animating for live viewing.
  for (let i = 0; i < 90; i++) for (const { anim } of rigs) anim.update(1 / 30, { speed, flags, vy: pose === "air" ? 2 : 0 });

  stage.followShadow(new Vector3(0, 0, 0));
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (params.get("live") === "1") for (const { anim } of rigs) anim.update(dt, { speed, flags, vy: 0 });
    stage.followShadow(new Vector3(0, 0, 0));
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = {
    ready: true,
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries }),
    heights: rigs.map((r) => r.rig.proportions.totalHeight),
  };
}
