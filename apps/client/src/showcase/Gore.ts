import { Vector3 } from "three";
import { FLAG, ZONE, createArena, setWound, spawnPoint } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { BodyMarks, CharacterAnimator, buildCharacter, type CharacterRig, type GoreLevel } from "@cb/procedural/three";
import { Stage } from "../render/Stage.ts";
import { HitFx } from "../render/HitFx.ts";
import { DecalField } from "../render/decals/DecalField.ts";
import { Aftermath, planAftermath, type AftermathCentre } from "../render/world/aftermath.ts";
import { ShotFx } from "../render/weapons/ShotFx.ts";

/**
 * The field after a fight (`?showcase=weapons&view=gore`, or `?showcase=gore` once the integrator routes it): the real arena with a small battle's consequences on it, frozen at a chosen moment so a still can judge the
 * grit against the jolly. Deterministic. Parameters:
 *   gore=full|reduced|off     the setting (Off: no red anywhere, grime on the ground instead of pools; nothing needs the gore to read)
 *   age=0..600                seconds the field has had to dry and settle (pools spread over ~7 s and darken for a minute; try 3, 40, 300)
 *   sub=wide|bodies|marks|ground (`view=` when routed straight to this scene)   wide: the whole field; bodies: the fallen close; marks: the standing, with mud, soot and dressings, close; ground: the decals from above
 *   mud=0..3, soot=0..3       exposure of the standing figures (default: 1, 3 and 3 across the line)
 *   back=6.5, fov=55           how far back the bodies/marks camera stands, and its lens
 *   cxz=20,-20                where the field is (world x,z)
 *   gfx=low|medium|high, time=17.2, yaw=0.35, pitch=0.3, dist=11
 */
export function runGore(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
  const world = createArena(7);
  stage.buildWorld(world);
  const gore = ((params.get("gore") as GoreLevel | null) ?? "full") as GoreLevel;
  const age = Number(params.get("age") ?? 40);
  const view = params.get("sub") ?? params.get("view") ?? "wide";
  const groundAt = (x: number, z: number): number => world.terrainHeight(x, z);

  const sp = spawnPoint(0, 4);
  const yaw = Number(params.get("yaw") ?? 0.35);
  const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const dist = Number(params.get("dist") ?? 10);
  // (the battlefield's middle: `cx,cz` set it anywhere; the default is open meadow beyond the camp's tents)
  const cxz = (params.get("cxz") ?? "20,-20").split(",").map(Number);
  const centre = params.get("cxz") !== null || params.get("cx") === null ? new Vector3(cxz[0]!, 0, cxz[1]!) : new Vector3(sp.x, 0, sp.z).addScaledVector(fwd, dist);
  const at = (f: number, r: number): { x: number; z: number } => ({ x: centre.x + fwd.x * f + right.x * r, z: centre.z + fwd.z * f + right.z * r });

  const decals = new DecalField(stage.scene, groundAt, "high", 9);
  decals.setGore(gore);
  const shot = new ShotFx(stage.scene, groundAt, 1);
  const hit = new HitFx(stage.scene, groundAt);
  hit.attachDecals(decals);

  // ---- the fallen: three bodies on their backs, open wounds, pools under them ---------------------------------------------------------------------------------------------
  const goreOf = gore;
  const bodies: { rig: CharacterRig; marks: BodyMarks; anim: CharacterAnimator }[] = [];
  const fallen = [
    { f: 0.5, r: -1.6, seed: 31, yaw: 0.4, mask: setWound(setWound(0, ZONE.TORSO, 3), ZONE.ARM_L, 2) },
    { f: -0.8, r: 0.6, seed: 47, yaw: 2.4, mask: setWound(setWound(0, ZONE.HEAD, 2), ZONE.LEG_R, 3) },
    { f: 1.6, r: 2.1, seed: 12, yaw: -0.8, mask: setWound(setWound(setWound(0, ZONE.TORSO, 2), ZONE.LEG_L, 2), ZONE.ARM_R, 3) },
  ];
  for (const b of fallen) {
    const p = at(b.f, b.r);
    const spec = { ...generateCharacter(b.seed), woodenLeg: 0 };
    const rig = buildCharacter(spec, { outline: true });
    rig.root.position.set(p.x, groundAt(p.x, p.z), p.z);
    rig.root.rotation.y = b.yaw;
    stage.scene.add(rig.root);
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    for (let i = 0; i < 80; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.DOWNED | FLAG.GROUNDED, vy: 0 });
    rig.root.position.y = groundAt(p.x, p.z) + 0.12;
    const marks = new BodyMarks(rig);
    marks.set({ open: b.mask, dryness: Math.min(1, age / 180), mud: 2, soot: 1, gore: goreOf });
    bodies.push({ rig, marks, anim });
    // the pool under it, fed by the bleeding; spatter thrown from the wound along where it was hit; a fan of spray
    decals.bloodPool(p.x, p.z, 0.9 + 0.2 * (b.seed % 3) / 3, 1.2);
    decals.spatterAt(p.x + Math.cos(b.yaw) * 0.9, p.z + Math.sin(b.yaw) * 0.9, Math.cos(b.yaw), Math.sin(b.yaw), 0.5);
    decals.sprayAt(p.x, p.z, -Math.sin(b.yaw), Math.cos(b.yaw), 1.8);
    hit.burst(p.x, groundAt(p.x, p.z) + 1.1, p.z, Math.cos(b.yaw), Math.sin(b.yaw), 0.9, goreOf);
  }

  // a body dragged away: 6 m of smear, thinning out
  for (let k = 0; k <= 60; k++) {
    const p = at(-3.5 + k * 0.1, 3.6 - k * 0.12);
    decals.drag(7, p.x, p.z, fwd.x * 0.6 + right.x * -0.8, fwd.z * 0.6 + right.z * -0.8, 7);
  }
  // mud from hooves and boots across the approach
  for (let i = 0; i < 14; i++) {
    const p = at(-4 + i * 0.9, -4.5 + ((i * 37) % 11) * 0.12);
    decals.mud(p.x, p.z, right.x, right.z, 0.22 + 0.1 * ((i * 7) % 4) / 4);
  }

  // ---- the standing: mud, soot, dressings -------------------------------------------------------------------------------------------------------------------------------------
  const mudParam = params.get("mud");
  const sootParam = params.get("soot");
  const standing = [
    { r: -3.0, seed: 5, mud: 1, soot: 0, hurt: 0 },
    { r: -1.0, seed: 19, mud: 3, soot: 0, hurt: setWound(setWound(0, ZONE.LEG_L, 2), ZONE.ARM_R, 1) },
    { r: 1.0, seed: 23, mud: 2, soot: 3, hurt: 0 },
    { r: 3.0, seed: 8, mud: 0, soot: 2, hurt: setWound(0, ZONE.HEAD, 2) },
  ];
  standing.forEach((s, i) => {
    const p = at(0.5 - (i % 2) * 1.2, 7 + i * 1.5);
    const spec = { ...generateCharacter(s.seed), woodenLeg: 0 };
    const rig = buildCharacter(spec, { outline: true });
    rig.root.position.set(p.x, groundAt(p.x, p.z), p.z);
    rig.root.rotation.y = Math.atan2(-fwd.x, -fwd.z) + Math.PI + (i - 1.5) * 0.12;
    stage.scene.add(rig.root);
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    rig.setWounds(s.hurt, goreOf);
    for (let k = 0; k < 60; k++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0, wounds: s.hurt });
    const marks = new BodyMarks(rig);
    marks.set({ open: 0, dryness: 0, mud: mudParam !== null ? Number(mudParam) : s.mud, soot: sootParam !== null ? Number(sootParam) : s.soot, gore: goreOf });
    bodies.push({ rig, marks, anim });
  });

  // ---- what the shells left: craters, scorch, crates, hats, crows, smoke ------------------------------------------------------------------------------------------------------------
  const centres: AftermathCentre[] = [
    { ...at(0.5, -1.2), kind: "casualty", w: 2 },
    { ...at(1.2, 2.0), kind: "casualty" },
    { ...at(3.5, 0.5), kind: "blast", w: 2 },
    { ...at(-1.5, 4.5), kind: "blast" },
  ];
  const plan = planAftermath({
    region: "hollowmere",
    seed: 3,
    tally: { dead: 4, downed: 2, blasts: 3, fires: 1 },
    centres,
    gore: goreOf,
    site: { region: "hollowmere", world, doors: [], routes: [] },
  });
  const after = new Aftermath(stage.scene, shot, decals, true);
  after.show(plan, goreOf);

  // ---- time: let the field spread, dry and settle (large steps for the decals; the pool's own clock is all that matters) --------------------------------------------------------------
  const eye = new Vector3(sp.x, groundAt(sp.x, sp.z) + 1.7, sp.z);
  const cam = stage.camera;
  cam.near = 0.05;
  cam.fov = Number(params.get("fov") ?? 55);
  cam.rotation.order = "YXZ";
  const pitch = Number(params.get("pitch") ?? 0.3);
  if (view === "bodies") {
    const c = at(0.3, 0.0);
    const back = Number(params.get("back") ?? 6.5);
    eye.set(c.x - fwd.x * back + right.x * 1.5, groundAt(c.x, c.z) + 0.4 + back * 0.4, c.z - fwd.z * back + right.z * 1.5);
    cam.position.copy(eye);
    cam.lookAt(c.x, groundAt(c.x, c.z) + 0.2, c.z);
  } else if (view === "marks") {
    const c = at(0.0, 9.9);
    cam.fov = Number(params.get("fov") ?? 38);
    const back = Number(params.get("back") ?? 6.8);
    eye.set(c.x - fwd.x * back, groundAt(c.x, c.z) + 1.5, c.z - fwd.z * back);
    cam.position.copy(eye);
    cam.lookAt(c.x, groundAt(c.x, c.z) + 0.95, c.z);
  } else if (view === "ground") {
    const c = at(0.5, 0.5);
    cam.position.set(c.x, groundAt(c.x, c.z) + Number(params.get("h") ?? 11), c.z + 0.01);
    cam.lookAt(c.x, groundAt(c.x, c.z), c.z);
  } else {
    cam.position.copy(eye);
    cam.rotation.set(-pitch, yaw, 0);
  }
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  stage.followShadow(cam.position);
  stage.render();
  for (let t = 0; t < age; t += 0.5) {
    decals.update(0.5);
    shot.update(0.25);
    hit.update(0.25);
    after.update(0.5);
  }
  decals.update(0.016);

  const loop = (): void => {
    stage.followShadow(cam.position);
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = {
    ready: true,
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, decals: decals.pool.count, drawn: decals.pool.visible, items: plan.length }),
    decals,
    plan,
  };
}
