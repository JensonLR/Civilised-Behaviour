import { Vector3 } from "three";
import { CollisionWorld, FLAG, ZONE_COUNT, setWound } from "@cb/shared";
import { ARCHETYPES, FIELDS, decodeSpec, generateCharacter, sanitizeSpec, type CharacterSpec } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId } from "@cb/procedural/three";
import { RagdollWorld } from "../render/Ragdoll.ts";
import { Stage } from "../render/Stage.ts";

/**
 * Character lineup / marketing showcase scene (`?showcase=lineup`). Deterministic: same URL -> same picture.
 *   seed=N        base seed for the row
 *   n=K           characters in the row (default: one per archetype)
 *   close=I       frame character I's head and shoulders (cd=1.2 for a tight face portrait; cx / cyo offset the camera sideways / up to look from an angle or from below)
 *   expr=pain     expression for everyone (neutral|pain|fear|triumph|drunk|angry)
 *   pose=walk     walk|idle|carry|crouch|air|down
 *   look=<code>   show exactly one encoded character (from the creator) instead of the row
 *   marks=1       add campaign history marks (scars, gold tooth, eyepatch, wooden leg, medals)
 *   set=hat:9,hair:8   force spec fields on every character (field names from @cb/procedural FIELDS)
 *   vary=hat      cycle that field's options across the row (one option per character, in catalog order)
 *   outline=0     turn the silhouette outline off
 *   wounds=S      wound severity S (1-3) on every zone; or wounds=0:3,4:2 for zone:severity pairs (0 head, 1 torso, 2/3 arms, 4/5 legs)
 *   woundsVary=1  character i gets severity (i % 4) on every zone, to compare tiers side by side
 *   ragdoll=T     knock everyone down and simulate the ragdoll for T seconds, then freeze (add live=1 to keep it running);
 *                 figures are shoved in different directions so the row shows several falls
 *   missing=N     lost limbs as a bit mask (1 left arm, 2 right arm, 4 left leg, 8 right leg); missingVary=1 cycles through examples
 *   gore=off      full|reduced|off stain style
 *   heads=1       portrait row: every head at eye level filling the canvas (review faces side by side)
 *   aim=0.5       height (m) the camera looks at in the non-close views (0.5 = legs and boots)
 *   zoom=0.4      pull the camera in (multiplier on distance) and aim at head height; for reviewing faces and headwear
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

  // Field overrides (?set=hat:9,hair:8) and per-character cycling (?vary=hat) for reviewing catalog options.
  const overrides = (params.get("set") ?? "").split(",").filter(Boolean).map((kv) => kv.split(":") as [string, string]);
  const vary = params.get("vary");
  const varyDef = FIELDS.find((f) => f.key === vary);
  specs.forEach((spec, i) => {
    const o = spec as unknown as Record<string, number>;
    for (const [k, v] of overrides) o[k] = Number(v);
    if (varyDef) o[varyDef.key] = i % (varyDef.max + 1);
    Object.assign(spec, sanitizeSpec(spec));
  });

  const spacing = params.get("heads") === "1" ? 1.1 : 1.9;
  const rigs: { rig: CharacterRig; anim: CharacterAnimator }[] = [];
  specs.forEach((spec, i) => {
    const rig = buildCharacter(spec, { outline: params.get("outline") !== "0" });
    rig.root.position.set((i - (specs.length - 1) / 2) * spacing, 0, 0);
    let mask = 0;
    const w = params.get("wounds");
    if (w) {
      if (w.includes(":")) for (const pair of w.split(",")) { const [z, s] = pair.split(":"); mask = setWound(mask, Number(z), Number(s)); }
      else for (let z = 0; z < ZONE_COUNT; z++) mask = setWound(mask, z, Number(w));
    }
    if (params.get("woundsVary") === "1") for (let z = 0; z < ZONE_COUNT; z++) mask = setWound(mask, z, i % 4);
    const goreLevel = (params.get("gore") as "full" | "reduced" | "off" | null) ?? "full";
    rig.setWounds(mask, goreLevel);
    // missing=N: limb bit mask (1 left arm, 2 right arm, 4 left leg, 8 right leg); missingVary=1 cycles 0,1,4,6,15 across the row
    const missingBits = params.get("missingVary") === "1" ? [0, 1, 4, 6, 15][i % 5]! : Number(params.get("missing") ?? 0);
    rig.setMissing(missingBits, goreLevel);
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
    camera.position.set(target.x + Number(params.get("cx") ?? 0.2), target.y + Number(params.get("cyo") ?? 0.1), Number(params.get("cd") ?? 2.6));
  } else {
    const zoom = Number(params.get("zoom") ?? 1);
    camera.position.set(0, params.get("aim") ? Number(params.get("aim")) + 0.4 : zoom < 1 ? 1.6 : 1.35, Math.max(7.5, specs.length * 1.55) * zoom);
    target.set(0, params.get("aim") ? Number(params.get("aim")) : zoom < 1 ? 1.5 : 0.95, 0);
  }
  if (params.get("heads") === "1") {
    // Portrait row: every head at eye level, framed so the whole row fills the canvas width.
    camera.fov = 22;
    camera.updateProjectionMatrix();
    const headY = rigs.reduce((sum, r) => sum + r.rig.proportions.totalHeight, 0) / rigs.length - 0.16;
    const aspect = window.innerWidth / window.innerHeight;
    const width = spacing * specs.length * 1.08;
    const dist = width / (2 * Math.tan((camera.fov * Math.PI) / 360) * aspect);
    target.set(0, headY, 0);
    camera.position.set(0, headY + 0.05, dist);
  }
  camera.lookAt(target);

  const flags = pose === "walk" ? FLAG.GROUNDED : pose === "carry" ? FLAG.GROUNDED | FLAG.CARRYING : pose === "crouch" ? FLAG.GROUNDED | FLAG.CROUCHING : pose === "down" ? FLAG.GROUNDED | FLAG.DOWNED : pose === "air" ? 0 : FLAG.GROUNDED;
  const speed = pose === "walk" ? 3.6 : 0;
  // Step the animation to a settled, deterministic frame for stills, then keep animating for live viewing.
  for (let i = 0; i < 90; i++) for (const { anim } of rigs) anim.update(1 / 30, { speed, flags, vy: pose === "air" ? 2 : 0 });

  // Optional ragdoll review: knock every figure down at t=0 and run the physics to a chosen moment.
  const ragT = params.get("ragdoll");
  let ragdolls: RagdollWorld | undefined;
  const ragdollFrame = (dt: number) => {
    for (const { anim } of rigs) anim.update(dt, { speed: 0, flags: FLAG.GROUNDED | FLAG.DOWNED, vy: 0 });
    ragdolls?.step(dt);
    for (const r of live) r.applyPose(dt);
  };
  const live: import("../render/Ragdoll.ts").Ragdoll[] = [];
  const ready = { ready: ragT === null };
  if (ragT !== null) {
    void RagdollWorld.create(flat).then((w) => {
      ragdolls = w;
      rigs.forEach(({ rig }, i) => {
        const a = (i / rigs.length) * Math.PI * 2 + 0.6;
        const r = w.spawn(rig, { vx: 0, vy: 0, vz: 0, dx: Math.cos(a), dz: Math.sin(a), power: 0.55 + (i % 3) * 0.2, zone: 1 + (i % 5) });
        if (r) live.push(r);
      });
      for (let t = 0; t < Number(ragT); t += 1 / 30) ragdollFrame(1 / 30);
      ready.ready = true;
    });
  }

  stage.followShadow(new Vector3(0, 0, 0));
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (ragT !== null && params.get("live") === "1" && ready.ready) ragdollFrame(dt);
    else if (params.get("live") === "1") for (const { anim } of rigs) anim.update(dt, { speed, flags, vy: 0 });
    stage.followShadow(new Vector3(0, 0, 0));
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = {
    get ready() {
      return ready.ready;
    },
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries }),
    heights: rigs.map((r) => r.rig.proportions.totalHeight),
  };
}
