import { Vector3 } from "three";
import { CollisionWorld, FLAG, ZONE_COUNT, setWound } from "@cb/shared";
import { ARCHETYPES, FIELDS, decodeSpec, generateCharacter, sanitizeSpec, type CharacterSpec } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId } from "@cb/procedural/three";
import { RagdollWorld } from "../render/Ragdoll.ts";
import { LabStage } from "./LabStage.ts";

/**
 * Character lineup / marketing showcase scene (`?showcase=lineup`). Deterministic: same URL -> same picture.
 *   seed=N        base seed for the row
 *   n=K           characters in the row (default: one per archetype)
 *   close=I       (ty=metres sets the height looked at, tx sideways: hands are at ~0.8) frame character I's head and shoulders (cd=1.2 for a tight face portrait; cx / cyo offset the camera sideways / up to look from an angle or from below)
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
 *   frame=F       auto-frame the whole row: body|upper|torso|head|face|legs|feet|hands (fits the row's width AND the band's height; sp=1.3 sets the spacing)
 *   same=K        every figure is a copy of character K (combine with turns= and set=/vary= to review one look from all sides)
 *   turns=0,1.57,3.14,-1.57   per-figure yaw in radians (cycled): front, side, back, other side
 *   expr=pain|fear|angry      one expression per figure (cycled)
 *   bg=world      use the real Stage (terrain, sky, camp) instead of the plain lab stage
 *   hide=pelvis,upperLegL   hide bone meshes (debugging: see what lies under a garment)
 *   voff=N        start `vary` at option N (so ?vary=hat&voff=11&n=10 shows hats 11..20)
 *   lod=0|1|2     build the rigs at that crowd level of detail (lod=mix cycles 0,1,2 across the row)
 *   elev=40       raise the camera 40 degrees above the horizon (negative looks up from below), orbiting the framed target; orbit=90 swings it round the row (degrees)
 *   arm=sh:2.7,sz:0.9,el:1.2   pose both arms after the animator (shoulder pitch, abduction, elbow flex; radians, mirrored for the left arm): clipping reviews at the extremes;
 *                 arm=a|b|c poses figure i with entry i % count
 *   grip=0|0.5|1  close both hands by that amount (0 open .. 1 fist), one value per figure (cycled)
 */
export function runLineup(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  void start(canvas, params);
}

async function start(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // By default the lab stage (same lights and shadows as the game, no world) keeps character review independent of the environment; bg=world uses the real one.
  const flat = new CollisionWorld({ height: () => 0 }, [], 100);
  let stage: LabStage | import("../render/Stage.ts").Stage;
  if (params.get("bg") === "world") {
    const { Stage } = await import("../render/Stage.ts");
    stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "high");
  } else stage = new LabStage(canvas);
  stage.buildWorld(flat);

  const seed = Number(params.get("seed") ?? 1);
  const pose = params.get("pose") ?? "idle";
  const exprs = (params.get("expr") ?? "neutral").split("|") as ExpressionId[];
  const close = params.get("close");
  const single = params.get("look");

  const specs: CharacterSpec[] = [];
  const decoded = single ? decodeSpec(single) : undefined;
  if (decoded) specs.push(decoded);
  else {
    const n = Number(params.get("n") ?? ARCHETYPES.length);
    for (let i = 0; i < n; i++) specs.push(generateCharacter(seed + i * 7919, i % ARCHETYPES.length));
  }
  const same = params.get("same");
  if (same !== null && specs[Number(same)]) {
    const base = specs[Number(same)]!;
    for (let i = 0; i < specs.length; i++) specs[i] = { ...base };
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
    if (varyDef) o[varyDef.key] = (i + Number(params.get("voff") ?? 0)) % (varyDef.max + 1);
    Object.assign(spec, sanitizeSpec(spec));
  });

  const frame = params.get("frame");
  const spacing = Number(params.get("sp") ?? (params.get("heads") === "1" ? 1.1 : frame === "head" || frame === "face" ? 0.9 : frame === "hands" ? 0.9 : frame === "feet" ? 1.1 : 1.9));
  const turns = (params.get("turns") ?? "").split(",").filter(Boolean).map(Number);
  const lodParam = params.get("lod") ?? "0";
  const rigs: { rig: CharacterRig; anim: CharacterAnimator }[] = [];
  specs.forEach((spec, i) => {
    const lod = (lodParam === "mix" ? i % 3 : Math.max(0, Math.min(2, Number(lodParam) || 0))) as 0 | 1 | 2;
    const rig = buildCharacter(spec, { outline: params.get("outline") !== "0", lod });
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
    rig.root.rotation.y = Math.PI + (turns.length ? turns[i % turns.length]! : params.get("turn") ? Number(params.get("turn")) : -0.3 + (i % 2) * 0.6);
    // hide=pelvis,upperLegL: switch bone meshes (and their outlines) off to see what lies underneath
    for (const name of (params.get("hide") ?? "").split(",").filter(Boolean)) rig.root.traverse((o) => (o.name === `mesh_${name}` || o.name === `outline_${name}`) && (o.visible = false));
    stage.scene.add(rig.root);
    const anim = new CharacterAnimator(rig);
    anim.setExpression(exprs[i % exprs.length]!);
    rigs.push({ rig, anim });
  });

  const camera = stage.camera;
  camera.fov = 32;
  camera.updateProjectionMatrix();
  const target = new Vector3(0, 1.0, 0);
  if (close !== null && rigs[Number(close)]) {
    const r = rigs[Number(close)]!.rig;
    target.set(r.root.position.x + Number(params.get("tx") ?? 0), params.get("ty") !== null ? Number(params.get("ty")) : r.proportions.totalHeight * 0.82, 0);
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
  if (frame) {
    const bands: Record<string, [number, number]> = { body: [0.92, 2.05], upper: [1.2, 1.15], torso: [1.15, 0.85], head: [1.56, 0.62], face: [1.56, 0.5], legs: [0.5, 1.05], feet: [0.14, 0.5], hands: [0.72, 0.5] };
    const [cy, h] = bands[frame] ?? bands.body!;
    camera.fov = 26;
    camera.updateProjectionMatrix();
    const aspect = window.innerWidth / window.innerHeight;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(h / 2 / tanHalf, (spacing * specs.length * 0.5 + 0.1) / (tanHalf * aspect));
    const heightAvg = rigs.reduce((sum, r) => sum + r.rig.proportions.totalHeight, 0) / rigs.length;
    const yc = frame === "head" ? heightAvg - 0.18 : frame === "face" ? heightAvg - 0.2 : cy;
    target.set(0, yc, 0);
    camera.position.set(0, yc + 0.03, dist);
  }
  const elev = Number(params.get("elev") ?? 0);
  const orbit = Number(params.get("orbit") ?? 0);
  if (elev !== 0 || orbit !== 0) {
    // orbit the camera around the framed target: elevation first (about the horizontal axis), then yaw round the row
    const off = camera.position.clone().sub(target);
    const len = off.length();
    const e0 = Math.asin(off.y / len) + (elev * Math.PI) / 180;
    const yaw = Math.atan2(off.x, off.z) + (orbit * Math.PI) / 180;
    camera.position.set(target.x + len * Math.cos(e0) * Math.sin(yaw), target.y + len * Math.sin(e0), target.z + len * Math.cos(e0) * Math.cos(yaw));
  }
  camera.lookAt(target);

  const flags = pose === "walk" ? FLAG.GROUNDED : pose === "carry" ? FLAG.GROUNDED | FLAG.CARRYING : pose === "crouch" ? FLAG.GROUNDED | FLAG.CROUCHING : pose === "down" ? FLAG.GROUNDED | FLAG.DOWNED : pose === "air" ? 0 : FLAG.GROUNDED;
  const speed = pose === "walk" ? 3.6 : 0;
  // Step the animation to a settled, deterministic frame for stills, then keep animating for live viewing.
  for (let i = 0; i < 90; i++) for (const { anim } of rigs) anim.update(1 / 30, { speed, flags, vy: pose === "air" ? 2 : 0 });

  // arm=sh:2.7,sz:0.9,el:1.2 and grip=0.5: fixed arm poses / hand closure for reviews (the still is posed once; live=1 animation would overwrite it)
  const armPoses = (params.get("arm") ?? "").split("|").map((one) => Object.fromEntries(one.split(",").filter(Boolean).map((kv) => kv.split(":") as [string, string])));
  const applyArm = (): void => {
    if (!params.get("arm")) return;
    rigs.forEach(({ rig }, i) => {
      const armPose = armPoses[i % armPoses.length]!;
      const j = rig.joints;
      const sh = Number(armPose.sh ?? 0);
      const sz = Number(armPose.sz ?? 0);
      const el = Number(armPose.el ?? 0);
      j.shoulderL.rotation.set(sh, 0, -sz);
      j.shoulderR.rotation.set(sh, 0, sz);
      j.elbowL.rotation.x = el;
      j.elbowR.rotation.x = el;
    });
  };
  applyArm();
  // grip=0.5 or grip=0|0.5|1 (one per figure): the hands' closure
  const grips = (params.get("grip") ?? "").split("|").filter(Boolean).map(Number);
  if (grips.length) rigs.forEach(({ rig }, i) => {
    rig.setHandGrip("L", grips[i % grips.length]!);
    rig.setHandGrip("R", grips[i % grips.length]!);
  });

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
