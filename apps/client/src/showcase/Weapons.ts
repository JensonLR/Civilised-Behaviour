import { Vector3 } from "three";
import { FLAG, WEAPON } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig } from "@cb/procedural/three";
import { WeaponRig } from "../render/weapons/WeaponRig.ts";
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
 */
export function runWeapons(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new LabStage(canvas);

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
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    const wr = new WeaponRig(rig, anim, outline);
    figures.push({ rig, anim, wr });
  });

  const aiming = state === "aim" || state === "fire";
  const flags = FLAG.GROUNDED | (aiming ? FLAG.AIMING : 0);
  const speed = state === "walk" ? 3.4 : 0;
  const ctx = (id: number) => ({ weapon: id, aiming, elev, reload: state === "reload" ? Math.min(0.999, Math.max(0.001, u)) : 0, hidden: false, crew: 0, fp: view === "fp" ? 1 : 0 });
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
