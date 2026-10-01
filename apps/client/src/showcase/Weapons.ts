import { Vector3 } from "three";
import { FLAG, WEAPON } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig } from "@cb/procedural/three";
import { WeaponRig } from "../render/weapons/WeaponRig.ts";
import { WeaponModel } from "../render/weapons/WeaponModels.ts";
import { CannonView } from "../render/weapons/CannonView.ts";
import { WorldWeapon } from "../render/weapons/WeaponMounts.ts";
import type { ShotFx } from "../render/weapons/ShotFx.ts";
import type { CannonStateType } from "@cb/shared";
import type { WeaponLod } from "../render/weapons/gunParts.ts";
import { LabStage } from "./LabStage.ts";

/**
 * Weapon review scene (`?showcase=weapons`): characters holding, aiming, firing, reloading and swinging every weapon, frozen at a chosen
 * instant so a still can be judged. Deterministic. Parameters:
 *   w=0,1,2,3,4      weapon ids, one character each (default: all five; -1 = bare hands)
 *   state=ready|aim|fire|reload|swing|walk|bash   what they are doing (swing with u for the progress)
 *   u=0.5            progress 0..1 of a reload or a blow (the frame to freeze on)
 *   elev=0.1         aim elevation, radians
 *   view=three|side|front|top|fp   camera (fp = the wielder's own eyes, head hidden)
 *   seed=N           character seed base; same=1 makes everybody the same build (compare weapons on one body)
 *   turn=0.6         yaw of the figures toward the camera
 *   close=I          frame figure I only
 *   outline=0        no ink
 *   carried=0,1,3    (with the figures' view) the weapons on the body: with w=-1 they all hang holstered, with w=N the one in the hands is off the body
 *   rig=lod  the figures' crowd level of detail 0|1|2 (the weapon follows it)
 *   view=world       the weapons lying on the ground where they were dropped: ang, pitch, cd
 *   view=gore        the field after a fight (Gore.ts): pools, spray, drag marks, craters, mud, soot, open wounds; gore=full|reduced|off, age=3|40|300, view2 -> `view=` is taken: use sub=wide|bodies|marks|ground
 *   view=cannon     the field cannon on the ground: ang=0.7 (yaw of the camera round it), pitch=0.2, cd=6, elev=0.15, phase=0|1|2|3 (loading shows the rammer), fired=1 (mid-recoil)
 *   view=model       the guns alone, big, one under the other (no wielder): lod=0|1|2, vm=1 (first-person variant), ang=0.6 (yaw, 0 = side view),
 *                    pitch=0.15, rod=0.5 (ramrod drawn that far), hammer=0|1 (cocked | fallen), cd=distance. Judge shapes, joins and LODs here.
 */
export function runWeapons(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  if (params.get("view") === "gore") {
    // the field after a fight: its own scene (Gore.ts) with the real arena and stage
    void import("./Gore.ts").then((m) => m.runGore(canvas, params));
    return;
  }
  const stage = new LabStage(canvas);
  if (params.get("view") === "model") {
    runModels(stage, params);
    return;
  }
  if (params.get("view") === "world") {
    runWorldWeapons(stage, params);
    return;
  }
  if (params.get("view") === "cannon") {
    runCannon(stage, params);
    return;
  }

  const ids = (params.get("w") ?? "0,1,2,3,4").split(",").map(Number);
  const state = params.get("state") ?? "ready";
  const u = Number(params.get("u") ?? 0.5);
  const elev = Number(params.get("elev") ?? 0.08);
  const view = params.get("view") ?? "three";
  const seed = Number(params.get("seed") ?? 5);
  const outline = params.get("outline") !== "0";
  const turn = Number(params.get("turn") ?? 0.55);
  const spacing = Number(params.get("sp") ?? 2.1);

  const figures: { rig: CharacterRig; anim: CharacterAnimator; wr: WeaponRig }[] = [];
  ids.forEach((id, i) => {
    const spec = generateCharacter(params.get("same") === "1" ? seed : seed + i * 7919);
    spec.woodenLeg = 0;
    const rig = buildCharacter(spec, { outline });
    rig.root.position.set((i - (ids.length - 1) / 2) * spacing, 0, 0);
    rig.root.rotation.y = Math.PI + (view === "side" ? Math.PI / 2 : view === "front" ? 0 : turn);
    stage.scene.add(rig.root);
    const lodWanted = Number(params.get("rig") ?? 0);
    if (lodWanted > 0) rig.setLod(Math.min(2, lodWanted) as 0 | 1 | 2);
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    const wr = new WeaponRig(rig, anim, outline);
    figures.push({ rig, anim, wr });
  });

  const aiming = state === "aim" || state === "fire";
  const flags = FLAG.GROUNDED | (aiming ? FLAG.AIMING : 0);
  const speed = state === "walk" ? 3.4 : 0;
  const carried = params.get("carried") ? params.get("carried")!.split(",").map(Number) : undefined;
  const ctx = (id: number) => ({ weapon: id, carried, aiming, elev, reload: state === "reload" ? Math.min(0.999, Math.max(0.001, u)) : 0, hidden: false, crew: 0, fp: view === "fp" ? 1 : 0 });
  const step = (dt: number, f: (typeof figures)[number], id: number) => {
    const input = f.wr.update(dt, ctx(id));
    f.anim.update(dt, { speed, flags, vy: 0, weapon: input });
    f.wr.apply(f.anim.hold);
  };
  figures.forEach((f, i) => {
    const id = ids[i]!;
    for (let k = 0; k < 75; k++) step(1 / 30, f, id);
    if (state === "fire") {
      f.wr.fire(id);
      step(0.02, f, id);
    }
    if (state === "swing" || state === "bash") {
      f.wr.swing(id, state === "bash");
      const total = 0.5 * u;
      for (let t = 0; t < total; t += 1 / 60) step(1 / 60, f, id);
    }
  });

  const camera = stage.camera;
  camera.fov = 30;
  camera.updateProjectionMatrix();
  const n = ids.length;
  const close = params.get("close");
  const target = new Vector3(0, 1.05, 0);
  if (view === "fp") {
    const f = figures[Number(close ?? 0)] ?? figures[0]!;
    f.rig.joints.head.visible = false;
    f.rig.root.updateMatrixWorld(true);
    const eye = f.rig.joints.head.getWorldPosition(new Vector3());
    camera.fov = 78;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    camera.position.copy(eye).add(new Vector3(0, 0.08, 0));
    const fwd = new Vector3(0, 0, -1).applyQuaternion(f.rig.root.quaternion);
    camera.lookAt(camera.position.clone().add(fwd.multiplyScalar(5)).add(new Vector3(0, elev * 5, 0)));
  } else if (close !== null && figures[Number(close)]) {
    const f = figures[Number(close)]!;
    target.set(f.rig.root.position.x, 1.15, 0);
    const d = Number(params.get("cd") ?? 3.4);
    camera.position.set(target.x, target.y + Number(params.get("cyo") ?? 0.1), d);
    camera.lookAt(target);
  } else if (view === "top") {
    camera.position.set(0, 9, 3.2);
    camera.lookAt(new Vector3(0, 0.9, 0));
  } else {
    camera.position.set(0, 1.5, Math.max(6.5, n * 2.5));
    camera.lookAt(target);
  }

  stage.followShadow(new Vector3(0, 0, 0));
  const loop = () => {
    stage.followShadow(new Vector3(0, 0, 0));
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = {
    ready: true,
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }),
    weapons: ids,
    WEAPON,
  };
}

function runModels(stage: LabStage, params: URLSearchParams): void {
  const ids = (params.get("w") ?? "0,1,2,3,4").split(",").map(Number);
  const lod = Math.min(2, Math.max(0, Number(params.get("lod") ?? 0))) as WeaponLod;
  const vm = params.get("vm") === "1";
  const outline = params.get("outline") !== "0";
  const ang = Number(params.get("ang") ?? 0.0);
  const pitch = Number(params.get("pitch") ?? 0.12);
  const rod = Number(params.get("rod") ?? 0);
  const models = ids.map((id) => new WeaponModel(id, outline, vm, lod));
  const rows = Math.ceil(ids.length / Number(params.get("cols") ?? 1));
  const cols = Math.ceil(ids.length / rows);
  const sx = Number(params.get("sx") ?? 0);
  const sy = Number(params.get("sy") ?? 0.42);
  const base = 4; // lifted clear of the ground plane so any angle sees sky behind the guns
  models.forEach((m, i) => {
    m.group.visible = true;
    m.group.position.set(((i % cols) - (cols - 1) / 2) * sx, base - Math.floor(i / cols) * sy, 0);
    m.setRod(rod);
    m.setHammer(Number(params.get("hammer") ?? 0));
    stage.scene.add(m.group);
  });
  const camera = stage.camera;
  camera.fov = 28;
  camera.updateProjectionMatrix();
  const d = Number(params.get("cd") ?? 4.2);
  const cy = base - ((rows - 1) * sy) / 2 + 0.05;
  // ang 0 = from the wielder's right (the side view); positive turns toward the muzzle
  camera.position.set(Math.cos(ang) * d, cy + Math.sin(pitch) * d, -Math.sin(ang) * d - 0.35);
  camera.lookAt(0, cy, -0.35);
  stage.followShadow(new Vector3(0, base, 0));
  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }), weapons: ids };
}

function runCannon(stage: LabStage, params: URLSearchParams): void {
  const outline = params.get("outline") !== "0";
  // (the cannon only asks the effects for its fuse's sparks: the review scene has none)
  const fx = { fuse: () => undefined } as unknown as ShotFx;
  const view = new CannonView(stage.scene, fx, outline);
  const state = { x: 0, y: 0, z: 0, yaw: Number(params.get("yaw") ?? 0), elev: Number(params.get("elev") ?? 0.15), phase: Number(params.get("phase") ?? 0), progress: 50, crew: Number(params.get("crew") ?? 0), shells: 4, fired: 0 } as CannonStateType;
  view.update(0.016, state);
  if (params.get("fired") === "1") {
    state.fired = 1;
    view.update(0.016, state);
    for (let t = 0; t < 0.4; t += 0.02) view.update(0.02, state);
  }
  for (let k = 0; k < 20; k++) view.update(0.05, state);
  const camera = stage.camera;
  camera.fov = 32;
  camera.updateProjectionMatrix();
  const ang = Number(params.get("ang") ?? 0.7);
  const pitch = Number(params.get("pitch") ?? 0.2);
  const d = Number(params.get("cd") ?? 6);
  camera.position.set(Math.sin(ang) * d, 1.0 + Math.sin(pitch) * d, Math.cos(ang) * d * 0.9);
  camera.lookAt(0, 0.9, 0.3);
  stage.followShadow(new Vector3(0, 0, 0));
  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }) };
}

function runWorldWeapons(stage: LabStage, params: URLSearchParams): void {
  const ids = (params.get("w") ?? "0,1,2,3,4").split(",").map(Number);
  const outline = params.get("outline") !== "0";
  const lod = Math.min(2, Math.max(0, Number(params.get("lod") ?? 0))) as WeaponLod;
  ids.forEach((id, i) => {
    const w = new WorldWeapon(id, outline, lod);
    w.place(-0.3 + (i % 2) * 0.3, 0, (i - (ids.length - 1) / 2) * 0.55, Math.PI / 2 + ((i % 3) - 1) * 0.35);
    stage.scene.add(w.group);
  });
  const camera = stage.camera;
  camera.fov = 34;
  camera.updateProjectionMatrix();
  const ang = Number(params.get("ang") ?? 0.0);
  const pitch = Number(params.get("pitch") ?? 0.6);
  const d = Number(params.get("cd") ?? 5);
  camera.position.set(Math.sin(ang) * d, Math.sin(pitch) * d, Math.cos(ang) * d * Math.cos(pitch));
  camera.lookAt(0, 0.05, 0);
  stage.followShadow(new Vector3(0, 0, 0));
  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }) };
}
